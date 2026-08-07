import { _electron as electron } from 'playwright-core';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(import.meta.dirname, '..');
const desktop = path.join(root, 'apps', 'desktop');
const executable = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const userData = path.join(root, 'tmp', 'smoke-agent-access-user-data');
const fixture = path.resolve(process.argv[2] ?? 'D:\\shapes.psd');
const screenshot = path.join(root, 'tmp', 'screenshots', 'agent-access-settings.png');
const preferencesScreenshot = path.join(root, 'tmp', 'screenshots', 'preferences-file-handling.png');
await Promise.all([rm(userData, { recursive: true, force: true }), mkdir(path.dirname(screenshot), { recursive: true })]);

const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
let app;
let lastAddress;
const invoke = async (address, token, method, parameters = {}, requestId = crypto.randomUUID()) => {
  const response = await fetch(`${address}/invoke`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ requestId, method, parameters })
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(`Agent invoke failed (${response.status}): ${JSON.stringify(payload)}`);
  return payload.value;
};

try {
  app = await electron.launch({ executablePath: executable, args: [desktop], cwd: root,
    env: { ...environment, LIGHTTABLE_AUTOMATION_USER_DATA: userData, LIGHTTABLE_AUTOMATION_OPEN_FILE: fixture },
    timeout: 30_000 });
  const window = await app.firstWindow({ timeout: 30_000 });
  await window.getByRole('button', { name: 'Open file' }).click();
  await window.locator('.lighttable-toolbar__meta').filter({ hasText: /ready/i }).waitFor({ timeout: 60_000 });
  if ((await app.windows()).length !== 1) throw new Error('Agent Access launched another Electron window.');

  await window.getByRole('menuitem', { name: 'Edit' }).click();
  await window.getByRole('menuitem', { name: 'Preferences...' }).click();
  const settings = window.getByRole('dialog', { name: 'Preferences' });
  await settings.getByRole('heading', { name: 'Autosave & recovery' }).waitFor();
  await settings.getByLabel(/Autosave location:/).waitFor();
  await window.screenshot({ path: preferencesScreenshot });
  await settings.getByRole('button', { name: 'Agent Access' }).click();
  const toggle = settings.getByRole('checkbox');
  await toggle.click();
  await settings.getByText(/running|error/, { exact: true }).waitFor({ timeout: 15_000 });
  const initialError = await settings.getByRole('alert').count()
    ? await settings.getByRole('alert').textContent()
    : null;
  if (initialError) throw new Error(`Agent Access enable failed: ${initialError}`);
  const tokenInput = settings.getByLabel('Connection token');
  const address = (await settings.locator('dd').nth(1).textContent())?.trim();
  const token = await tokenInput.inputValue();
  if (!address || !token) throw new Error('Agent Access did not publish its local credentials.');
  lastAddress = address;
  await window.screenshot({ path: screenshot });

  const workspace = await invoke(address, token, 'workspace.query');
  const originalId = workspace.documents[0]?.id;
  if (!originalId) throw new Error('Agent Access could not see the open document.');
  const layers = await invoke(address, token, 'layer.list', { documentId: originalId });
  const layerId = layers[0]?.id;
  if (!layerId) throw new Error('Agent Access could not see the existing layers.');
  const renamed = await invoke(address, token, 'command.execute', {
    commandRequestId: 'agent-rename', command: 'layer.rename', documentId: originalId,
    commandParameters: { layerId, name: 'Renamed through Agent Access' }
  });
  if (renamed.status !== 'completed') throw new Error(`Agent edit did not complete: ${JSON.stringify(renamed)}`);
  await window.getByRole('treeitem', { name: /Renamed through Agent Access/i }).waitFor();

  const unauthorized = await fetch(`${address}/invoke`, { method: 'POST',
    headers: { authorization: 'Bearer wrong-token' }, body: '{}' });
  if (unauthorized.status !== 401) throw new Error('Invalid Agent Access token was accepted.');
  const created = await invoke(address, token, 'command.execute', {
    commandRequestId: 'agent-create-document', command: 'document.create', commandParameters: {
      name: 'Agent second document', width: 320, height: 240, resolutionPpi: 72,
      bitDepth: 8, profile: 'srgb', background: { kind: 'transparent' }
    }
  });
  if (created.status !== 'completed') throw new Error('Agent document-switch fixture failed.');
  const switched = await invoke(address, token, 'workspace.query');
  if (switched.documents.length !== 2) throw new Error('Agent bridge lost a document during a workspace switch.');

  const oldToken = token;
  await settings.getByRole('button', { name: 'Rotate credentials' }).click();
  await window.waitForFunction((previous) => {
    const input = document.querySelector('.lighttable-agent-settings__token input');
    return input instanceof HTMLInputElement && input.value !== previous;
  }, oldToken);
  const rotatedToken = await tokenInput.inputValue();
  if ((await fetch(`${address}/invoke`, { method: 'POST', headers: { authorization: `Bearer ${oldToken}` }, body: '{}' })).status !== 401) {
    throw new Error('Credential rotation left the previous token active.');
  }
  await invoke(address, rotatedToken, 'workspace.query');

  await settings.getByRole('button', { name: 'Stop' }).click();
  await settings.getByText('stopped', { exact: true }).waitFor();
  await expectClosed(address);
  await toggle.click();
  await settings.getByText('running', { exact: true }).waitFor();
  const restartedAddress = (await settings.locator('dd').nth(1).textContent())?.trim();
  const restartedToken = await tokenInput.inputValue();
  if (!restartedAddress) throw new Error('Agent Access did not restart.');
  lastAddress = restartedAddress;
  const afterRestart = await invoke(restartedAddress, restartedToken, 'workspace.query');
  if (afterRestart.documents.length !== 2) throw new Error('Restarting Agent Access lost open documents.');
  await settings.getByRole('button', { name: 'Stop' }).click();
  await expectClosed(restartedAddress);
  process.stdout.write(`Desktop Agent Access smoke passed: ${screenshot}\n`);
} finally {
  await app?.close().catch(() => undefined);
  if (lastAddress) await expectClosed(lastAddress);
}

async function expectClosed(address) {
  await fetch(`${address}/health`, { signal: AbortSignal.timeout(1_000) }).then(() => {
    throw new Error(`Agent Access listener remained open at ${address}.`);
  }).catch((reason) => {
    if (reason instanceof Error && reason.message.includes('remained open')) throw reason;
  });
}
