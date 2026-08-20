import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import path from 'node:path';
import process from 'node:process';
import sharp from 'sharp';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { LightTableBridgeClient } from '../apps/mcp-server/src/lighttableClient.mjs';
import { createLightTableMcpApp } from '../apps/mcp-server/src/server.mjs';

const root = path.resolve(import.meta.dirname, '..');
const source = path.resolve(process.argv[2] ?? 'D:\\shapes.psd');
const output = path.resolve(process.argv[3] ?? 'D:\\mediavibe\\LightTableTestFiles\\mcp');
const bridgePort = 18_000 + Math.floor(Math.random() * 1_000);
const bridgeToken = randomBytes(32).toString('base64url');
const pairingCode = randomBytes(10).toString('base64url');
const mcpGradient = { kind: 'gradient', shape: 'linear', coordinateSpace: 'document',
  asset: { id: 'mcp-blue-gradient', name: 'MCP blue gradient', type: 'solid',
    smoothness: 1, roughness: 0, seed: 0,
    colorStops: [
      { id: 'blue', position: 0, midpoint: 0.5, color: { r: 0.05, g: 0.1, b: 0.9, a: 1 } },
      { id: 'cyan', position: 1, midpoint: 0.5, color: { r: 0.05, g: 0.8, b: 1, a: 1 } }
    ], opacityStops: [
      { id: 'opaque-start', position: 0, midpoint: 0.5, opacity: 1 },
      { id: 'opaque-end', position: 1, midpoint: 0.5, opacity: 1 }
    ] },
  transform: { a: 400, b: 0, c: 0, d: 400, tx: 0, ty: 0 },
  reverse: false, dither: true, interpolation: 'perceptual' };
const bridgeProcess = spawn(process.execPath,
  ['scripts/lighttable-mcp-automation-bridge.mjs', '--port', String(bridgePort), '--file', source], {
    cwd: root, env: { ...process.env, LIGHTTABLE_BRIDGE_TOKEN: bridgeToken },
    stdio: ['ignore', 'pipe', 'pipe']
  });
let bridgeLog = '';
bridgeProcess.stdout.on('data', (chunk) => { bridgeLog += chunk; process.stdout.write(chunk); });
bridgeProcess.stderr.on('data', (chunk) => { bridgeLog += chunk; process.stderr.write(chunk); });
const waitFor = async (predicate, label, timeout = 90_000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (predicate()) return;
    if (bridgeProcess.exitCode !== null) throw new Error(`Bridge exited before ${label}.\n${bridgeLog}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${label}.\n${bridgeLog}`);
};
const listen = (app) => new Promise((resolve) => {
  const server = app.listen(0, '127.0.0.1', () => resolve(server));
});
const stopHttp = (server) => new Promise((resolve) => server.close(resolve));
let service; let http; let mcpClient;

try {
  await waitFor(() => bridgeLog.includes('LightTable MCP bridge:'), 'desktop bridge');
  const bridge = new LightTableBridgeClient({ baseUrl: `http://127.0.0.1:${bridgePort}`,
    token: bridgeToken });
  const directWorkspace = await bridge.invoke('workspace.query');
  if (!directWorkspace?.activeDocumentId) throw new Error('Desktop bridge has no active document.');

  service = await createLightTableMcpApp({ publicUrl: 'http://127.0.0.1:8787', pairingCode,
    client: bridge, allowInsecure: true, allowedHosts: ['127.0.0.1'] });
  http = await listen(service.app);
  const registered = service.oauth.register({ redirect_uris: ['http://127.0.0.1/callback'] });
  const verifier = randomBytes(48).toString('base64url');
  const code = service.oauth.authorize({ clientId: registered.client_id,
    redirectUri: registered.redirect_uris[0], responseType: 'code',
    scope: 'lighttable:read lighttable:edit offline_access',
    codeChallenge: createHash('sha256').update(verifier).digest('base64url'),
    codeChallengeMethod: 'S256', pairingCode });
  const tokens = service.oauth.exchangeCode({ code, clientId: registered.client_id,
    redirectUri: registered.redirect_uris[0], codeVerifier: verifier });
  const transport = new StreamableHTTPClientTransport(
    new URL(`http://127.0.0.1:${http.address().port}/mcp`),
    { authProvider: { token: async () => tokens.access_token } });
  mcpClient = new Client({ name: 'LightTable MCP smoke', version: '1.0.0' });
  await mcpClient.connect(transport);
  const call = async (name, argumentsValue) => {
    const result = await mcpClient.callTool({ name, arguments: argumentsValue });
    if (result.isError) throw new Error(result.content?.[0]?.text ?? `${name} failed.`);
    return result;
  };
  const workspace = (await call('lighttable_workspace', {})).structuredContent;
  const documentId = workspace.activeDocumentId;
  const before = (await call('lighttable_document', { documentId })).structuredContent;
  const sourceLayerId = before.activeLayerId;
  await call('lighttable_execute', { documentId, command: 'layer.createRaster',
    expectedDocumentRevision: before.canonicalRevision, parameters: {} });
  const createdDocument = (await call('lighttable_document', { documentId })).structuredContent;
  const layerId = createdDocument.activeLayerId;
  await call('lighttable_execute', { documentId, command: 'layer.rename',
    expectedDocumentRevision: createdDocument.canonicalRevision,
    parameters: { layerId, name: 'MCP editable accent' } });
  await call('lighttable_execute', { documentId, command: 'raster.fill', parameters: {
    layerId, channel: 'pixels', color: '#ed2f2f', preserveTransparency: false, opacity: 1
  } });
  await call('lighttable_execute', { documentId, command: 'raster.applyGradient', parameters: {
    layerId, channel: 'pixels', paint: mcpGradient, opacity: 1, blendMode: 'normal'
  } });
  const toneStroke = (await call('lighttable_execute', { documentId, command: 'tool.commitGesture',
    parameters: { kind: 'brush-stroke', parameters: { layerId, channel: 'pixels', erase: false,
      brush: { presetId: 'round', size: 72, hardness: 0.5, opacity: 1,
        flow: 0.14, spacing: 0.25, smooth: 0, color: '#000000', backgroundColor: '#ffffff' },
      operator: { operator: 'tone', mode: 'sponge', range: 'midtones',
        spongeMode: 'desaturate', protectTones: true, vibrance: false } },
    samples: [{ x: 100, y: 100, pressure: 1 }, { x: 200, y: 120, pressure: 0.8 }] }
  })).structuredContent;
  if (toneStroke?.value?.kind !== 'brush-stroke' || toneStroke.value.sampleCount !== 2) {
    throw new Error(`MCP tone-brush command failed: ${JSON.stringify(toneStroke)}`);
  }
  const sampledStroke = (await call('lighttable_execute', { documentId, command: 'tool.commitGesture',
    parameters: { kind: 'brush-stroke', parameters: { layerId, channel: 'pixels', erase: false,
      brush: { presetId: 'round', size: 54, hardness: 0.5, opacity: 0.8,
        flow: 0.35, spacing: 0.08, smooth: 0, color: '#000000', backgroundColor: '#ffffff' },
      operator: { operator: 'healing', source: { anchorLayerId: sourceLayerId,
        point: { x: 80, y: 80 } }, sampleMode: 'current-and-below',
        sourceOffset: { x: -80, y: -40 }, diffusion: 5 } },
    samples: [{ x: 160, y: 120, pressure: 1 }, { x: 230, y: 145, pressure: 0.8 }] }
  })).structuredContent;
  if (sampledStroke?.value?.sampleCount !== 2) {
    throw new Error(`MCP Healing Brush command failed: ${JSON.stringify(sampledStroke)}`);
  }
  const gesture = (await call('lighttable_gesture_begin', { documentId, kind: 'brush-stroke',
    coordinateSpace: 'document', parameters: { layerId, channel: 'pixels' },
    sample: { x: 80, y: 80, pressure: 1 } })).structuredContent;
  await call('lighttable_gesture_update', { gestureId: gesture.gestureId, samples: [
    { x: 180, y: 110, pressure: 0.9 }, { x: 280, y: 75, pressure: 0.75 },
    { x: 380, y: 120, pressure: 0.9 }
  ] });
  await call('lighttable_gesture_finish', { gestureId: gesture.gestureId, commit: true });
  await call('lighttable_execute', { documentId, command: 'warp.applyStroke', parameters: {
    layerId, mode: 'push',
    settings: { diameterPx: 120, strength: 0.75, hardness: 0.5, flow: 1,
      spacing: 0.04, smooth: 0.25, pressureSize: true, pressureStrength: true },
    samples: [
      { positionPx: [120, 140], deltaPx: [0, 0], pressure: 1, tilt: [0, 0], timeMs: 1000 },
      { positionPx: [148, 152], deltaPx: [28, 12], pressure: 0.8, tilt: [12, -8], timeMs: 1016 }
    ],
    startedAtMs: 1000, durationMs: 16
  } });
  const warp = (await call('lighttable_warp', { documentId, layerId })).structuredContent;
  if (warp?.totalStrokes !== 1 || warp.totalSamples !== 2
    || warp.strokes?.[0]?.samples?.[1]?.positionPx?.[0] !== 148) {
    throw new Error(`MCP Warp query lost the editable recipe: ${JSON.stringify(warp)}`);
  }
  const preview = await call('lighttable_preview', { documentId });
  const image = preview.content.find(({ type }) => type === 'image');
  if (!image) throw new Error('MCP preview did not return an image.');
  const rendered = await sharp(Buffer.from(image.data, 'base64')).ensureAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  const sampleOffset = (Math.min(10, rendered.info.height - 1) * rendered.info.width
    + Math.min(10, rendered.info.width - 1)) * 4;
  const corner = [...rendered.data.subarray(sampleOffset, sampleOffset + 4)];
  if (corner[3] < 240 || corner[2] <= corner[0] || corner[2] <= corner[1]) {
    throw new Error(`MCP raster Fill was not visible in the rendered preview: ${JSON.stringify(corner)}`);
  }

  const exportArtifact = async (command, extension) => {
    const accepted = (await call('lighttable_execute', { documentId, command, parameters: {} })).structuredContent;
    if (accepted.status !== 'accepted') throw new Error(`${command} was not accepted.`);
    let task;
    for (let attempt = 0; attempt < 600; attempt += 1) {
      task = await bridge.invoke('task.query', { documentId, taskId: accepted.taskId });
      if (task?.status !== 'running') break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (task?.status !== 'completed' || !task.artifact?.id) {
      throw new Error(`${command} failed: ${task?.error ?? 'no artifact'}`);
    }
    const artifact = await bridge.readArtifact(task.artifact.id);
    const file = path.join(output, `mcp-layered-design.${extension}`);
    await writeFile(file, artifact.bytes);
    return { file, artifact: task.artifact };
  };
  await mkdir(output, { recursive: true });
  const previewPath = path.join(output, 'mcp-layered-design.png');
  await writeFile(previewPath, Buffer.from(image.data, 'base64'));
  const native = await exportArtifact('file.exportNative', 'lighttable');
  const psd = await exportArtifact('file.exportPsd', 'psd');
  const after = (await call('lighttable_document', { documentId })).structuredContent;
  const layers = (await call('lighttable_layers', { documentId })).structuredContent;
  const report = { source, workspace, before, after, layerCount: layers.length,
    createdLayerId: layerId, outputs: { previewPath, native, psd }, bridgeLog };
  await writeFile(path.join(output, 'mcp-layered-design.json'), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`LightTable MCP end-to-end smoke passed: ${output}\n`);
} finally {
  await mcpClient?.close().catch(() => {});
  await service?.close().catch(() => {});
  if (http) await stopHttp(http).catch(() => {});
  if (bridgeProcess.exitCode === null) {
    await fetch(`http://127.0.0.1:${bridgePort}/shutdown`, { method: 'POST',
      headers: { authorization: `Bearer ${bridgeToken}` } }).catch(() => null);
    const exited = await Promise.race([new Promise((resolve) => bridgeProcess.once('exit', () => resolve(true))),
      new Promise((resolve) => setTimeout(() => resolve(false), 10_000))]);
    if (!exited) {
      bridgeProcess.kill();
      throw new Error('LightTable MCP bridge did not close its Electron process tree.');
    }
  }
}
