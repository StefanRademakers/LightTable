import { _electron as electron } from 'playwright-core';
import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { resolveDesktopTestLaunch, waitForDesktopLauncher } from './desktop-test-startup.mjs';

const workspace = path.resolve(import.meta.dirname, '..');
const argument = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};
const fixture = path.resolve(argument('file', 'D:\\shapes.psd'));
const port = Number.parseInt(argument('port', process.env.LIGHTTABLE_BRIDGE_PORT ?? '8790'), 10);
const token = process.env.LIGHTTABLE_BRIDGE_TOKEN;
if (!token || token.length < 24) throw new Error('LIGHTTABLE_BRIDGE_TOKEN must contain at least 24 characters.');
const launch = await resolveDesktopTestLaunch(workspace);
const startupEvidence = path.join(workspace, 'tmp', `mcp-bridge-${process.pid}`);
await mkdir(startupEvidence, { recursive: true });
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: launch.executablePath,
  args: launch.args, cwd: workspace,
  env: { ...environment, LIGHTTABLE_AUTOMATION_OPEN_FILE: fixture,
    LIGHTTABLE_AUTOMATION_USER_DATA: startupEvidence } });
const page = await app.firstWindow({ timeout: 30_000 });
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.message));
const open = await waitForDesktopLauncher({ app, page, outputDirectory: startupEvidence,
  sourceFile: fixture, pageErrors, label: 'mcp-bridge' });
await open.click();
await page.locator('.lighttable-toolbar__meta').filter({ hasText: /ready/i })
  .waitFor({ state: 'visible', timeout: 60_000 });
await page.waitForFunction(() => Boolean(window.__lightTableAutomation));

const authorized = (header = '') => {
  const supplied = Buffer.from(header.replace(/^Bearer\s+/iu, ''));
  const expected = Buffer.from(token);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
};
const body = async (request, limit) => {
  const chunks = []; let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > limit) throw new Error('Request body is too large.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
};
const json = (response, status, value) => {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(value));
};
const invoke = (method, parameters) => page.evaluate(async ({ method, parameters }) => {
  const driver = window.__lightTableAutomation;
  if (!driver) throw new Error('LightTable automation is unavailable.');
  if (method === 'workspace.query') return driver.queryWorkspace();
  if (method === 'document.query') return driver.queryDocument(parameters.documentId);
  if (method === 'document.preview') return driver.requestDocumentPreview(parameters);
  if (method === 'layer.preview') return driver.requestLayerPreview(parameters);
  if (method === 'layer.list') return driver.queryLayerPage(parameters);
  if (method === 'layer.query') return driver.queryLayerDetail(parameters);
  if (method === 'layer.effects') return driver.queryLayerEffects(parameters.documentId, parameters.layerId);
  if (method === 'text.query') return driver.queryText(parameters.documentId, parameters.layerId);
  if (method === 'vector.query') return driver.queryVector(parameters.documentId, parameters.layerId);
  if (method === 'warp.query') return driver.queryWarp?.(parameters.documentId, parameters.layerId) ?? null;
  if (method === 'grade.queryBasic') return driver.queryBasicGrade(parameters.documentId, parameters.target);
  if (method === 'adjustment.query') return driver.queryAdjustment(parameters.documentId, parameters);
  if (method === 'command.capabilities') return driver.queryCapabilities(parameters.documentId);
  if (method === 'task.query') return driver.queryTask(parameters.documentId, parameters.taskId);
  if (method === 'task.events') return driver.queryTaskEvents(parameters.afterCursor, parameters.limit);
  if (method === 'event.query') return driver.queryPublicationEvents(parameters.afterCursor, parameters.limit);
  if (method === 'artifact.list') return driver.listArtifacts();
  if (method === 'artifact.query') return driver.queryArtifact(parameters.artifactId);
  if (method === 'artifact.release') return driver.releaseArtifact(parameters.artifactId);
  if (method === 'gesture.begin') return driver.beginGesture(parameters);
  if (method === 'gesture.update') return driver.updateGesture(parameters.gestureId, parameters.samples);
  if (method === 'gesture.finish') return driver.finishGesture(parameters.gestureId, parameters.commit === true);
  if (method === 'command.execute') return driver.execute({
    protocolVersion: 1, requestId: parameters.commandRequestId,
    command: parameters.command, documentId: parameters.documentId,
    parameters: parameters.commandParameters ?? {},
    ...(parameters.expectedDocumentRevision === undefined ? {}
      : { expectedDocumentRevision: parameters.expectedDocumentRevision })
  });
  throw new Error(`Unsupported bridge method: ${method}`);
}, { method, parameters });

const server = createServer(async (request, response) => {
  try {
    if (!authorized(request.headers.authorization)) return json(response, 401, { error: 'unauthorized' });
    const url = new URL(request.url, `http://127.0.0.1:${port}`);
    if (request.method === 'POST' && url.pathname === '/shutdown') {
      json(response, 202, { status: 'closing' });
      setImmediate(() => void close().then(() => process.exit(0)));
      return;
    }
    if (request.method === 'POST' && url.pathname === '/invoke') {
      const value = JSON.parse((await body(request, 1024 * 1024)).toString('utf8'));
      const valueResult = await invoke(value.method, value.parameters ?? {});
      return json(response, 200, { requestId: value.requestId, status: 'completed', value: valueResult });
    }
    if (request.method === 'POST' && url.pathname === '/artifacts') {
      const bytes = await body(request, 32 * 1024 * 1024);
      const name = decodeURIComponent(String(request.headers['x-lighttable-filename'] ?? 'agent-image'));
      const mediaType = String(request.headers['content-type'] ?? 'application/octet-stream');
      const metadata = await page.evaluate(({ encoded, name, mediaType }) => {
        const file = new File([Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0))],
          name, { type: mediaType });
        return window.__lightTableAutomation?.registerInputArtifact(file) ?? null;
      }, { encoded: bytes.toString('base64'), name, mediaType });
      return metadata ? json(response, 201, metadata) : json(response, 503, { error: 'automation-unavailable' });
    }
    const match = request.method === 'GET' && url.pathname.match(/^\/artifacts\/([^/]+)$/u);
    if (match) {
      const artifact = await page.evaluate(async (artifactId) => {
        const file = window.__lightTableAutomation?.resolveArtifact(artifactId);
        if (!file) return null;
        const bytes = new Uint8Array(await file.arrayBuffer());
        let binary = ''; const stride = 0x8000;
        for (let offset = 0; offset < bytes.length; offset += stride) {
          binary += String.fromCharCode(...bytes.subarray(offset, offset + stride));
        }
        return { encoded: btoa(binary), name: file.name, mediaType: file.type };
      }, decodeURIComponent(match[1]));
      if (!artifact) return json(response, 404, { error: 'artifact-not-found' });
      response.writeHead(200, { 'content-type': artifact.mediaType || 'application/octet-stream',
        'x-lighttable-filename': encodeURIComponent(artifact.name) });
      return response.end(Buffer.from(artifact.encoded, 'base64'));
    }
    return json(response, 404, { error: 'not-found' });
  } catch (error) { return json(response, 500, { error: error.message }); }
});
server.listen(port, '127.0.0.1', () => process.stdout.write(`LightTable MCP bridge: http://127.0.0.1:${port}\n`));
let closing = false;
const close = async () => {
  if (closing) return;
  closing = true;
  await app.close().catch(() => {});
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
};
process.on('SIGINT', () => void close());
process.on('SIGTERM', () => void close());
