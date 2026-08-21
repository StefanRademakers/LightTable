import { _electron as electron } from 'playwright-core';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import selfsigned from 'selfsigned';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createLightTableMcpApp } from '../apps/mcp-server/src/server.mjs';
import { DynamicDeviceClient } from './packaged-mcp-test-session.mjs';
import {
  captureDesktopTestState,
  resolveDesktopTestLaunch,
  waitForDesktopLauncher
} from './desktop-test-startup.mjs';

const workspace = path.resolve(import.meta.dirname, '..');
const argument = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};
const flag = (name) => process.argv.includes(`--${name}`);
const integerArgument = (name, fallback) => {
  const value = Number.parseInt(argument(name, String(fallback)), 10);
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error(`--${name} must be a port between 1 and 65535.`);
  }
  return value;
};
const mcpPort = integerArgument('mcp-port', 8787);
const devicePort = integerArgument('device-port', 8788);
if (mcpPort === devicePort) throw new Error('MCP and device ports must differ.');
const sourceArgument = argument('file', null);
const source = sourceArgument ? path.resolve(sourceArgument) : null;
const probe = flag('probe');
const fullProbe = flag('a-z');
if (fullProbe && !probe) throw new Error('--a-z requires --probe.');
const mcpOrigin = `http://127.0.0.1:${mcpPort}`;
const deviceOrigin = `https://localhost:${devicePort}`;
const oauthPairingCode = `CODEX-${randomBytes(8).toString('hex').toUpperCase()}`;
const devicePairingCode = `DEVICE-${randomBytes(8).toString('hex').toUpperCase()}`;
const evidenceDirectory = path.join(workspace, 'tmp', 'local-codex-mcp');
await mkdir(evidenceDirectory, { recursive: true });
const sessionDirectory = await mkdtemp(path.join(evidenceDirectory, 'profile-'));
let app;
let service;
let httpServer;
let httpsServer;
let mcpClient;
let stopping = false;
const closeServer = (server) => new Promise((resolve) => server.close(resolve));
const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  await mcpClient?.close().catch(() => undefined);
  await service?.close().catch(() => undefined);
  httpServer?.closeAllConnections?.();
  httpsServer?.closeAllConnections?.();
  await Promise.all([
    ...(httpServer ? [closeServer(httpServer)] : []),
    ...(httpsServer ? [closeServer(httpsServer)] : [])
  ]).catch(() => undefined);
  await app?.close().catch(() => undefined);
  const resolved = path.resolve(sessionDirectory);
  const expectedPrefix = `${path.resolve(evidenceDirectory)}${path.sep}profile-`;
  if (resolved.startsWith(expectedPrefix)) await rm(resolved, { recursive: true, force: true });
};
const fatal = (reason) => {
  process.exitCode = 1;
  void shutdown().finally(() => process.stderr.write(`${reason?.stack ?? reason}\n`));
};
process.once('uncaughtException', fatal);
process.once('unhandledRejection', fatal);

const launch = await resolveDesktopTestLaunch(workspace, { requirePackaged: true });
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
app = await electron.launch({
  executablePath: launch.executablePath,
  cwd: workspace,
  env: {
    ...environment,
    LIGHTTABLE_AUTOMATION_USER_DATA: sessionDirectory,
    LIGHTTABLE_AGENT_ALLOW_LOCAL_TLS: 'true',
    ...(source ? { LIGHTTABLE_AUTOMATION_OPEN_FILE: source } : {})
  }
});
const page = await app.firstWindow({ timeout: 30_000 });
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.message));
const ready = page.locator('.lighttable-toolbar__meta').filter({ hasText: /ready/i });
let desktopOpenAttempts = 0;
let openError;
for (desktopOpenAttempts = 1; desktopOpenAttempts <= 3; desktopOpenAttempts += 1) {
  const open = await waitForDesktopLauncher({ app, page, outputDirectory: evidenceDirectory,
    sourceFile: source ?? 'generated local MCP document', pageErrors, label: 'local-codex-mcp' });
  if (source) {
    await open.click();
  } else {
    await page.getByRole('button', { name: 'New Document', exact: true }).click();
    const newDocument = page.locator('.lighttable-new-document-dialog--embedded');
    await newDocument.getByLabel('Name').fill('Local MCP session');
    await newDocument.getByRole('button', { name: 'Create', exact: true }).click();
  }
  try {
    await ready.waitFor({ state: 'visible', timeout: 20_000 });
    openError = undefined;
    break;
  } catch (error) {
    openError = error;
    if (desktopOpenAttempts < 3) {
      await page.getByRole('button', { name: 'Close editor', exact: true }).click();
    }
  }
}
if (openError) {
  const diagnostic = await captureDesktopTestState({ app, page, outputDirectory: evidenceDirectory,
    sourceFile: source ?? 'generated local MCP document', pageErrors,
    label: 'local-codex-mcp-open', timeout: 60_000 });
  throw new Error(`Local MCP desktop did not open its source document. Diagnostic: ${diagnostic}`, {
    cause: openError
  });
}
const certificate = await selfsigned.generate([{ name: 'commonName', value: 'localhost' }], {
  days: 1,
  keySize: 2048,
  extensions: [{ name: 'subjectAltName', altNames: [
    { type: 2, value: 'localhost' },
    { type: 7, ip: '127.0.0.1' }
  ] }]
});
let dynamicClient;
service = await createLightTableMcpApp({
  publicUrl: mcpOrigin,
  devicePublicUrl: deviceOrigin,
  pairingCode: oauthPairingCode,
  devicePairingCode,
  serverId: `local-codex-${randomUUID().slice(0, 8)}`,
  allowInsecure: true,
  allowedHosts: ['127.0.0.1', 'localhost'],
  client: (broker) => (dynamicClient = new DynamicDeviceClient(broker, 'local-codex'))
});
httpServer = createHttpServer(service.app);
httpsServer = createHttpsServer({ key: certificate.private, cert: certificate.cert }, service.app);
httpsServer.on('upgrade', (request, socket, head) => {
  if (!service.deviceTunnel.handleUpgrade(request, socket, head)) socket.destroy();
});
await Promise.all([
  new Promise((resolve, reject) => httpServer.once('error', reject).listen(mcpPort, '127.0.0.1', resolve)),
  new Promise((resolve, reject) => httpsServer.once('error', reject).listen(devicePort, '127.0.0.1', resolve))
]);
await page.getByRole('menuitem', { name: 'Edit' }).click();
await page.getByRole('menuitem', { name: 'Preferences...' }).click();
const settings = page.getByRole('dialog', { name: 'Preferences' });
await settings.getByRole('button', { name: 'Agent Access' }).click();
const serverUrlInput = settings.getByLabel('Server URL');
const pairingCodeInput = settings.getByLabel('One-time pairing code');
await serverUrlInput.fill(deviceOrigin);
await serverUrlInput.press('Tab');
await pairingCodeInput.fill(devicePairingCode);
await pairingCodeInput.press('Tab');
if (await serverUrlInput.inputValue() !== deviceOrigin
  || await pairingCodeInput.inputValue() !== devicePairingCode) {
  throw new Error('Local MCP pairing fields did not retain their requested values.');
}
await page.waitForTimeout(100);
await settings.getByRole('button', { name: 'Pair', exact: true }).click();
try {
  await settings.getByText('connected', { exact: true }).waitFor({ timeout: 15_000 });
} catch (error) {
  const diagnostic = await captureDesktopTestState({ app, page, outputDirectory: evidenceDirectory,
    sourceFile: source ?? 'generated local MCP document', pageErrors,
    label: 'local-codex-mcp-pair', timeout: 15_000 });
  throw new Error(`Local MCP desktop tunnel did not connect. Diagnostic: ${diagnostic}`, {
    cause: error
  });
}

process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());

const instructions = {
  endpoint: `${mcpOrigin}/mcp`,
  codex: {
    add: `codex mcp add lighttable-local --url ${mcpOrigin}/mcp`,
    login: 'codex mcp login lighttable-local --scopes lighttable:read,lighttable:edit',
    remove: 'codex mcp logout lighttable-local && codex mcp remove lighttable-local',
    restartRequired: true
  },
  oauthPairingCode,
  desktop: { status: 'connected', approval: 'Approve the Codex client in Preferences > Agent Access.' }
};
process.stdout.write(`${JSON.stringify(instructions, null, 2)}\n`);

if (probe) {
  const registered = service.oauth.register({ client_name: 'Local MCP transport probe',
    redirect_uris: ['http://127.0.0.1/callback'] });
  const verifier = randomBytes(48).toString('base64url');
  const code = service.oauth.authorize({ clientId: registered.client_id,
    redirectUri: registered.redirect_uris[0], responseType: 'code',
    scope: 'lighttable:read lighttable:edit',
    codeChallenge: createHash('sha256').update(verifier).digest('base64url'),
    codeChallengeMethod: 'S256', pairingCode: oauthPairingCode });
  const access = service.oauth.exchangeCode({ code, clientId: registered.client_id,
    redirectUri: registered.redirect_uris[0], codeVerifier: verifier }).access_token;
  mcpClient = new Client({ name: 'Local MCP transport probe', version: '1.0.0' });
  await mcpClient.connect(new StreamableHTTPClientTransport(new URL(`${mcpOrigin}/mcp`), {
    authProvider: { token: async () => access }
  }));
  const blocked = await mcpClient.callTool({ name: 'lighttable_workspace', arguments: {} });
  if (!blocked.isError) throw new Error('Local MCP request bypassed desktop approval.');
  await settings.getByText('LightTable MCP server', { exact: true }).waitFor({ timeout: 10_000 });
  await settings.getByRole('button', { name: 'Allow read' }).click();
  const workspaceResult = await mcpClient.callTool({ name: 'lighttable_workspace', arguments: {} });
  if (workspaceResult.isError || !workspaceResult.structuredContent?.activeDocumentId) {
    throw new Error('Local MCP probe could not inspect the packaged workspace.');
  }
  const documentId = workspaceResult.structuredContent.activeDocumentId;
  const capabilities = await mcpClient.callTool({ name: 'lighttable_capabilities', arguments: {
    documentId
  } });
  if (capabilities.isError || !capabilities.structuredContent?.commands?.length) {
    throw new Error('Local MCP probe returned no command capabilities.');
  }
  const document = await mcpClient.callTool({ name: 'lighttable_document', arguments: { documentId } });
  if (document.isError || !Number.isInteger(document.structuredContent?.canonicalRevision)) {
    throw new Error('Read-only local MCP document query returned no canonical revision.');
  }
  const preview = await mcpClient.callTool({ name: 'lighttable_preview', arguments: {
    documentId, expectedDocumentRevision: document.structuredContent.canonicalRevision,
    maxEdge: 256, format: 'webp', quality: 0.7
  } });
  if (preview.isError || !preview.content?.some(({ type, data }) => type === 'image' && data)) {
    throw new Error(`Read-only local MCP preview returned no bounded image: ${JSON.stringify(preview)}`);
  }
  const readOnlyEdit = await mcpClient.callTool({ name: 'lighttable_execute', arguments: {
    documentId, command: 'view.setZoom', parameters: { mode: 'fit' }
  } });
  if (!readOnlyEdit.isError) throw new Error('Desktop read-only approval admitted an edit command.');
  const allowEdit = settings.getByRole('button', { name: 'Allow edit' });
  await allowEdit.waitFor({ timeout: 10_000 });
  await allowEdit.click();
  const edited = await mcpClient.callTool({ name: 'lighttable_execute', arguments: {
    documentId, command: 'view.setZoom', parameters: { mode: 'custom', percent: 110 }
  } });
  if (edited.isError || edited.structuredContent?.value?.viewport?.scale !== 1.1) {
    throw new Error('Edit-approved local MCP command did not reach the viewport owner.');
  }
  let artistFlow;
  if (fullProbe) {
    const built = await mcpClient.callTool({ name: 'lighttable_build_social_design', arguments: {
      name: 'Local Codex A-Z', title: 'MCP A-Z',
      body: 'Editable text, vector geometry, effects and revision-bound correction.'
    } });
    if (built.isError || !built.structuredContent?.documentId) {
      throw new Error(`Local MCP A-Z could not build an editable design: ${JSON.stringify(built)}`);
    }
    const designDocumentId = built.structuredContent.documentId;
    const beforeDocument = await mcpClient.callTool({ name: 'lighttable_document', arguments: {
      documentId: designDocumentId
    } });
    const beforeRevision = beforeDocument.structuredContent?.canonicalRevision;
    if (!Number.isInteger(beforeRevision)) throw new Error('Local MCP A-Z design has no canonical revision.');
    const beforeLayers = await mcpClient.callTool({ name: 'lighttable_layers', arguments: {
      documentId: designDocumentId
    } });
    const layers = beforeLayers.structuredContent?.layers ?? [];
    const titleLayer = layers.find((layer) => layer.type === 'text' && layer.name === 'MCP A-Z');
    if (!titleLayer?.id || !layers.some((layer) => layer.type === 'vector')) {
      throw new Error(`Local MCP A-Z did not retain editable text/vector layers: ${JSON.stringify(layers)}`);
    }
    const beforePreview = await mcpClient.callTool({ name: 'lighttable_preview', arguments: {
      documentId: designDocumentId, expectedDocumentRevision: beforeRevision,
      maxEdge: 512, format: 'webp', quality: 0.8
    } });
    const beforeImage = beforePreview.content?.find(({ type, data }) => type === 'image' && data)?.data;
    if (!beforeImage) throw new Error('Local MCP A-Z returned no pre-correction preview.');

    const invalidSchema = await mcpClient.callTool({ name: 'lighttable_execute', arguments: {
      documentId: designDocumentId, command: 'layer.rename', parameters: { layerId: titleLayer.id }
    } });
    if (!invalidSchema.isError) throw new Error('Local MCP A-Z admitted an invalid command schema.');
    const missingTarget = await mcpClient.callTool({ name: 'lighttable_execute', arguments: {
      documentId: designDocumentId, command: 'layer.rename',
      parameters: { layerId: 'missing-layer', name: 'Must fail' }
    } });
    if (!missingTarget.isError && missingTarget.structuredContent?.status !== 'rejected') {
      throw new Error(`Local MCP A-Z admitted a missing layer target: ${JSON.stringify(missingTarget)}`);
    }

    const corrected = await mcpClient.callTool({ name: 'lighttable_edit_text', arguments: {
      documentId: designDocumentId, layerId: titleLayer.id, operation: 'replace',
      start: 0, end: 7, text: 'MCP A-Z VERIFIED', expectedDocumentRevision: beforeRevision
    } });
    if (corrected.isError) throw new Error(`Local MCP A-Z correction failed: ${JSON.stringify(corrected)}`);
    const afterDocument = await mcpClient.callTool({ name: 'lighttable_document', arguments: {
      documentId: designDocumentId
    } });
    const textRevision = afterDocument.structuredContent?.canonicalRevision;
    if (!Number.isInteger(textRevision) || textRevision <= beforeRevision) {
      throw new Error('Local MCP A-Z correction did not advance the canonical revision.');
    }
    const detail = await mcpClient.callTool({ name: 'lighttable_execute', arguments: {
      documentId: designDocumentId, command: 'grade.setDetail',
      expectedDocumentRevision: textRevision,
      parameters: { target: { kind: 'document' }, values: {
        sharpeningAmount: 45, sharpeningRadius: 1.1, luminanceNoiseReduction: 30
      } }
    } });
    if (detail.isError || detail.structuredContent?.status !== 'completed') {
      throw new Error(`Local MCP A-Z Detail correction failed: ${JSON.stringify(detail)}`);
    }
    const detailDocument = await mcpClient.callTool({ name: 'lighttable_document', arguments: {
      documentId: designDocumentId
    } });
    const afterRevision = detailDocument.structuredContent?.canonicalRevision;
    if (!Number.isInteger(afterRevision) || afterRevision <= textRevision) {
      throw new Error('Local MCP A-Z Detail correction did not advance the canonical revision.');
    }
    const adjustment = await mcpClient.callTool({ name: 'lighttable_adjustment', arguments: {
      documentId: designDocumentId, expectedDocumentRevision: afterRevision,
      target: { kind: 'document', owner: 'grade' }
    } });
    const detailParameters = adjustment.structuredContent?.stack?.modules
      ?.find(({ type }) => type === 'lt.detail')?.parameters
      ?.find(({ path }) => path === 'detail')?.value;
    if (detailParameters?.sharpeningAmount !== 45
      || detailParameters?.luminanceNoiseReduction !== 30) {
      throw new Error(`Local MCP A-Z Detail state was not independently queryable: ${JSON.stringify(adjustment)}`);
    }
    const stale = await mcpClient.callTool({ name: 'lighttable_execute', arguments: {
      documentId: designDocumentId, command: 'layer.rename', expectedDocumentRevision: beforeRevision,
      parameters: { layerId: titleLayer.id, name: 'Stale write' }
    } });
    if (!stale.isError && stale.structuredContent?.status !== 'rejected') {
      throw new Error(`Local MCP A-Z admitted a stale revision write: ${JSON.stringify(stale)}`);
    }
    const textState = await mcpClient.callTool({ name: 'lighttable_text', arguments: {
      documentId: designDocumentId, layerId: titleLayer.id
    } });
    if (textState.structuredContent?.content?.text !== 'MCP A-Z VERIFIED') {
      throw new Error(`Local MCP A-Z correction was not independently queryable: ${JSON.stringify(textState)}`);
    }
    const afterPreview = await mcpClient.callTool({ name: 'lighttable_preview', arguments: {
      documentId: designDocumentId, expectedDocumentRevision: afterRevision,
      maxEdge: 512, format: 'webp', quality: 0.8
    } });
    const afterImage = afterPreview.content?.find(({ type, data }) => type === 'image' && data)?.data;
    if (!afterImage || createHash('sha256').update(beforeImage).digest('hex')
      === createHash('sha256').update(afterImage).digest('hex')) {
      throw new Error('Local MCP A-Z correction did not produce distinct rendered pixels.');
    }
    const exportArtifact = async (command, parameters, hasValidSignature) => {
      const accepted = await mcpClient.callTool({ name: 'lighttable_execute', arguments: {
        documentId: designDocumentId, command, parameters
      } });
      if (accepted.isError || !accepted.structuredContent?.taskId) {
        throw new Error(`${command} was not accepted: ${JSON.stringify(accepted)}`);
      }
      const task = await waitForMcpTask(mcpClient, designDocumentId, accepted.structuredContent.taskId, 60_000);
      if (task.status !== 'completed' || !task.artifact?.id) {
        throw new Error(`${command} did not produce an artifact: ${JSON.stringify(task)}`);
      }
      const artifact = await dynamicClient.readArtifact(task.artifact.id);
      if (!hasValidSignature(artifact.bytes)) {
        throw new Error(`${command} produced an invalid artifact signature.`);
      }
      return { id: task.artifact.id, bytes: artifact.bytes.byteLength };
    };
    const startsWith = (signature) => (bytes) => Buffer.from(bytes.subarray(0, signature.length))
      .equals(Buffer.from(signature));
    const png = await exportArtifact('file.exportPng', {}, startsWith([0x89, 0x50, 0x4e, 0x47]));
    const jpeg = await exportArtifact('file.exportBitmap', { format: 'jpeg' },
      startsWith([0xff, 0xd8, 0xff]));
    const webp = await exportArtifact('file.exportBitmap', { format: 'webp' }, (bytes) =>
      Buffer.from(bytes.subarray(0, 4)).equals(Buffer.from('RIFF'))
      && Buffer.from(bytes.subarray(8, 12)).equals(Buffer.from('WEBP')));
    const tiff = await exportArtifact('file.exportBitmap', { format: 'tiff' }, (bytes) =>
      startsWith([0x49, 0x49, 0x2a, 0x00])(bytes)
      || startsWith([0x4d, 0x4d, 0x00, 0x2a])(bytes));
    const native = await exportArtifact('file.exportNative', {}, (bytes) => {
      const offset = bytes.byteLength - 12;
      return offset >= 0 && Buffer.from(bytes.subarray(offset, offset + 8)).equals(Buffer.from('LTBLDOC1'));
    });
    const events = await mcpClient.callTool({ name: 'lighttable_events', arguments: {
      afterCursor: 0, limit: 200
    } });
    if (events.isError || !(events.structuredContent?.events?.length > 0)) {
      throw new Error('Local MCP A-Z published no observable events.');
    }
    await mcpClient.close();
    mcpClient = new Client({ name: 'Local MCP reconnect probe', version: '1.0.0' });
    await mcpClient.connect(new StreamableHTTPClientTransport(new URL(`${mcpOrigin}/mcp`), {
      authProvider: { token: async () => access }
    }));
    const reconnected = await mcpClient.callTool({ name: 'lighttable_document', arguments: {
      documentId: designDocumentId
    } });
    if (reconnected.isError || reconnected.structuredContent?.canonicalRevision !== afterRevision) {
      throw new Error('Local MCP A-Z reconnect lost canonical document state.');
    }
    artistFlow = { documentId: designDocumentId, beforeRevision, afterRevision,
      editableLayerCount: layers.length, previewChanged: true, invalidSchemaRejected: true,
      missingTargetRejected: true, staleRevisionRejected: true, detailQueried: true, reconnect: true,
      exports: { png, jpeg, webp, tiff, native } };
  }
  const report = {
    generatedAt: new Date().toISOString(),
    transport: { mcp: 'loopback-http', desktop: 'loopback-https-wss' },
    packagedDesktop: true,
    approvalGate: { blockedBeforeApproval: true, readOnlyPreview: true,
      editBlockedWhileReadOnly: true, revocation: true, editAfterEscalation: true },
    activeDocument: true,
    desktopOpenAttempts,
    commandCount: capabilities.structuredContent.commands.length,
    ...(artistFlow ? { artistFlow } : {}),
    pageErrors
  };
  const reportPath = path.join(evidenceDirectory, 'report.json');
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.stdout.write(`Local MCP transport probe passed: ${reportPath}\n`);
  await shutdown();
} else {
  process.stdout.write('Keep this process running. Complete OAuth login, approve Codex in LightTable, then start a fresh Codex session. Press Ctrl+C to stop.\n');
  await new Promise((resolve) => {
    process.once('SIGINT', resolve);
    process.once('SIGTERM', resolve);
  });
  await shutdown();
}

async function waitForMcpTask(client, documentId, taskId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await client.callTool({ name: 'lighttable_task', arguments: { documentId, taskId } });
    if (response.isError) throw new Error(`Local MCP task query failed: ${JSON.stringify(response)}`);
    const task = response.structuredContent;
    if (task?.status && task.status !== 'running' && task.status !== 'accepted') return task;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for local MCP task ${taskId}.`);
}
