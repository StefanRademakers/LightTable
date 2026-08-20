import { _electron as electron } from 'playwright-core';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:https';
import { createServer as createPortProbe } from 'node:net';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import selfsigned from 'selfsigned';
import { createLightTableMcpApp } from '../apps/mcp-server/src/server.mjs';
import { DeviceTunnelLightTableClient } from '../apps/mcp-server/src/deviceTunnelClient.mjs';
import { resolveDesktopTestLaunch, waitForDesktopLauncher } from './desktop-test-startup.mjs';
import { compareRenderEvidence } from './render-comparison-evidence.mjs';

class DynamicDeviceClient {
  constructor(broker) { this.broker = broker; this.client = null; }
  inner() {
    const deviceId = [...this.broker.connections.keys()][0];
    if (!deviceId) throw new Error('device-offline');
    if (!this.client || this.client.deviceId !== deviceId) this.client = new DeviceTunnelLightTableClient({
      broker: this.broker, deviceId, clientId: 'mcp-design-client', clientName: 'LightTable MCP server'
    });
    return this.client;
  }
  ready() { try { this.inner().ensureClient(); return true; } catch { return false; } }
  invoke(method, parameters) { return this.inner().invoke(method, parameters); }
  uploadArtifact(input) { return this.inner().uploadArtifact(input); }
  readArtifact(id) { return this.inner().readArtifact(id); }
}

const root = path.resolve(import.meta.dirname, '..');
const launch = await resolveDesktopTestLaunch(root);
const output = path.join(root, 'tmp', 'mcp-design-smoke');
const userData = path.join(output, 'author-user-data');
const reopenUserData = path.join(output, 'reopen-user-data');
const fixture = path.resolve(process.argv[2] ?? 'D:\\shapes.psd');
const subjectOnly = process.argv.includes('--subject-only');
const DESIGN_RENDER_POLICY = {
  maximumRmse: 12,
  maximumMeanAbsoluteError: 8,
  maximumChannelRmse: 18,
  maximumChannelMeanAbsoluteError: 14,
  maximumP95PixelDelta: 30,
  maximumChangedPixelRatioAt16: 0.5
};
await rm(output, { recursive: true, force: true }); await mkdir(output, { recursive: true });

const port = await reservePort(); const publicUrl = `https://localhost:${port}`;
const certificate = await selfsigned.generate([{ name: 'commonName', value: 'localhost' }], {
  days: 1, keySize: 2048, extensions: [{ name: 'subjectAltName', altNames: [
    { type: 2, value: 'localhost' }, { type: 7, ip: '127.0.0.1' }
  ] }]
});

let dynamicClient;
const service = await createLightTableMcpApp({ publicUrl, pairingCode: 'MCP-OAUTH-106',
  devicePairingCode: 'PAIR-106', serverId: 'mcp-design-harness', allowInsecure: false,
  allowedHosts: ['localhost'], client: (broker) => (dynamicClient = new DynamicDeviceClient(broker)) });
const tlsServer = createServer({ key: certificate.private, cert: certificate.cert }, service.app);
tlsServer.on('upgrade', (request, socket, head) => {
  if (!service.deviceTunnel.handleUpgrade(request, socket, head)) socket.destroy();
});
await new Promise((resolve) => tlsServer.listen(port, '127.0.0.1', resolve));

const environment = { ...process.env }; delete environment.ELECTRON_RUN_AS_NODE;
const previousTls = process.env.NODE_TLS_REJECT_UNAUTHORIZED; process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
let app; let reopened; let mcp;
try {
  app = await electron.launch({ executablePath: launch.executablePath, args: launch.args, cwd: root,
    env: { ...environment, LIGHTTABLE_AUTOMATION_USER_DATA: userData,
      LIGHTTABLE_AUTOMATION_OPEN_FILE: fixture, LIGHTTABLE_AGENT_ALLOW_LOCAL_TLS: 'true' }, timeout: 30_000 });
  const window = await app.firstWindow({ timeout: 30_000 });
  const openFile = await waitForDesktopLauncher({ app, page: window, outputDirectory: output,
    sourceFile: fixture, label: 'mcp-design' });
  await openFile.click();
  await window.locator('.lighttable-toolbar__meta').filter({ hasText: /ready/i }).waitFor({ timeout: 60_000 });
  await window.getByRole('menuitem', { name: 'Edit' }).click(); await window.getByRole('menuitem', { name: 'Preferences...' }).click();
  const settings = window.getByRole('dialog', { name: 'Preferences' });
  await settings.getByRole('button', { name: 'Agent Access' }).click();
  await settings.getByLabel('Server URL').fill(publicUrl); await settings.getByLabel('One-time pairing code').fill('PAIR-106');
  await settings.getByRole('button', { name: 'Pair' }).click();
  await settings.getByText('connected', { exact: true }).waitFor({ timeout: 15_000 });

  const oauthClient = service.oauth.register({ client_name: 'Packaged MCP smoke', redirect_uris: ['http://127.0.0.1/callback'] });
  const verifier = 'v'.repeat(64);
  const code = service.oauth.authorize({ clientId: oauthClient.client_id, redirectUri: oauthClient.redirect_uris[0],
    responseType: 'code', scope: 'lighttable:read lighttable:edit',
    codeChallenge: createHash('sha256').update(verifier).digest('base64url'), codeChallengeMethod: 'S256',
    pairingCode: 'MCP-OAUTH-106' });
  const access = service.oauth.exchangeCode({ code, clientId: oauthClient.client_id,
    redirectUri: oauthClient.redirect_uris[0], codeVerifier: verifier }).access_token;
  mcp = new Client({ name: 'LightTable packaged design smoke', version: '1.0.0' });
  await mcp.connect(new StreamableHTTPClientTransport(new URL(`${publicUrl}/mcp`), {
    authProvider: { token: async () => access }
  }));
  const first = await mcp.callTool({ name: 'lighttable_workspace', arguments: {} });
  if (!first.isError) throw new Error('The first remote request bypassed explicit desktop client approval.');
  await settings.getByText('LightTable MCP server', { exact: true }).waitFor();
  await settings.getByRole('button', { name: 'Allow edit' }).click();
  await waitFor(() => dynamicClient.ready(), 'MCP client approval');

  const approvedWorkspace = await mcp.callTool({ name: 'lighttable_workspace', arguments: {} });
  const sourceDocumentId = approvedWorkspace.structuredContent?.documents?.[0]?.id;
  if (!sourceDocumentId) throw new Error('MCP Select Subject found no source document.');
  const sourceLayers = await mcp.callTool({
    name: 'lighttable_layers', arguments: { documentId: sourceDocumentId }
  });
  const sourceLayerId = (sourceLayers.structuredContent?.layers ?? [])
    .find(({ type, visible }) => type === 'raster' && visible)?.id;
  if (!sourceLayerId) throw new Error('MCP Select Subject found no visible raster source layer.');
  const subjectContract = await mcp.callTool({
    name: 'lighttable_commands', arguments: { command: 'selection.selectSubject' }
  });
  if (subjectContract.isError
    || subjectContract.structuredContent?.commands?.[0]?.contract?.status !== 'complete') {
    throw new Error(`MCP Select Subject contract is incomplete: ${JSON.stringify(subjectContract)}`);
  }
  const subjectParameters = {
    kind: 'subject', sourceLayerId, mode: 'replace', sampleAllLayers: false
  };
  const privateStateAttempt = await mcp.callTool({ name: 'lighttable_execute', arguments: {
    documentId: sourceDocumentId, command: 'selection.selectSubject',
    parameters: { ...subjectParameters, modelId: 'private-implementation' }
  } });
  if (!privateStateAttempt.isError) {
    throw new Error('MCP Select Subject admitted private model state.');
  }
  await window.evaluate(() => {
    globalThis.__LIGHTTABLE_SELECTION_OVERLAY_TRACE__ = [];
    globalThis.__LIGHTTABLE_SMART_SELECTION_TRACE__ = [];
  });
  const subjectSelection = await mcp.callTool({ name: 'lighttable_execute', arguments: {
    documentId: sourceDocumentId, command: 'selection.selectSubject', parameters: subjectParameters
  } });
  const subjectTaskId = subjectSelection.structuredContent?.taskId;
  if (subjectSelection.isError || subjectSelection.structuredContent?.status !== 'accepted' || !subjectTaskId) {
    throw new Error(`MCP Select Subject was not accepted: ${JSON.stringify(subjectSelection)}`);
  }
  const subjectTask = await waitForMcpTask(mcp, sourceDocumentId, subjectTaskId, 120_000);
  if (subjectTask.status !== 'completed') {
    throw new Error(`MCP Select Subject failed: ${JSON.stringify(subjectTask)}`);
  }
  await window.waitForFunction(() => globalThis.__LIGHTTABLE_SELECTION_OVERLAY_TRACE__?.some((entry) => (
    entry.operationCount === 1 && entry.sourceKind === 'raster-mask' && entry.maskActive
  )), undefined, { timeout: 15_000 }).catch(async () => {
    const evidence = await window.evaluate(() => ({
      selection: globalThis.__LIGHTTABLE_SELECTION_OVERLAY_TRACE__,
      smartSelection: globalThis.__LIGHTTABLE_SMART_SELECTION_TRACE__
    }));
    throw new Error(`MCP Select Subject completed without visible selection evidence: ${JSON.stringify({
      task: subjectTask, evidence
    })}`);
  });

  designVerification: {
  if (subjectOnly) {
    process.stdout.write('Packaged external MCP Select Subject smoke passed.\n');
    break designVerification;
  }
  const icon = await readFile(path.join(root, 'packages', 'lighttable-app', 'src', 'assets', 'icons', 'gradient_fill.png'))
    .catch(() => readFile(path.join(root, 'packages', 'lighttable-app', 'src', 'assets', 'icons', 'tool_gradient.png')));
  const asset = await dynamicClient.uploadArtifact({ bytes: new Uint8Array(icon), name: 'gradient-icon.png', mediaType: 'image/png' });
  const built = await mcp.callTool({ name: 'lighttable_build_social_design', arguments: {
    name: 'Agent release card', assetId: asset.id, title: 'LIGHTTABLE',
    body: 'Editable text, vector gradients, placed artwork and Layer Styles through the secure MCP tunnel.'
  } });
  if (built.isError) throw new Error(`MCP design failed: ${built.content?.[0]?.text ?? 'unknown error'}`);
  const result = built.structuredContent;
  const documentQuery = await mcp.callTool({
    name: 'lighttable_document', arguments: { documentId: result.documentId }
  });
  const documentState = documentQuery.structuredContent;
  if (documentQuery.isError || typeof documentState?.canonicalRevision !== 'number') {
    throw new Error(`The MCP design has no revision-bound document state: ${JSON.stringify(documentQuery)}`);
  }
  const preview = await mcp.callTool({ name: 'lighttable_preview', arguments: {
    documentId: result.documentId,
    expectedDocumentRevision: documentState.canonicalRevision,
    maxEdge: 1024
  } });
  const previewImage = preview.content?.find(({ type }) => type === 'image');
  if (!previewImage?.data) {
    throw new Error(`The GPU preview did not return PNG image data: ${JSON.stringify(preview)}`);
  }
  const revisionPreviewPath = path.join(output, 'lighttable-revision-preview.png');
  await writeFile(revisionPreviewPath, Buffer.from(previewImage.data, 'base64'));
  const previewId = result.preview?.id; const nativeId = result.native?.id; const psdId = result.psd?.id;
  if (!previewId || !nativeId || !psdId) {
    throw new Error(`The design did not produce final PNG, native and PSD artifacts: ${JSON.stringify(result)}`);
  }
  const finalPng = await dynamicClient.readArtifact(previewId);
  const native = await dynamicClient.readArtifact(nativeId); const psd = await dynamicClient.readArtifact(psdId);
  const lightTablePng = path.join(output, 'lighttable.png'); await writeFile(lightTablePng, finalPng.bytes);
  const nativePath = path.join(output, 'agent-release-card.lighttable'); const psdPath = path.join(output, 'agent-release-card.psd');
  await writeFile(nativePath, native.bytes); await writeFile(psdPath, psd.bytes);
  if (Buffer.from(psd.bytes.subarray(0, 4)).toString('ascii') !== '8BPS') throw new Error('PSD export signature is invalid.');
  await settings.getByText('Agent release card', { exact: true }).waitFor();
  await settings.getByText('completed', { exact: true }).waitFor();
  await window.screenshot({ path: path.join(output, 'agent-access-result.png') });
  await app.close(); app = null;

  reopened = await electron.launch({ executablePath: launch.executablePath, args: launch.args, cwd: root,
    env: { ...environment, LIGHTTABLE_AUTOMATION_USER_DATA: reopenUserData,
      LIGHTTABLE_AUTOMATION_OPEN_FILE: psdPath }, timeout: 30_000 });
  const reopenWindow = await reopened.firstWindow({ timeout: 30_000 });
  const reopenFile = await waitForDesktopLauncher({ app: reopened, page: reopenWindow,
    outputDirectory: output, sourceFile: psdPath, label: 'mcp-design-reopen' });
  await reopenFile.click();
  await reopenWindow.locator('.lighttable-toolbar__meta').filter({ hasText: /ready/i }).waitFor({ timeout: 90_000 });
  await reopenWindow.getByRole('treeitem', { name: /LIGHTTABLE.*text layer/i }).waitFor({ timeout: 30_000 });
  await reopenWindow.getByRole('treeitem', { name: /Gradient card.*vector layer/i }).waitFor({ timeout: 30_000 });
  await reopenWindow.screenshot({ path: path.join(output, 'psd-reopened.png') });
  await reopened.close(); reopened = null;
  const photoshopPng = path.join(output, 'photoshop.png'); const photoshopLayers = path.join(output, 'photoshop-layers.json');
  const photoshop = spawnSync('powershell', ['-NoProfile', '-File', path.join(root, 'scripts', 'photoshop-render-psd.ps1'),
    '-PsdPath', psdPath, '-PngPath', photoshopPng, '-LayersPath', photoshopLayers], { encoding: 'utf8', timeout: 120_000 });
  if (photoshop.status !== 0) throw new Error(`Photoshop verification failed: ${photoshop.stderr || photoshop.stdout}`);
  const layers = JSON.parse((await readFile(photoshopLayers, 'utf8')).replace(/^\uFEFF/u, ''));
  if (layers.filter(({ kind }) => kind === 2).length < 2 || !layers.some(({ name, kind }) => name === 'Gradient card' && kind === 4)) {
    throw new Error(`Photoshop did not preserve editable text/vector layer kinds: ${JSON.stringify(layers)}`);
  }
  const renderEvidence = await compareRenderEvidence({
    leftPath: lightTablePng,
    rightPath: photoshopPng,
    width: 1080,
    height: 1350,
    sideBySidePath: path.join(output, 'lighttable-vs-photoshop.png'),
    differencePath: path.join(output, 'lighttable-vs-photoshop-difference-x4.png'),
    policy: DESIGN_RENDER_POLICY
  });
  if (!renderEvidence.passed) {
    throw new Error(`Photoshop roundtrip render policy failed: ${JSON.stringify({
      checks: renderEvidence.checks,
      metrics: renderEvidence.metrics
    })}`);
  }
  await writeFile(path.join(output, 'parity.json'), JSON.stringify({
    claim: 'structural/interchange smoke; visual equivalence requires human review',
    renderEvidence,
    layers
  }, null, 2));
  process.stdout.write(`Packaged MCP design structural roundtrip passed; render evidence retained: ${output}\n`);
  }
} finally {
  if (previousTls === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  else process.env.NODE_TLS_REJECT_UNAUTHORIZED = previousTls;
  await mcp?.close().catch(() => undefined); await app?.close().catch(() => undefined); await reopened?.close().catch(() => undefined);
  await service.close().catch(() => undefined); await new Promise((resolve) => tlsServer.close(resolve));
}

async function reservePort() {
  const server = createPortProbe(); await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const value = server.address().port; await new Promise((resolve) => server.close(resolve)); return value;
}
async function waitFor(predicate, label, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (predicate()) return; await new Promise((resolve) => setTimeout(resolve, 25)); }
  throw new Error(`Timed out waiting for ${label}.`);
}
async function waitForMcpTask(client, documentId, taskId, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const response = await client.callTool({
      name: 'lighttable_task', arguments: { documentId, taskId }
    });
    if (response.isError) throw new Error(`MCP task query failed: ${JSON.stringify(response)}`);
    const task = response.structuredContent;
    if (task?.status && task.status !== 'running') return task;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for MCP task ${taskId}.`);
}
