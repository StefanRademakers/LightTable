import { _electron as electron } from 'playwright-core';
import { createServer } from 'node:https';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import selfsigned from 'selfsigned';
import { DeviceTunnelBroker } from '../apps/mcp-server/src/deviceTunnel.mjs';
import { resolveDesktopTestLaunch, waitForDesktopLauncher } from './desktop-test-startup.mjs';

const root = path.resolve(import.meta.dirname, '..');
const launch = await resolveDesktopTestLaunch(root);
const userData = path.join(root, 'tmp', 'smoke-agent-tunnel-user-data');
const fixture = path.resolve(process.argv[2] ?? 'D:\\shapes.psd');
const screenshot = path.join(root, 'tmp', 'screenshots', 'agent-server-pairing.png');
await Promise.all([rm(userData, { recursive: true, force: true }), mkdir(path.dirname(screenshot), { recursive: true })]);

const certificate = await selfsigned.generate([{ name: 'commonName', value: 'localhost' }], {
  days: 1, keySize: 2048,
  extensions: [{ name: 'subjectAltName', altNames: [
    { type: 2, value: 'localhost' }, { type: 7, ip: '127.0.0.1' }
  ] }]
});
let broker;
const tlsServer = createServer({ key: certificate.private, cert: certificate.cert }, async (request, response) => {
  try {
    if (request.method !== 'POST' || request.url !== '/agent/pair') {
      response.writeHead(404).end(); return;
    }
    const chunks = []; let length = 0;
    for await (const chunk of request) {
      length += chunk.length; if (length > 16 * 1024) throw new Error('body-too-large'); chunks.push(chunk);
    }
    const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const value = broker.pair(input.code, input.deviceId);
    response.writeHead(201, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    response.end(JSON.stringify(value));
  } catch {
    response.writeHead(400, { 'content-type': 'application/json' }); response.end('{"error":"pairing-rejected"}');
  }
});
await new Promise((resolve) => tlsServer.listen(0, '127.0.0.1', resolve));
const address = tlsServer.address();
const serverUrl = `https://localhost:${address.port}`;
broker = new DeviceTunnelBroker({ publicUrl: serverUrl, pairingCode: 'PAIR-105', serverId: 'local-tls-harness' });
tlsServer.on('upgrade', (request, socket, head) => {
  if (!broker.handleUpgrade(request, socket, head)) socket.destroy();
});

const environment = { ...process.env }; delete environment.ELECTRON_RUN_AS_NODE;
let app;
try {
  app = await electron.launch({ executablePath: launch.executablePath, args: launch.args, cwd: root,
    env: { ...environment, LIGHTTABLE_AUTOMATION_USER_DATA: userData,
      LIGHTTABLE_AUTOMATION_OPEN_FILE: fixture, LIGHTTABLE_AGENT_ALLOW_LOCAL_TLS: 'true' }, timeout: 30_000 });
  const window = await app.firstWindow({ timeout: 30_000 });
  const open = await waitForDesktopLauncher({ app, page: window,
    outputDirectory: path.dirname(screenshot), sourceFile: fixture, label: 'agent-tunnel' });
  await open.click();
  await window.locator('.lighttable-toolbar__meta').filter({ hasText: /ready/i }).waitFor({ timeout: 60_000 });
  await window.getByRole('menuitem', { name: 'Edit' }).click();
  await window.getByRole('menuitem', { name: 'Preferences...' }).click();
  const settings = window.getByRole('dialog', { name: 'Preferences' });
  await settings.getByRole('button', { name: 'Agent Access' }).click();
  if (await settings.getByRole('checkbox').isChecked()) throw new Error('Local listener was unexpectedly enabled.');
  await settings.getByLabel('Server URL').fill(serverUrl);
  await settings.getByLabel('One-time pairing code').fill('PAIR-105');
  await settings.getByRole('button', { name: 'Pair', exact: true }).click();
  await settings.getByText('connected', { exact: true }).waitFor({ timeout: 15_000 }).catch(async () => {
    throw new Error(`Agent tunnel did not connect: ${(await settings.innerText()).slice(-1200)}`);
  });
  await waitFor(() => broker.connections.size === 1, 'outbound TLS tunnel');
  const deviceId = [...broker.connections.keys()][0];

  broker.requestClient(deviceId, { id: 'client-design', name: 'Test design agent', scopes: ['read', 'edit'] });
  await settings.getByText('Test design agent', { exact: true }).waitFor();
  await settings.getByRole('button', { name: 'Allow edit' }).click();
  await waitFor(() => broker.status(deviceId).clients[0]?.approved === true, 'client approval');
  const workspace = await broker.invoke(deviceId, 'client-design', 'workspace.query');
  const documentId = workspace.documents[0]?.id;
  const layerPage = await broker.invoke(deviceId, 'client-design', 'layer.list', { documentId });
  const layers = Array.isArray(layerPage) ? layerPage : layerPage?.layers ?? [];
  const result = await broker.invoke(deviceId, 'client-design', 'command.execute', {
    commandRequestId: 'tunnel-rename', command: 'layer.rename', documentId,
    commandParameters: { layerId: layers[0].id, name: 'Renamed through secure tunnel' }
  });
  if (result.status !== 'completed') throw new Error('Secure tunnel edit failed.');
  await window.getByRole('treeitem', { name: /Renamed through secure tunnel/i }).waitFor();

  broker.rotateSession(deviceId);
  await settings.getByText(/credentials were rotated/i).waitFor();
  broker.dropDevice(deviceId);
  await settings.getByText('degraded', { exact: true }).waitFor({ timeout: 10_000 });
  await settings.getByText('connected', { exact: true }).waitFor({ timeout: 10_000 });
  await window.screenshot({ path: screenshot });

  await settings.getByRole('button', { name: 'Revoke client', exact: true }).click();
  await waitFor(() => broker.status(deviceId).clients.length === 0, 'client revocation');
  await broker.invoke(deviceId, 'client-design', 'workspace.query').then(() => {
    throw new Error('A revoked client was still able to read the document.');
  }, () => undefined);
  await settings.getByRole('button', { name: 'Unpair this LightTable installation...', exact: true }).click();
  await page.getByRole('dialog', { name: 'Unpair LightTable from the MCP server?' })
    .getByRole('button', { name: 'Unpair', exact: true }).click();
  await settings.getByText('revoked', { exact: true }).waitFor();
  await waitFor(() => !broker.status(deviceId).connected, 'device revocation');
  process.stdout.write(`Desktop outbound Agent tunnel smoke passed: ${screenshot}\n`);
} finally {
  await app?.close().catch(() => undefined);
  broker?.close();
  await new Promise((resolve) => tlsServer.close(resolve));
}

async function waitFor(predicate, label, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${label}.`);
}
