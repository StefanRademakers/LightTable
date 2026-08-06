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
const srgbToLinear = (value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
const hexLinearRgba = (hex) => [1, 3, 5]
  .map((offset) => srgbToLinear(Number.parseInt(hex.slice(offset, offset + 2), 16) / 255)).concat(1);
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

const commandIds = ['view.setZoom', 'layer.createRaster', 'layer.placeArtifact', 'layer.rename', 'layer.setVisibility',
  'layer.setFillOpacity', 'layer.style.setEnabled', 'layer.effect.setEnabled',
  'text.create', 'text.replaceRange', 'text.format', 'text.setLayout',
  'vector.create', 'vector.update', 'vector.remove',
  'layer.effect.add', 'layer.effect.update', 'layer.effect.remove', 'layer.effect.move',
  'command.batch', 'task.cancel',
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
  server.registerTool('lighttable_batch', {
    title: 'Execute an atomic LightTable command batch',
    description: 'Runs up to 64 semantic edits as one publication and one named undo entry. Failure or cancellation publishes nothing.',
    inputSchema: z.object({ documentId: z.string().min(1), name: z.string().min(1).max(128),
      timeoutMs: z.number().int().min(100).max(10_000).default(5_000),
      expectedDocumentRevision: z.number().int().nonnegative().optional(),
      operations: z.array(z.object({ operationId: z.string().min(1).max(128),
        command: z.enum(commandIds.filter((id) => id !== 'command.batch' && id !== 'task.cancel')),
        parameters: z.record(z.string(), z.unknown()).default({}) })).min(1).max(64) })
  }, withResult(({ documentId, name, timeoutMs, operations, expectedDocumentRevision }) =>
    client.invoke('command.execute', { documentId, command: 'command.batch',
      commandRequestId: crypto.randomUUID(), commandParameters: { name, timeoutMs, operations },
      ...(expectedDocumentRevision === undefined ? {} : { expectedDocumentRevision }) }), { edit: true }));
  server.registerTool('lighttable_task_events', {
    title: 'Poll LightTable agent activity',
    description: 'Returns bounded task events after a reconnect-safe cursor.',
    inputSchema: z.object({ afterCursor: z.number().int().nonnegative().default(0),
      limit: z.number().int().min(1).max(200).default(100) }), annotations: { readOnlyHint: true }
  }, withResult((input) => client.invoke('task.events', input)));
  server.registerTool('lighttable_cancel_task', {
    title: 'Cancel a LightTable task',
    inputSchema: z.object({ documentId: z.string().min(1), taskId: z.string().min(1) })
  }, withResult(({ documentId, taskId }) => client.invoke('command.execute', { documentId,
    command: 'task.cancel', commandRequestId: crypto.randomUUID(), commandParameters: { taskId } }), { edit: true }));
  server.registerTool('lighttable_create_document', {
    title: 'Create a LightTable document',
    description: 'Creates one document with explicit canvas, resolution, bit depth, profile and background semantics.',
    inputSchema: z.object({
      name: z.string().min(1).max(255), width: z.number().int().min(1).max(32768),
      height: z.number().int().min(1).max(32768), resolutionPpi: z.number().int().min(1).max(2400).default(72),
      bitDepth: z.enum(['8', '16']).default('8'),
      profile: z.enum(['srgb', 'adobe-rgb-1998']).default('srgb'),
      backgroundColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional()
    })
  }, withResult(({ name, width, height, resolutionPpi, bitDepth, profile, backgroundColor }) =>
    client.invoke('command.execute', {
      command: 'document.create', commandRequestId: crypto.randomUUID(),
      commandParameters: { name, width, height, resolutionPpi, bitDepth: Number(bitDepth), profile,
        background: backgroundColor ? { kind: 'solid', color: backgroundColor } : { kind: 'transparent' } }
    }), { edit: true }));
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
      alignment: z.enum(['start', 'center', 'end', 'justify']).optional(),
      expectedDocumentRevision: z.number().int().nonnegative().optional() })
  }, withResult(({ documentId, layerId, operation, start, end, text, fontAssetId, fontSize,
    fill, tracking, alignment, expectedDocumentRevision }) => {
    if (operation === 'replace' && (start === undefined || end === undefined || text === undefined)) {
      throw new Error('Range replacement requires start, end and text.');
    }
    return client.invoke('command.execute', { documentId,
      command: operation === 'replace' ? 'text.replaceRange' : 'text.format',
      commandRequestId: crypto.randomUUID(), ...(expectedDocumentRevision === undefined ? {} : { expectedDocumentRevision }),
      commandParameters: operation === 'replace' ? { layerId, start, end, text } : { layerId,
        ...(start === undefined || end === undefined ? {} : { start, end }), style: {
          ...(fontAssetId ? { font: { assetId: fontAssetId } } : {}), ...(fontSize ? { fontSize } : {}),
          ...(fill ? { fill: { enabled: true, color: fill } } : {}), ...(tracking === undefined ? {} : { tracking })
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
  }, withResult(async ({ url, name, documentId, x, y }) => {
    const image = await downloadImage(url, fetchImpl);
    const artifact = await client.uploadArtifact({ bytes: image.bytes,
      name: name ?? image.suggestedName, mediaType: image.mediaType });
    if (documentId && image.mediaType === 'image/avif') throw new Error('Placed images must be PNG, JPEG or WebP.');
    const result = await client.invoke('command.execute', {
      ...(documentId ? { documentId } : {}),
      command: documentId ? 'layer.placeArtifact' : 'file.openArtifact',
      commandRequestId: crypto.randomUUID(), commandParameters: {
        artifactId: artifact.id, ...(name ? { name } : {}), ...(x === undefined ? {} : { x }), ...(y === undefined ? {} : { y })
      }
    });
    return { artifact, result };
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
