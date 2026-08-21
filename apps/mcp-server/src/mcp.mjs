import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { McpServer } from '@modelcontextprotocol/server';
import {
  LIGHTTABLE_COMMAND_DEFINITIONS,
  LIGHTTABLE_COMMAND_IDS,
  LIGHTTABLE_COMMAND_PARAMETER_PROPERTIES,
  LIGHTTABLE_COMMAND_EXAMPLES,
  LIGHTTABLE_COMMAND_SCHEMAS,
  LIGHTTABLE_COMMAND_SCHEMA_VERSION,
  LIGHTTABLE_EXTERNAL_MCP_BATCH_OPERATION_IDS,
  LIGHTTABLE_EXTERNAL_MCP_DEDICATED_COMMAND_IDS,
  LIGHTTABLE_EXTERNAL_MCP_EXECUTE_COMMAND_IDS,
  validateJsonSchemaValue
} from '@lighttable/command-contract';
import { z } from 'zod';

const response = (value) => ({
  content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  structuredContent: value
});
const failure = (error) => ({ isError: true, content: [{ type: 'text',
  text: error instanceof Error ? error.message : String(error) }] });
const editable = (context) => context?.http?.authInfo?.scopes?.includes('lighttable:edit') === true;
const dedicatedCommandIds = new Set(LIGHTTABLE_EXTERNAL_MCP_DEDICATED_COMMAND_IDS);
const dedicatedCommand = (command) => {
  if (!dedicatedCommandIds.has(command)) {
    throw new Error(`Dedicated MCP command ${command} is absent from the command catalog.`);
  }
  return command;
};
const createDocumentCommand = dedicatedCommand('document.create');
const createDocumentSchema = LIGHTTABLE_COMMAND_SCHEMAS[createDocumentCommand]?.input;
if (!createDocumentSchema) throw new Error('document.create requires a complete shared schema.');
const openArtifactCommand = dedicatedCommand('file.openArtifact');
const srgbToLinear = (value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
const hexLinearRgba = (hex) => [1, 3, 5]
  .map((offset) => srgbToLinear(Number.parseInt(hex.slice(offset, offset + 2), 16) / 255)).concat(1);
const withResult = (operation, { edit = false } = {}) => async (input, context) => {
  try {
    if (edit && !editable(context)) throw new Error('This tool requires the lighttable:edit scope.');
    return response(await operation(input));
  } catch (error) { return failure(error); }
};
const createDocumentInput = z.object({
  name: z.string().min(1).max(255),
  width: z.number().int().min(1).max(32768),
  height: z.number().int().min(1).max(32768),
  resolutionPpi: z.number().min(1).max(2400),
  bitDepth: z.union([z.literal(8), z.literal(16)]),
  profile: z.enum(['srgb', 'adobe-rgb-1998']),
  background: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('transparent') }).strict(),
    z.object({ kind: z.literal('solid'), color: z.string().regex(/^#[0-9a-fA-F]{6}$/u) }).strict()
  ])
}).strict().superRefine((value, context) => {
  const validation = validateJsonSchemaValue(createDocumentSchema, value);
  if (!validation.valid) {
    for (const issue of validation.issues) context.addIssue({ code: 'custom',
      path: issue.path, message: issue.message });
  }
  if (value.width * value.height > 268_435_456) context.addIssue({ code: 'custom',
    path: ['width'], message: 'Document dimensions may contain at most 268435456 pixels.' });
});
const awaitCommand = async (client, request, timeoutMs = 60_000) => {
  const result = await client.invoke('command.execute', request);
  if (result?.status !== 'accepted' || !result.taskId) return result;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const task = await client.invoke('task.query', { documentId: request.documentId, taskId: result.taskId });
    if (task?.status === 'failed' || task?.status === 'canceled' || task?.status === 'cancelled') {
      throw new Error(task.error ?? `LightTable task ${result.taskId} ${task.status}.`);
    }
    if (task?.status !== 'running') return { ...result, task };
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`LightTable task ${result.taskId} timed out.`);
};

const awaitDocumentRenderer = async (client, documentId, timeoutMs = 60_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const document = await client.invoke('document.query', { documentId });
    if (document?.renderer?.active && document.renderer.status === 'ready') return document;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`LightTable document ${documentId} did not acquire an active renderer.`);
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
    title: 'List editable LightTable layers',
    description: 'Returns one compact revision-bound page of the editable layer tree. Follow nextCursor; use targeted content queries for text, vector, effects, Grade or Warp details.',
    inputSchema: z.object({ documentId: z.string().min(1),
      expectedDocumentRevision: z.number().int().nonnegative().optional(),
      cursor: z.string().max(1024).optional(), limit: z.number().int().min(1).max(256).default(128) }),
    annotations: { readOnlyHint: true }
  }, withResult((input) => client.invoke('layer.list', input)));
  server.registerTool('lighttable_layer', {
    title: 'Inspect a LightTable layer',
    description: 'Returns a compact type-dispatched content summary for an explicit stable layer ID, or the current active layer when layerId is omitted. The result identifies targeted detail queries and previews without embedding unbounded pixels, geometry or adjustment settings.',
    inputSchema: z.object({ documentId: z.string().min(1), layerId: z.string().min(1).optional(),
      expectedDocumentRevision: z.number().int().nonnegative().optional() }),
    annotations: { readOnlyHint: true }
  }, withResult((input) => client.invoke('layer.query', input)));
  server.registerTool('lighttable_layer_effects', {
    title: 'Inspect layer effects', description: 'Returns canonical editable Layer Style settings for one layer.',
    inputSchema: z.object({ documentId: z.string().min(1), layerId: z.string().min(1) }),
    annotations: { readOnlyHint: true }
  }, withResult((input) => client.invoke('layer.effects', input)));
  server.registerTool('lighttable_text', {
    title: 'Inspect editable text',
    description: 'Returns bounded editable content, layout, run summaries and font availability without font bytes.',
    inputSchema: z.object({ documentId: z.string().min(1), layerId: z.string().min(1) }),
    annotations: { readOnlyHint: true }
  }, withResult((input) => client.invoke('text.query', input)));
  server.registerTool('lighttable_vector', {
    title: 'Inspect editable vector content',
    description: 'Returns bounded canonical live-shape/path geometry, transforms, fills, gradients and strokes.',
    inputSchema: z.object({ documentId: z.string().min(1), layerId: z.string().min(1) }),
    annotations: { readOnlyHint: true }
  }, withResult((input) => client.invoke('vector.query', input)));
  server.registerTool('lighttable_warp', {
    title: 'Inspect editable Warp recipe',
    description: 'Returns bounded non-destructive Warp settings and layer-source strokes for one raster layer.',
    inputSchema: z.object({ documentId: z.string().min(1), layerId: z.string().min(1) }),
    annotations: { readOnlyHint: true }
  }, withResult((input) => client.invoke('warp.query', input)));
  server.registerTool('lighttable_grade', {
    title: 'Inspect basic Grade values',
    description: 'Returns the 14 canonical basic Grade controls for an explicit document or layer target. Read-only.',
    inputSchema: z.object({
      documentId: z.string().min(1),
      target: z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('document') }),
        z.object({ kind: z.literal('layer'), layerId: z.string().min(1) })
      ])
    }),
    annotations: { readOnlyHint: true }
  }, withResult((input) => client.invoke('grade.queryBasic', input)));
  server.registerTool('lighttable_adjustment', {
    title: 'Inspect LightTable adjustments',
    description: 'Returns bounded known canonical processing parameters, enabled state, revisions and default/non-default value state for document processing, one layer, or one attached adjustment. Unknown renderer settings and LUT bytes are never serialized.',
    inputSchema: z.object({
      documentId: z.string().min(1),
      expectedDocumentRevision: z.number().int().nonnegative().optional(),
      target: z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('document'), owner: z.enum(['grade', 'lens-fx']) }),
        z.object({ kind: z.literal('layer'), layerId: z.string().min(1).max(512) }),
        z.object({ kind: z.literal('attached'), layerId: z.string().min(1).max(512),
          adjustmentId: z.string().min(1).max(512) })
      ])
    }),
    annotations: { readOnlyHint: true }
  }, withResult((input) => client.invoke('adjustment.query', input)));
  server.registerTool('lighttable_capabilities', {
    title: 'List available document commands', description: 'Reports which typed LightTable commands are currently valid and why unavailable commands are disabled.',
    inputSchema: z.object({ documentId: z.string().min(1) }), annotations: { readOnlyHint: true }
  }, withResult(async ({ documentId }) => ({
    documentId,
    commands: await client.invoke('command.capabilities', { documentId })
  })));
  server.registerTool('lighttable_commands', {
    title: 'Discover LightTable commands',
    description: 'Returns the canonical command metadata and parameter properties shared with the local Actions browser.',
    inputSchema: z.object({ command: z.enum(LIGHTTABLE_COMMAND_IDS).optional() }),
    annotations: { readOnlyHint: true }
  }, withResult(({ command }) => {
    const definitions = command
      ? LIGHTTABLE_COMMAND_DEFINITIONS.filter(({ id }) => id === command)
      : LIGHTTABLE_COMMAND_DEFINITIONS;
    return { protocolVersion: 1, commands: definitions.map((definition) => ({
      ...definition, parameters: LIGHTTABLE_COMMAND_PARAMETER_PROPERTIES[definition.id],
      examples: LIGHTTABLE_COMMAND_EXAMPLES[definition.id] ?? [],
      contract: LIGHTTABLE_COMMAND_SCHEMAS[definition.id]
        ? { status: 'complete', schemaVersion: LIGHTTABLE_COMMAND_SCHEMA_VERSION,
          ...LIGHTTABLE_COMMAND_SCHEMAS[definition.id] }
        : { status: 'legacy-properties-only' }
    })) };
  }));
  const executeInputSchema = z.object({
    documentId: z.string().min(1),
    command: z.enum(LIGHTTABLE_EXTERNAL_MCP_EXECUTE_COMMAND_IDS),
    expectedDocumentRevision: z.number().int().nonnegative().optional(),
    parameters: z.record(z.string(), z.unknown()).default({})
  }).superRefine(({ command, parameters }, context) => {
    const schema = LIGHTTABLE_COMMAND_SCHEMAS[command]?.input;
    if (!schema) return;
    const validation = validateJsonSchemaValue(schema, parameters);
    for (const issue of validation.issues) context.addIssue({
      code: 'custom', path: ['parameters', ...issue.path], message: issue.message
    });
  });
  server.registerTool('lighttable_execute', {
    title: 'Execute an undoable LightTable command',
    description: 'Executes one validated semantic command against an explicit document ID. Pass expectedDocumentRevision to reject stale edits.',
    inputSchema: executeInputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false }
  }, withResult(({ documentId, command, parameters, expectedDocumentRevision }) =>
    client.invoke('command.execute', { documentId, command,
      commandRequestId: crypto.randomUUID(), commandParameters: parameters,
      ...(expectedDocumentRevision === undefined ? {} : { expectedDocumentRevision }) }), { edit: true }));
  server.registerTool('lighttable_batch', {
    title: 'Execute an atomic LightTable command batch',
    description: 'Runs up to 64 semantic edits as one publication and one named undo entry. Failure or cancellation publishes nothing. Query command.batch through lighttable_commands for the complete on-demand operation schema.',
    inputSchema: z.object({ documentId: z.string().min(1), name: z.string().min(1).max(128),
      timeoutMs: z.number().int().min(100).max(10_000).default(5_000),
      expectedDocumentRevision: z.number().int().nonnegative().optional(),
      operations: z.array(z.object({ operationId: z.string().min(1).max(128),
        command: z.enum(LIGHTTABLE_EXTERNAL_MCP_BATCH_OPERATION_IDS),
        parameters: z.record(z.string(), z.unknown()) })).min(1).max(64) }).superRefine(({
          name, timeoutMs, operations
        }, context) => {
          const validation = validateJsonSchemaValue(
            LIGHTTABLE_COMMAND_SCHEMAS['command.batch'].input,
            { name, timeoutMs, operations }
          );
          for (const issue of validation.issues) context.addIssue({
            code: 'custom', path: issue.path, message: issue.message
          });
        })
  }, withResult(({ documentId, name, timeoutMs, operations, expectedDocumentRevision }) =>
    client.invoke('command.execute', { documentId, command: 'command.batch',
      commandRequestId: crypto.randomUUID(), commandParameters: { name, operations,
        ...(timeoutMs === undefined ? {} : { timeoutMs }) },
      ...(expectedDocumentRevision === undefined ? {} : { expectedDocumentRevision }) }), { edit: true }));
  server.registerTool('lighttable_task_events', {
    title: 'Poll LightTable agent activity',
    description: 'Returns bounded task events after a reconnect-safe cursor.',
    inputSchema: z.object({ afterCursor: z.number().int().nonnegative().default(0),
      limit: z.number().int().min(1).max(200).default(100) }), annotations: { readOnlyHint: true }
  }, withResult((input) => client.invoke('task.events', input)));
  server.registerTool('lighttable_task', {
    title: 'Inspect a LightTable task',
    description: 'Returns bounded status, progress, error and artifact metadata for one explicit document task.',
    inputSchema: z.object({
      documentId: z.string().min(1),
      taskId: z.string().min(1)
    }),
    annotations: { readOnlyHint: true }
  }, withResult((input) => client.invoke('task.query', input)));
  server.registerTool('lighttable_events', {
    title: 'Inspect LightTable publication events',
    description: 'Returns bounded document, revision, selection, history, task and renderer publications after a reconnect-safe cursor. A gap requires canonical re-query.',
    inputSchema: z.object({ afterCursor: z.number().int().nonnegative().default(0),
      limit: z.number().int().min(1).max(200).default(100) }),
    annotations: { readOnlyHint: true }
  }, withResult((input) => client.invoke('event.query', input)));
  server.registerTool('lighttable_wait_for_events', {
    title: 'Wait for LightTable publication events',
    description: 'Waits up to 10 seconds for bounded document, revision, selection, history, task or renderer publications after a reconnect-safe cursor. Returns immediately for queued events or a cursor gap.',
    inputSchema: z.object({ afterCursor: z.number().int().nonnegative(),
      limit: z.number().int().min(1).max(200).default(100),
      timeoutMs: z.number().int().min(0).max(10_000).default(10_000) }),
    annotations: { readOnlyHint: true }
  }, withResult((input) => client.invoke('event.wait', input)));
  server.registerTool('lighttable_cancel_task', {
    title: 'Cancel a LightTable task',
    inputSchema: z.object({ documentId: z.string().min(1), taskId: z.string().min(1) })
  }, withResult(({ documentId, taskId }) => client.invoke('command.execute', { documentId,
    command: 'task.cancel', commandRequestId: crypto.randomUUID(), commandParameters: { taskId } }), { edit: true }));
  server.registerTool('lighttable_create_document', {
    title: 'Create a LightTable document',
    description: 'Creates one document with explicit canvas, resolution, bit depth, profile and background semantics.',
    inputSchema: createDocumentInput
  }, withResult(({ name, width, height, resolutionPpi, bitDepth, profile, background }) =>
    client.invoke('command.execute', {
      command: createDocumentCommand, commandRequestId: crypto.randomUUID(),
      commandParameters: { name, width, height, resolutionPpi, bitDepth, profile, background }
    }), { edit: true }));
  server.registerTool('lighttable_build_social_design', {
    title: 'Build a layered social design',
    description: 'Creates a deterministic 1080×1350 editable design with gradient vector, point and paragraph text, optional placed asset and Layer Style, then prepares native and PSD exports.',
    inputSchema: z.object({ name: z.string().min(1).max(128).default('Agent social design'),
      assetId: z.string().min(1).max(256).optional(), title: z.string().min(1).max(256).default('MAKE SOMETHING BOLD'),
      body: z.string().min(1).max(2_000).default('Editable type, vectors, gradients and effects—built as real LightTable layers.') })
  }, withResult(async ({ name, assetId, title, body }) => {
    await client.invoke('command.execute', { command: createDocumentCommand, commandRequestId: crypto.randomUUID(),
      commandParameters: { name, width: 1080, height: 1350, resolutionPpi: 72, bitDepth: 8,
        profile: 'srgb', background: { kind: 'solid', color: '#101424' } } });
    const workspace = await client.invoke('workspace.query'); const documentId = workspace.activeDocumentId;
    if (!documentId) throw new Error('The created design did not become active.');
    await awaitDocumentRenderer(client, documentId);
    if (assetId) await client.invoke('command.execute', { documentId, command: 'layer.placeArtifact',
      commandRequestId: crypto.randomUUID(), commandParameters: { artifactId: assetId,
        name: 'Placed artwork', x: 690, y: 160 } });
    const gradient = { kind: 'gradient', asset: { id: 'agent-gradient', name: 'Agent violet', type: 'solid', smoothness: 1,
      colorStops: [
        { id: 'violet', position: 0, midpoint: 0.5, color: { r: 0.38, g: 0.18, b: 0.95, a: 1 } },
        { id: 'pink', position: 1, midpoint: 0.5, color: { r: 1, g: 0.2, b: 0.55, a: 1 } }
      ], opacityStops: [
        { id: 'opaque-a', position: 0, midpoint: 0.5, opacity: 1 },
        { id: 'opaque-b', position: 1, midpoint: 0.5, opacity: 1 }
      ], roughness: 0, seed: 0 }, shape: 'linear', coordinateSpace: 'object-bounds',
      transform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0.5 }, reverse: false, dither: true,
      interpolation: 'perceptual' };
    const operations = [
      { operationId: 'gradient-card', command: 'vector.create', parameters: { name: 'Gradient card',
        primitive: { kind: 'rectangle', x: 70, y: 80, width: 940, height: 1190 },
        style: { fill: gradient, stroke: null, opacity: 1 } } },
      { operationId: 'title', command: 'text.create', parameters: { mode: 'point', text: title,
        origin: { x: 130, y: 260 }, writingMode: 'horizontal-tb',
        style: { font: { assetId: 'lighttable-inter-latin-regular', family: 'Inter', style: 'Regular' }, fontSize: 82,
          fill: { enabled: true, color: '#ffffff' } } } },
      { operationId: 'copy', command: 'text.create', parameters: { mode: 'paragraph', text: body,
        origin: { x: 130, y: 410 }, frame: { width: 720, height: 360 }, writingMode: 'horizontal-tb',
        style: { font: { assetId: 'lighttable-inter-latin-regular', family: 'Inter', style: 'Regular' }, fontSize: 42,
          fill: { enabled: true, color: '#f3ecff' } } } },
      { operationId: 'title-shadow', command: 'layer.effect.add', parameters: {
        layerId: { resultOf: 'title', field: 'layerId' }, effectKind: 'drop-shadow',
        settings: { enabled: true, opacity: 0.55, distance: 30, size: 30, angle: 135 } } }
    ];
    const batch = await awaitCommand(client, { documentId, command: 'command.batch', commandRequestId: crypto.randomUUID(),
      commandParameters: { name, timeoutMs: 10_000, operations } });
    if (batch?.status === 'rejected' || batch?.task?.status === 'failed') throw new Error(batch.message ?? batch.task?.error ?? 'Design batch failed.');
    await awaitDocumentRenderer(client, documentId);
    const layerPage = await client.invoke('layer.list', { documentId });
    const layers = Array.isArray(layerPage) ? layerPage : layerPage?.layers ?? [];
    const titleLayer = layers.find((layer) => layer?.type === 'text' && layer?.name === title);
    if (!titleLayer?.id) throw new Error('The editable title layer was not published by the design transaction.');
    const revision = await awaitCommand(client, { documentId, command: 'layer.setFillOpacity',
      commandRequestId: crypto.randomUUID(), commandParameters: { layerId: titleLayer.id, opacity: 0.98 } });
    const undo = await awaitCommand(client, { documentId, command: 'history.undo',
      commandRequestId: crypto.randomUUID(), commandParameters: {} });
    const redo = await awaitCommand(client, { documentId, command: 'history.redo',
      commandRequestId: crypto.randomUUID(), commandParameters: {} });
    await awaitDocumentRenderer(client, documentId);
    const preview = await awaitCommand(client, { documentId, command: 'file.exportPng',
      commandRequestId: crypto.randomUUID(), commandParameters: {} });
    const psd = await awaitCommand(client, { documentId, command: 'file.exportPsd', commandRequestId: crypto.randomUUID(), commandParameters: {} });
    const native = await awaitCommand(client, { documentId, command: 'file.exportNative', commandRequestId: crypto.randomUUID(), commandParameters: {} });
    return { documentId, transaction: name, layerKinds: ['asset', 'point-text', 'paragraph-text', 'gradient-vector', 'drop-shadow'],
      batch, revision, undo, redo, preview: preview?.task?.artifact ?? preview?.value ?? null,
      native: native?.task?.artifact ?? native?.value ?? null, psd: psd?.task?.artifact ?? psd?.value ?? null };
  }, { edit: true }));
  server.registerTool('lighttable_create_text', {
    title: 'Create editable text',
    description: 'Creates point or paragraph text through LightTable’s WYSIWYG text model and GPU renderer.',
    inputSchema: z.object({ documentId: z.string().min(1), mode: z.enum(['point', 'paragraph']),
      text: z.string().max(1_000_000), x: z.number().finite(), y: z.number().finite(),
      width: z.number().positive().max(10_000_000).optional(), height: z.number().positive().max(10_000_000).optional(),
      fontAssetId: z.string().min(1).max(255).optional(), family: z.string().min(1).max(255).optional(),
      fontStyle: z.string().min(1).max(255).optional(), fontSize: z.number().positive().max(100_000).optional(),
      fill: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
      writingMode: z.enum(['horizontal-tb', 'vertical-rl', 'vertical-lr']).default('horizontal-tb'),
      expectedDocumentRevision: z.number().int().nonnegative().optional() })
  }, withResult(({ documentId, mode, text, x, y, width, height, fontAssetId, family,
    fontStyle, fontSize, fill, writingMode, expectedDocumentRevision }) => {
    if (mode === 'paragraph' && (!width || !height)) throw new Error('Paragraph text requires width and height.');
    return client.invoke('command.execute', { documentId, command: 'text.create',
      commandRequestId: crypto.randomUUID(), ...(expectedDocumentRevision === undefined ? {} : { expectedDocumentRevision }),
      commandParameters: { mode, text, origin: { x, y }, writingMode,
        ...(mode === 'paragraph' ? { frame: { width, height } } : {}),
        ...((fontAssetId || family || fontStyle || fontSize || fill) ? { style: {
          ...((fontAssetId || family || fontStyle) ? { font: { ...(fontAssetId ? { assetId: fontAssetId } : {}),
            ...(family ? { family } : {}), ...(fontStyle ? { style: fontStyle } : {}) } } : {}),
          ...(fontSize ? { fontSize } : {}), ...(fill ? { fill: { enabled: true, color: fill } } : {})
        } } : {}) } });
  }, { edit: true }));
  server.registerTool('lighttable_edit_text', {
    title: 'Edit or format text',
    description: 'Atomically replaces a Unicode-safe range or applies common character and paragraph properties.',
    inputSchema: z.object({ documentId: z.string().min(1), layerId: z.string().min(1),
      operation: z.enum(['replace', 'format']), start: z.number().int().nonnegative().optional(),
      end: z.number().int().nonnegative().optional(), text: z.string().max(1_000_000).optional(),
      fontAssetId: z.string().min(1).max(255).optional(), fontSize: z.number().positive().max(100_000).optional(),
      fill: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(), tracking: z.number().min(-10_000).max(100_000).optional(),
      syntheticBold: z.boolean().optional(), syntheticItalic: z.boolean().optional(),
      underline: z.boolean().optional(),
      alignment: z.enum(['start', 'center', 'end', 'justify']).optional(),
      expectedDocumentRevision: z.number().int().nonnegative().optional() })
  }, withResult(({ documentId, layerId, operation, start, end, text, fontAssetId, fontSize,
    fill, tracking, syntheticBold, syntheticItalic, underline, alignment,
    expectedDocumentRevision }) => {
    if (operation === 'replace' && (start === undefined || end === undefined || text === undefined)) {
      throw new Error('Range replacement requires start, end and text.');
    }
    return client.invoke('command.execute', { documentId,
      command: operation === 'replace' ? 'text.replaceRange' : 'text.format',
      commandRequestId: crypto.randomUUID(), ...(expectedDocumentRevision === undefined ? {} : { expectedDocumentRevision }),
      commandParameters: operation === 'replace' ? { layerId, start, end, text } : { layerId,
        ...(start === undefined || end === undefined ? {} : { start, end }), style: {
          ...(fontAssetId ? { font: { assetId: fontAssetId } } : {}), ...(fontSize ? { fontSize } : {}),
          ...(fill ? { fill: { enabled: true, color: fill } } : {}),
          ...(tracking === undefined ? {} : { tracking }),
          ...(syntheticBold === undefined ? {} : { syntheticBold }),
          ...(syntheticItalic === undefined ? {} : { syntheticItalic }),
          ...(underline === undefined ? {} : { underline })
        }, ...(alignment ? { paragraph: { alignment } } : {}) } });
  }, { edit: true }));
  server.registerTool('lighttable_create_shape', {
    title: 'Create an editable vector shape',
    description: 'Creates a canonical rectangle, ellipse, star or line with optional solid fill and stroke.',
    inputSchema: z.object({ documentId: z.string().min(1), layerId: z.string().min(1).optional(),
      shape: z.enum(['rectangle', 'ellipse', 'star', 'line']), name: z.string().min(1).max(255).optional(),
      x: z.number().finite(), y: z.number().finite(), width: z.number().nonnegative().max(10_000_000),
      height: z.number().nonnegative().max(10_000_000), points: z.number().int().min(3).max(2048).default(5),
      innerRatio: z.number().min(0).max(1).default(0.5), fillEnabled: z.boolean().default(true),
      fill: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#000000'),
      strokeEnabled: z.boolean().default(false), stroke: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#000000'),
      strokeWidth: z.number().nonnegative().max(100_000).default(1),
      expectedDocumentRevision: z.number().int().nonnegative().optional() })
  }, withResult(({ documentId, layerId, shape, name, x, y, width, height, points, innerRatio,
    fillEnabled, fill, strokeEnabled, stroke, strokeWidth, expectedDocumentRevision }) => {
    const primitive = shape === 'star'
      ? { kind: 'star', cx: x, cy: y, points, outerRadius: width,
        innerRadius: width * innerRatio, rotationRadians: -Math.PI / 2 }
      : shape === 'line' ? { kind: 'line', x1: x, y1: y, x2: x + width, y2: y + height }
        : { kind: shape, x, y, width, height };
    return client.invoke('command.execute', { documentId, command: 'vector.create',
      commandRequestId: crypto.randomUUID(), ...(expectedDocumentRevision === undefined ? {} : { expectedDocumentRevision }),
      commandParameters: { ...(layerId ? { layerId } : {}), ...(name ? { name } : {}), primitive,
        style: { fill: fillEnabled ? { type: 'solid', color: hexLinearRgba(fill) } : null,
          stroke: strokeEnabled ? { paint: { type: 'solid', color: hexLinearRgba(stroke) }, width: strokeWidth,
            alignment: 'center', cap: 'butt', join: 'miter', miterLimit: 4, dash: [], dashOffset: 0 } : null } } });
  }, { edit: true }));
  server.registerTool('lighttable_edit_vector', {
    title: 'Edit or remove vector content',
    description: 'Updates canonical vector name, transform, solid fill/stroke or removes one stable element ID.',
    inputSchema: z.object({ documentId: z.string().min(1), layerId: z.string().min(1), elementId: z.string().min(1),
      remove: z.boolean().default(false), name: z.string().min(1).max(255).optional(),
      transform: z.object({ a: z.number().finite(), b: z.number().finite(), c: z.number().finite(),
        d: z.number().finite(), tx: z.number().finite(), ty: z.number().finite() }).optional(),
      fillEnabled: z.boolean().optional(), fill: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
      strokeEnabled: z.boolean().optional(), stroke: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
      strokeWidth: z.number().nonnegative().max(100_000).optional(),
      expectedDocumentRevision: z.number().int().nonnegative().optional() })
  }, withResult(({ documentId, layerId, elementId, remove, name, transform, fillEnabled, fill,
    strokeEnabled, stroke, strokeWidth, expectedDocumentRevision }) => {
    const style = { ...(fillEnabled === undefined && !fill ? {} : {
      fill: fillEnabled === false ? null : { type: 'solid', color: hexLinearRgba(fill ?? '#000000') } }),
      ...(strokeEnabled === undefined && !stroke && strokeWidth === undefined ? {} : {
        stroke: strokeEnabled === false ? null : { paint: { type: 'solid', color: hexLinearRgba(stroke ?? '#000000') },
          width: strokeWidth ?? 1, alignment: 'center', cap: 'butt', join: 'miter', miterLimit: 4,
          dash: [], dashOffset: 0 } }) };
    return client.invoke('command.execute', { documentId, command: remove ? 'vector.remove' : 'vector.update',
      commandRequestId: crypto.randomUUID(), ...(expectedDocumentRevision === undefined ? {} : { expectedDocumentRevision }),
      commandParameters: { layerId, elementId, ...(name ? { name } : {}), ...(transform ? { transform } : {}),
        ...(Object.keys(style).length ? { style } : {}) } });
  }, { edit: true }));
  server.registerTool('lighttable_layer_style', {
    title: 'Edit Layer Styles',
    description: 'Adds, updates, removes, reorders or toggles a validated canonical Layer Style effect.',
    inputSchema: z.object({ documentId: z.string().min(1), layerId: z.string().min(1),
      operation: z.enum(['add', 'update', 'remove', 'move', 'toggle']), effectId: z.string().min(1).optional(),
      effectKind: z.enum(['drop-shadow', 'inner-shadow', 'outer-glow', 'inner-glow', 'bevel-emboss',
        'color-overlay', 'gradient-overlay', 'pattern-overlay', 'satin', 'stroke']).optional(),
      settings: z.record(z.string(), z.unknown()).optional(), targetIndex: z.number().int().min(0).max(63).optional(),
      enabled: z.boolean().optional(), expectedDocumentRevision: z.number().int().nonnegative().optional() })
  }, withResult(({ documentId, layerId, operation, effectId, effectKind, settings, targetIndex,
    enabled, expectedDocumentRevision }) => {
    if (operation === 'add' && !effectKind) throw new Error('Adding an effect requires effectKind.');
    if (operation !== 'add' && !effectId) throw new Error(`${operation} requires effectId.`);
    if (operation === 'move' && targetIndex === undefined) throw new Error('Moving an effect requires targetIndex.');
    if (operation === 'toggle' && enabled === undefined) throw new Error('Toggling an effect requires enabled.');
    const command = operation === 'toggle' ? 'layer.effect.setEnabled' : `layer.effect.${operation}`;
    return client.invoke('command.execute', { documentId, command, commandRequestId: crypto.randomUUID(),
      ...(expectedDocumentRevision === undefined ? {} : { expectedDocumentRevision }),
      commandParameters: { layerId, ...(effectId ? { effectId } : {}), ...(effectKind ? { effectKind } : {}),
        ...(settings ? { settings } : {}), ...(targetIndex === undefined ? {} : { targetIndex }),
        ...(enabled === undefined ? {} : { enabled }) } });
  }, { edit: true }));
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
    description: 'Downloads one public HTTPS image (maximum 32 MiB), registers it as a bounded input artifact, then opens it or places PNG/JPEG/WebP into an explicit document. Private-network URLs are rejected.',
    inputSchema: z.object({ url: z.string().url(), name: z.string().min(1).max(255).optional(),
      documentId: z.string().min(1).optional(), x: z.number().finite().optional(), y: z.number().finite().optional() })
      .refine(({ documentId, x, y }) => documentId !== undefined || (x === undefined && y === undefined), {
        message: 'Placement coordinates require a target documentId.'
      })
  }, withResult(async ({ url, name, documentId, x, y }) => {
    const image = await downloadImage(url, fetchImpl);
    const artifact = await client.uploadArtifact({ bytes: image.bytes,
      name: name ?? image.suggestedName, mediaType: image.mediaType });
    if (documentId && image.mediaType === 'image/avif') throw new Error('Placed images must be PNG, JPEG or WebP.');
    const result = await client.invoke('command.execute', {
      ...(documentId ? { documentId } : {}),
      command: documentId ? 'layer.placeArtifact' : openArtifactCommand,
      commandRequestId: crypto.randomUUID(), commandParameters: {
        artifactId: artifact.id, ...(documentId && name ? { name } : {}),
        ...(documentId && x !== undefined ? { x } : {}),
        ...(documentId && y !== undefined ? { y } : {})
      }
    });
    return { artifact, result };
  }, { edit: true }));
  server.registerTool('lighttable_preview', {
    title: 'Render a LightTable document preview',
    description: 'Returns a bounded lossless PNG or quality-controlled WebP from LightTable’s GPU preview path for exactly the requested canonical document revision. Pass knownArtifactId to receive metadata only when unchanged.',
    inputSchema: z.object({ documentId: z.string().min(1),
      expectedDocumentRevision: z.number().int().nonnegative(),
      maxEdge: z.number().int().min(64).max(1024).default(1024),
      format: z.enum(['png', 'webp']).default('png'),
      quality: z.number().min(0.1).max(1).optional(),
      knownArtifactId: z.string().min(1).max(256).optional() }),
    annotations: { readOnlyHint: true }
  }, async ({ documentId, expectedDocumentRevision, maxEdge, format, quality, knownArtifactId }) => {
    try {
      const preview = await client.invoke('document.preview', {
        documentId, expectedDocumentRevision, maxEdge, format, quality
      });
      if (preview?.status !== 'completed' || !preview.artifact?.id) {
        throw new Error(preview?.message ?? 'Preview rendering did not complete.');
      }
      if (knownArtifactId === preview.artifact.id) return response({ documentId,
        canonicalRevision: expectedDocumentRevision, artifact: preview.artifact,
        reused: true, unchanged: true });
      const artifact = await client.readArtifact(preview.artifact.id);
      if (artifact.bytes.byteLength > 20 * 1024 * 1024) throw new Error('Preview exceeds the 20 MiB MCP response limit.');
      return { content: [
        { type: 'image', data: Buffer.from(artifact.bytes).toString('base64'), mimeType: artifact.mediaType },
        { type: 'text', text: JSON.stringify({ documentId,
          canonicalRevision: expectedDocumentRevision, artifact: preview.artifact,
          reused: preview.reused }) }
      ] };
    } catch (error) { return failure(error); }
  });
  server.registerTool('lighttable_layer_preview', {
    title: 'Render isolated LightTable layer content',
    description: 'Returns a bounded lossless PNG or quality-controlled WebP of one layer pixel source or raster mask for exactly one canonical document revision. Pass knownArtifactId to avoid unchanged image transfer. It does not stream the canvas or change the artist viewport.',
    inputSchema: z.object({ documentId: z.string().min(1), layerId: z.string().min(1),
      channel: z.enum(['pixels', 'mask']).default('pixels'),
      expectedDocumentRevision: z.number().int().nonnegative(),
      maxEdge: z.number().int().min(64).max(1024).default(1024),
      format: z.enum(['png', 'webp']).default('png'),
      quality: z.number().min(0.1).max(1).optional(),
      knownArtifactId: z.string().min(1).max(256).optional() }),
    annotations: { readOnlyHint: true }
  }, async (input) => {
    try {
      const preview = await client.invoke('layer.preview', input);
      if (preview?.status !== 'completed' || !preview.artifact?.id) {
        throw new Error(preview?.message ?? 'Layer preview rendering did not complete.');
      }
      if (input.knownArtifactId === preview.artifact.id) return response({
        documentId: input.documentId, layerId: input.layerId, channel: input.channel,
        canonicalRevision: input.expectedDocumentRevision, artifact: preview.artifact,
        reused: true, unchanged: true
      });
      const artifact = await client.readArtifact(preview.artifact.id);
      if (artifact.bytes.byteLength > 20 * 1024 * 1024) {
        throw new Error('Layer preview exceeds the 20 MiB MCP response limit.');
      }
      return { content: [
        { type: 'image', data: Buffer.from(artifact.bytes).toString('base64'), mimeType: artifact.mediaType },
        { type: 'text', text: JSON.stringify({ documentId: input.documentId,
          layerId: input.layerId, channel: input.channel,
          canonicalRevision: input.expectedDocumentRevision,
          artifact: preview.artifact, reused: preview.reused }) }
      ] };
    } catch (error) { return failure(error); }
  });
  server.registerTool('lighttable_region_preview', {
    title: 'Render a LightTable document region',
    description: 'Returns a bounded lossless PNG or quality-controlled WebP for an exact document-pixel region of one canonical revision. It uses the same final-composite crop owner as Copy Merged without changing selection or viewport.',
    inputSchema: z.object({ documentId: z.string().min(1),
      region: z.object({ x: z.number().nonnegative(), y: z.number().nonnegative(),
        width: z.number().positive(), height: z.number().positive() }),
      expectedDocumentRevision: z.number().int().nonnegative(),
      maxEdge: z.number().int().min(64).max(1024).default(1024),
      format: z.enum(['png', 'webp']).default('png'),
      quality: z.number().min(0.1).max(1).optional(),
      knownArtifactId: z.string().min(1).max(256).optional() }),
    annotations: { readOnlyHint: true }
  }, async (input) => {
    try {
      const preview = await client.invoke('document.preview', input);
      if (preview?.status !== 'completed' || !preview.artifact?.id) {
        throw new Error(preview?.message ?? 'Region preview rendering did not complete.');
      }
      if (input.knownArtifactId === preview.artifact.id) return response({
        documentId: input.documentId, region: input.region,
        canonicalRevision: input.expectedDocumentRevision, artifact: preview.artifact,
        reused: true, unchanged: true
      });
      const artifact = await client.readArtifact(preview.artifact.id);
      if (artifact.bytes.byteLength > 20 * 1024 * 1024) {
        throw new Error('Region preview exceeds the 20 MiB MCP response limit.');
      }
      return { content: [
        { type: 'image', data: Buffer.from(artifact.bytes).toString('base64'), mimeType: artifact.mediaType },
        { type: 'text', text: JSON.stringify({ documentId: input.documentId,
          region: input.region, canonicalRevision: input.expectedDocumentRevision,
          artifact: preview.artifact, reused: preview.reused }) }
      ] };
    } catch (error) { return failure(error); }
  });
  return server;
};

export { downloadImage, validateRemoteUrl };
