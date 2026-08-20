import { _electron as electron } from 'playwright-core';
import { access, mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { resolveDesktopTestLaunch, waitForDesktopLauncher } from './desktop-test-startup.mjs';

const root = path.resolve(import.meta.dirname, '..');
const fixture = path.resolve(process.argv[2] ?? 'D:\\shapes.psd');
const evidenceDirectory = path.join(root, 'tmp', 'agent-access-smoke');
const screenshot = path.join(root, 'tmp', 'screenshots', 'agent-access-settings.png');
const preferencesScreenshot = path.join(root, 'tmp', 'screenshots', 'preferences-file-handling.png');
const launch = await resolveDesktopTestLaunch(root);
await Promise.all([access(fixture), mkdir(evidenceDirectory, { recursive: true }),
  mkdir(path.dirname(screenshot), { recursive: true })]);
const userData = await mkdtemp(path.join(evidenceDirectory, 'profile-'));

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
  app = await electron.launch({ executablePath: launch.executablePath, args: launch.args, cwd: root,
    env: { ...environment, LIGHTTABLE_AUTOMATION_USER_DATA: userData, LIGHTTABLE_AUTOMATION_OPEN_FILE: fixture },
    timeout: 30_000 });
  const window = await app.firstWindow({ timeout: 30_000 });
  const pageErrors = [];
  window.on('pageerror', (error) => pageErrors.push(error.message));
  const open = await waitForDesktopLauncher({
    app, page: window, outputDirectory: evidenceDirectory,
    sourceFile: fixture, pageErrors, label: 'agent-access'
  });
  await open.click();
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

  const shape = await invoke(address, token, 'command.execute', {
    commandRequestId: 'agent-create-badge', command: 'vector.create', documentId: originalId,
    commandParameters: {
      name: 'Agent Badge',
      primitive: { kind: 'ellipse', x: 24, y: 24, width: 160, height: 160 },
      style: { fill: { type: 'solid', color: [0.08, 0.35, 0.9, 1] } }
    }
  });
  const badgeLayerId = shape.status === 'completed' ? shape.value?.layerId : null;
  if (!badgeLayerId) throw new Error(`Agent vector creation failed: ${JSON.stringify(shape)}`);
  const selection = await invoke(address, token, 'command.execute', {
    commandRequestId: 'agent-select-badge', command: 'selection.applyShape', documentId: originalId,
    commandParameters: {
      mode: 'replace',
      shape: { kind: 'ellipse', points: [{ x: 24, y: 24 }, { x: 184, y: 184 }] },
      featherRadius: 1,
      antiAlias: true
    }
  });
  if (selection.status !== 'completed') {
    throw new Error(`Agent selection failed: ${JSON.stringify(selection)}`);
  }
  const transformed = await invoke(address, token, 'command.execute', {
    commandRequestId: 'agent-transform-badge', command: 'layer.setTransform', documentId: originalId,
    commandParameters: {
      layerId: badgeLayerId,
      transform: { a: 1.1, b: 0, c: 0, d: 1.1, tx: 32, ty: 18 }
    }
  });
  const blended = await invoke(address, token, 'command.execute', {
    commandRequestId: 'agent-blend-badge', command: 'layer.setBlendMode', documentId: originalId,
    commandParameters: { layerId: badgeLayerId, blendMode: 'screen' }
  });
  if (transformed.status !== 'completed' || blended.status !== 'completed') {
    throw new Error('Agent badge treatment did not complete.');
  }
  const designedLayers = await invoke(address, token, 'layer.list', { documentId: originalId });
  const badge = designedLayers.find(({ id }) => id === badgeLayerId);
  if (badge?.type !== 'vector' || badge.name !== 'Agent Badge' || badge.blendMode !== 'screen'
    || badge.transform?.tx !== 32 || badge.transform?.ty !== 18
    || badge.vectorContent?.elementCount !== 1) {
    throw new Error(`Agent mixed design state is incomplete: ${JSON.stringify(badge)}`);
  }
  await window.getByRole('treeitem', { name: /Agent Badge/i }).waitFor();

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
  if (pageErrors.length) throw new Error(`Agent Access page errors: ${pageErrors.join(' | ')}`);
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
