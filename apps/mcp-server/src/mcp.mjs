import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';

const response = (value) => ({
  content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  structuredContent: value
});
const failure = (error) => ({ isError: true, content: [{ type: 'text',
  text: error instanceof Error ? error.message : String(error) }] });
const editable = (context) => context?.http?.authInfo?.scopes?.includes('lighttable:edit') === true;
const withResult = (operation, { edit = false } = {}) => async (input, context) => {
  try {
    if (edit && !editable(context)) throw new Error('This tool requires the lighttable:edit scope.');
    return response(await operation(input));
  } catch (error) { return failure(error); }
};

const privateAddress = (address) => address === '::1' || address === '::' || address.startsWith('fc')
  || address.startsWith('fd') || address.startsWith('fe80:') || address.startsWith('127.')
  || address.startsWith('10.') || address.startsWith('192.168.')
  || /^172\.(1[6-9]|2\d|3[01])\./u.test(address) || address === '0.0.0.0';

const validateRemoteUrl = async (value) => {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) {
    throw new Error('Agent image URLs must use public HTTPS without credentials or a custom port.');
  }
  const addresses = isIP(url.hostname)
    ? [{ address: url.hostname }]
    : await lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => privateAddress(address.toLowerCase()))) {
    throw new Error('Private, loopback and link-local image URLs are not allowed.');
  }
  return url;
};

const downloadImage = async (value, fetchImpl = fetch, redirects = 0) => {
  if (redirects > 3) throw new Error('The image URL redirected too many times.');
  const url = await validateRemoteUrl(value);
  const result = await fetchImpl(url, { redirect: 'manual', signal: AbortSignal.timeout(30_000),
    headers: { accept: 'image/png,image/jpeg,image/webp,image/avif' } });
  if (result.status >= 300 && result.status < 400 && result.headers.get('location')) {
    return downloadImage(new URL(result.headers.get('location'), url).href, fetchImpl, redirects + 1);
  }
  if (!result.ok) throw new Error(`Image download failed with HTTP ${result.status}.`);
  const mediaType = (result.headers.get('content-type') ?? '').split(';')[0].trim();
  if (!['image/png', 'image/jpeg', 'image/webp', 'image/avif'].includes(mediaType)) {
    throw new Error(`Unsupported remote image type: ${mediaType || 'unknown'}.`);
  }
  const declared = Number(result.headers.get('content-length') ?? 0);
  if (declared > 32 * 1024 * 1024) throw new Error('The image exceeds the 32 MiB import limit.');
  const bytes = new Uint8Array(await result.arrayBuffer());
  if (bytes.byteLength > 32 * 1024 * 1024) throw new Error('The image exceeds the 32 MiB import limit.');
  return { bytes, mediaType, suggestedName: decodeURIComponent(url.pathname.split('/').at(-1) || 'agent-image') };
};

const commandIds = ['view.setZoom', 'layer.createRaster', 'layer.rename', 'layer.setVisibility',
  'layer.setFillOpacity', 'layer.style.setEnabled', 'layer.effect.setEnabled',
  'file.exportNative', 'file.exportPng', 'file.exportPsd', 'history.undo', 'history.redo'];

export const createLightTableMcpServer = (client, { fetchImpl = fetch } = {}) => {
  const server = new McpServer({ name: 'LightTable', version: '0.1.0' });
  server.registerTool('lighttable_workspace', {
    title: 'Inspect LightTable workspace', description: 'Lists open documents and the active stable document ID. Read-only.',
    inputSchema: z.object({}), annotations: { readOnlyHint: true }
  }, withResult(() => client.invoke('workspace.query')));
  server.registerTool('lighttable_document', {
    title: 'Inspect LightTable document', description: 'Returns canvas dimensions, revision, viewport, active layer, history and renderer status for one stable document ID.',
    inputSchema: z.object({ documentId: z.string().min(1) }), annotations: { readOnlyHint: true }
  }, withResult(({ documentId }) => client.invoke('document.query', { documentId })));
  server.registerTool('lighttable_layers', {
    title: 'List editable LightTable layers', description: 'Returns the compact editable layer tree with stable IDs, transforms, visibility, blend and type summaries.',
    inputSchema: z.object({ documentId: z.string().min(1) }), annotations: { readOnlyHint: true }
  }, withResult(({ documentId }) => client.invoke('layer.list', { documentId })));
  server.registerTool('lighttable_layer_effects', {
    title: 'Inspect layer effects', description: 'Returns canonical editable Layer Style settings for one layer.',
    inputSchema: z.object({ documentId: z.string().min(1), layerId: z.string().min(1) }),
    annotations: { readOnlyHint: true }
  }, withResult((input) => client.invoke('layer.effects', input)));
  server.registerTool('lighttable_capabilities', {
    title: 'List available document commands', description: 'Reports which typed LightTable commands are currently valid and why unavailable commands are disabled.',
    inputSchema: z.object({ documentId: z.string().min(1) }), annotations: { readOnlyHint: true }
  }, withResult(({ documentId }) => client.invoke('command.capabilities', { documentId })));
  server.registerTool('lighttable_execute', {
    title: 'Execute an undoable LightTable command',
    description: 'Executes one validated semantic command against an explicit document ID. Pass expectedDocumentRevision to reject stale edits.',
    inputSchema: z.object({ documentId: z.string().min(1), command: z.enum(commandIds),
      expectedDocumentRevision: z.number().int().nonnegative().optional(),
      parameters: z.record(z.string(), z.unknown()).default({}) }),
    annotations: { readOnlyHint: false, destructiveHint: false }
  }, withResult(({ documentId, command, parameters, expectedDocumentRevision }) =>
    client.invoke('command.execute', { documentId, command,
      commandRequestId: crypto.randomUUID(), commandParameters: parameters,
      ...(expectedDocumentRevision === undefined ? {} : { expectedDocumentRevision }) }), { edit: true }));
  server.registerTool('lighttable_gesture_begin', {
    title: 'Begin one LightTable gesture', description: 'Begins a bounded document-space brush, selection-rectangle or layer-translate gesture. Finish it to create one undo entry.',
    inputSchema: z.object({ documentId: z.string().min(1),
      kind: z.enum(['brush-stroke', 'selection-rectangle', 'layer-translate']),
      coordinateSpace: z.literal('document'), parameters: z.record(z.string(), z.unknown()).default({}),
      sample: z.object({ x: z.number().finite(), y: z.number().finite(), pressure: z.number().min(0).max(1).optional() }) })
  }, withResult((input) => client.invoke('gesture.begin', input), { edit: true }));
  server.registerTool('lighttable_gesture_update', {
    title: 'Update a LightTable gesture', description: 'Adds 1-64 document-space samples to an active bounded gesture.',
    inputSchema: z.object({ gestureId: z.string().min(1), samples: z.array(z.object({
      x: z.number().finite(), y: z.number().finite(), pressure: z.number().min(0).max(1).optional()
    })).min(1).max(64) })
  }, withResult((input) => client.invoke('gesture.update', input), { edit: true }));
  server.registerTool('lighttable_gesture_finish', {
    title: 'Finish a LightTable gesture', description: 'Commits or cancels a gesture. A committed gesture becomes one undo operation.',
    inputSchema: z.object({ gestureId: z.string().min(1), commit: z.boolean() })
  }, withResult((input) => client.invoke('gesture.finish', input), { edit: true }));
  server.registerTool('lighttable_import_image_url', {
    title: 'Import a generated or reference image',
    description: 'Downloads one public HTTPS PNG/JPEG/WebP/AVIF (maximum 32 MiB), registers it as a bounded input artifact and opens it in LightTable. Private-network URLs are rejected.',
    inputSchema: z.object({ url: z.string().url(), name: z.string().min(1).max(255).optional() })
  }, withResult(async ({ url, name }) => {
    const image = await downloadImage(url, fetchImpl);
    const artifact = await client.uploadArtifact({ bytes: image.bytes,
      name: name ?? image.suggestedName, mediaType: image.mediaType });
    const opened = await client.invoke('command.execute', { command: 'file.openArtifact',
      commandRequestId: crypto.randomUUID(), commandParameters: { artifactId: artifact.id } });
    return { artifact, opened };
  }, { edit: true }));
  server.registerTool('lighttable_preview', {
    title: 'Render a LightTable document preview',
    description: 'Uses LightTable’s real GPU/export path and returns a PNG tied to the current document revision.',
    inputSchema: z.object({ documentId: z.string().min(1) }), annotations: { readOnlyHint: true }
  }, async ({ documentId }) => {
    try {
      const command = await client.invoke('command.execute', { documentId, command: 'file.exportPng',
        commandRequestId: crypto.randomUUID(), commandParameters: {} });
      if (command.status !== 'accepted') throw new Error('Preview export did not start.');
      let task = null;
      for (let attempt = 0; attempt < 600; attempt += 1) {
        task = await client.invoke('task.query', { documentId, taskId: command.taskId });
        if (task?.status !== 'running') break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      if (task?.status !== 'completed' || !task.artifact?.id) throw new Error(task?.error ?? 'Preview export did not complete.');
      const artifact = await client.readArtifact(task.artifact.id);
      if (artifact.bytes.byteLength > 20 * 1024 * 1024) throw new Error('Preview exceeds the 20 MiB MCP response limit.');
      return { content: [
        { type: 'image', data: Buffer.from(artifact.bytes).toString('base64'), mimeType: artifact.mediaType },
        { type: 'text', text: JSON.stringify({ documentId, artifact: task.artifact }) }
      ] };
    } catch (error) { return failure(error); }
  });
  return server;
};

export { downloadImage, validateRemoteUrl };
