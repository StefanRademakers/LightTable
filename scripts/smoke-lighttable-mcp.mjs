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
  const waitForDocumentTask = async (documentId, taskId, timeout = 120_000) => {
    const deadline = Date.now() + timeout;
    let task;
    while (Date.now() < deadline) {
      task = await bridge.invoke('task.query', { documentId, taskId });
      if (task?.status !== 'running') return task;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Task ${taskId} timed out after ${timeout} ms.`);
  };
  const workspace = (await call('lighttable_workspace', {})).structuredContent;
  const documentId = workspace.activeDocumentId;
  const before = (await call('lighttable_document', { documentId })).structuredContent;
  const textContract = (await call('lighttable_commands', { command: 'text.create' }))
    .structuredContent.commands?.[0]?.contract;
  if (textContract?.status !== 'complete' || textContract.schemaVersion !== 1
    || !textContract.input?.allOf || !textContract.result?.properties?.layerId) {
    throw new Error(`MCP text.create discovery is not a complete conditional contract: ${JSON.stringify(textContract)}`);
  }
  const layerTransformContract = (await call('lighttable_commands', { command: 'layer.setTransform' }))
    .structuredContent.commands?.[0]?.contract;
  const fixedTransformContract = (await call('lighttable_commands', { command: 'transform.applyFixed' }))
    .structuredContent.commands?.[0]?.contract;
  if (layerTransformContract?.status !== 'complete' || layerTransformContract.schemaVersion !== 1
    || !layerTransformContract.input?.properties?.transform?.properties?.tx
    || !layerTransformContract.result?.properties?.transform
    || fixedTransformContract?.status !== 'complete' || fixedTransformContract.schemaVersion !== 1
    || !fixedTransformContract.input?.properties?.operation?.enum?.includes('flip-horizontal')
    || !fixedTransformContract.result?.properties?.target) {
    throw new Error(`MCP transform discovery is incomplete: ${JSON.stringify({
      layerTransformContract, fixedTransformContract
    })}`);
  }
  const createRasterContract = (await call('lighttable_commands', { command: 'layer.createRaster' }))
    .structuredContent.commands?.[0]?.contract;
  const layerMaskContract = (await call('lighttable_commands', { command: 'layer.setMask' }))
    .structuredContent.commands?.[0]?.contract;
  if (createRasterContract?.status !== 'complete' || createRasterContract.schemaVersion !== 1
    || Object.keys(createRasterContract.input?.properties ?? {}).length !== 0
    || !createRasterContract.result?.properties?.layerId
    || layerMaskContract?.status !== 'complete' || layerMaskContract.schemaVersion !== 1
    || !layerMaskContract.input?.allOf || !layerMaskContract.result?.allOf) {
    throw new Error(`MCP layer creation/mask discovery is incomplete: ${JSON.stringify({
      createRasterContract, layerMaskContract
    })}`);
  }
  const shapeSelectionContract = (await call('lighttable_commands', { command: 'selection.applyShape' }))
    .structuredContent.commands?.[0]?.contract;
  const wandSelectionContract = (await call('lighttable_commands', { command: 'selection.applyMagicWand' }))
    .structuredContent.commands?.[0]?.contract;
  const modifySelectionContract = (await call('lighttable_commands', { command: 'selection.modify' }))
    .structuredContent.commands?.[0]?.contract;
  if (shapeSelectionContract?.status !== 'complete' || shapeSelectionContract.schemaVersion !== 1
    || !shapeSelectionContract.input?.properties?.shape?.allOf
    || !shapeSelectionContract.result?.properties?.antiAlias
    || wandSelectionContract?.status !== 'complete' || wandSelectionContract.schemaVersion !== 1
    || !wandSelectionContract.input?.properties?.options?.properties?.sampleSize
    || !wandSelectionContract.result?.properties?.options
    || modifySelectionContract?.status !== 'complete' || modifySelectionContract.schemaVersion !== 1
    || !modifySelectionContract.input?.allOf || !modifySelectionContract.result?.allOf) {
    throw new Error(`MCP selection discovery is incomplete: ${JSON.stringify({
      shapeSelectionContract, wandSelectionContract, modifySelectionContract
    })}`);
  }
  const basicGradeContract = (await call('lighttable_commands', { command: 'grade.setBasic' }))
    .structuredContent.commands?.[0]?.contract;
  if (basicGradeContract?.status !== 'complete' || basicGradeContract.schemaVersion !== 1
    || basicGradeContract.input?.properties?.target?.oneOf?.length !== 2
    || Object.keys(basicGradeContract.input?.properties?.values?.properties ?? {}).length !== 14
    || !basicGradeContract.result?.properties?.changed) {
    throw new Error(`MCP basic Grade discovery is incomplete: ${JSON.stringify(basicGradeContract)}`);
  }
  const mergeContract = (await call('lighttable_commands', { command: 'layer.merge' }))
    .structuredContent.commands?.[0]?.contract;
  const groupFlattenContract = (await call('lighttable_commands', { command: 'layer.flattenGroup' }))
    .structuredContent.commands?.[0]?.contract;
  const imageFlattenContract = (await call('lighttable_commands', { command: 'document.flattenImage' }))
    .structuredContent.commands?.[0]?.contract;
  if (mergeContract?.status !== 'complete' || mergeContract.schemaVersion !== 1
    || mergeContract.input?.properties?.layerIds?.uniqueItems !== true
    || !mergeContract.result?.properties?.outputLayerId
    || groupFlattenContract?.status !== 'complete' || groupFlattenContract.schemaVersion !== 1
    || !groupFlattenContract.result?.properties?.groupId
    || imageFlattenContract?.status !== 'complete' || imageFlattenContract.schemaVersion !== 1
    || Object.keys(imageFlattenContract.input?.properties ?? {}).length !== 0
    || !imageFlattenContract.result?.properties?.outputLayerId) {
    throw new Error(`MCP merge/flatten discovery is incomplete: ${JSON.stringify({
      mergeContract, groupFlattenContract, imageFlattenContract
    })}`);
  }
  const invertContract = (await call('lighttable_commands', { command: 'raster.invert' }))
    .structuredContent.commands?.[0]?.contract;
  const textShapeContract = (await call('lighttable_commands', { command: 'text.convertToShape' }))
    .structuredContent.commands?.[0]?.contract;
  const textRasterContract = (await call('lighttable_commands', { command: 'text.rasterize' }))
    .structuredContent.commands?.[0]?.contract;
  if (invertContract?.status !== 'complete' || invertContract.schemaVersion !== 1
    || !invertContract.input?.properties?.channel?.enum?.includes('mask')
    || !invertContract.result?.properties?.layerId
    || textShapeContract?.status !== 'complete' || textShapeContract.schemaVersion !== 1
    || textShapeContract.result?.properties?.outputType?.const !== 'vector'
    || textRasterContract?.status !== 'complete' || textRasterContract.schemaVersion !== 1
    || textRasterContract.result?.properties?.outputType?.const !== 'raster') {
    throw new Error(`MCP finalization discovery is incomplete: ${JSON.stringify({
      invertContract, textShapeContract, textRasterContract
    })}`);
  }
  const fillContract = (await call('lighttable_commands', { command: 'raster.fill' }))
    .structuredContent.commands?.[0]?.contract;
  const rasterGradientContract = (await call('lighttable_commands', {
    command: 'raster.applyGradient'
  })).structuredContent.commands?.[0]?.contract;
  if (fillContract?.status !== 'complete' || fillContract.schemaVersion !== 1
    || fillContract.input?.properties?.color?.pattern !== '^#[0-9a-fA-F]{6}$'
    || !fillContract.result?.properties?.channel
    || rasterGradientContract?.status !== 'complete'
    || rasterGradientContract.schemaVersion !== 1
    || rasterGradientContract.input?.properties?.paint?.properties?.coordinateSpace?.enum?.includes('object-bounds')
    || rasterGradientContract.input?.properties?.paint?.properties?.asset?.properties?.colorStops?.maxItems !== 64
    || !rasterGradientContract.result?.properties?.layerId) {
    throw new Error(`MCP raster paint discovery is incomplete: ${JSON.stringify({
      fillContract, rasterGradientContract
    })}`);
  }
  const invalidText = await mcpClient.callTool({ name: 'lighttable_execute', arguments: {
    documentId, command: 'text.create', parameters: {
      mode: 'path', text: 'Missing native path target', origin: { x: 0, y: 0 },
      privateEditorState: { selectedLayer: true }
    }
  } });
  const afterInvalidText = (await call('lighttable_document', { documentId })).structuredContent;
  if (!invalidText.isError || afterInvalidText.canonicalRevision !== before.canonicalRevision) {
    throw new Error(`Invalid nested Text input reached the desktop mutation owner: ${JSON.stringify({
      invalidText, before: before.canonicalRevision, after: afterInvalidText.canonicalRevision
    })}`);
  }
  const invalidTransform = await mcpClient.callTool({ name: 'lighttable_execute', arguments: {
    documentId, command: 'layer.setTransform', parameters: {
      layerId: before.activeLayerId,
      transform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0, runtimeBounds: [0, 0, 1, 1] }
    }
  } });
  const afterInvalidTransform = (await call('lighttable_document', { documentId })).structuredContent;
  if (!invalidTransform.isError || afterInvalidTransform.canonicalRevision !== before.canonicalRevision) {
    throw new Error(`Invalid affine state reached the desktop mutation owner: ${JSON.stringify({
      invalidTransform, before: before.canonicalRevision,
      after: afterInvalidTransform.canonicalRevision
    })}`);
  }
  const invalidMask = await mcpClient.callTool({ name: 'lighttable_execute', arguments: {
    documentId, command: 'layer.setMask', parameters: {
      layerId: before.activeLayerId, operation: 'set-enabled', source: 'reveal-all'
    }
  } });
  const afterInvalidMask = (await call('lighttable_document', { documentId })).structuredContent;
  if (!invalidMask.isError || afterInvalidMask.canonicalRevision !== before.canonicalRevision) {
    throw new Error(`Invalid cross-operation mask state reached the desktop mutation owner: ${JSON.stringify({
      invalidMask, before: before.canonicalRevision, after: afterInvalidMask.canonicalRevision
    })}`);
  }
  const invalidSelection = await mcpClient.callTool({ name: 'lighttable_execute', arguments: {
    documentId, command: 'selection.applyMagicWand', parameters: {
      kind: 'magic-wand', layerId: before.activeLayerId,
      point: { x: 10, y: 10, pressure: 0.5 }, mode: 'replace',
      options: { sampleSize: 3, tolerance: 20, antiAlias: true,
        contiguous: true, sampleAllLayers: false }
    }
  } });
  if (!invalidSelection.isError) {
    throw new Error(`Private pointer state reached the Magic Wand owner: ${JSON.stringify(invalidSelection)}`);
  }
  const invalidGrade = await mcpClient.callTool({ name: 'lighttable_execute', arguments: {
    documentId, command: 'grade.setBasic', parameters: {
      target: { kind: 'document' }, values: { privateCurve: [0, 1] }
    }
  } });
  const afterInvalidGrade = (await call('lighttable_document', { documentId })).structuredContent;
  if (!invalidGrade.isError || afterInvalidGrade.canonicalRevision !== before.canonicalRevision) {
    throw new Error(`Private Grade state reached the desktop mutation owner: ${JSON.stringify({
      invalidGrade, before: before.canonicalRevision, after: afterInvalidGrade.canonicalRevision
    })}`);
  }
  const invalidFlatten = await mcpClient.callTool({ name: 'lighttable_execute', arguments: {
    documentId, command: 'document.flattenImage', parameters: { preserveLayers: true }
  } });
  const afterInvalidFlatten = (await call('lighttable_document', { documentId })).structuredContent;
  if (!invalidFlatten.isError || afterInvalidFlatten.canonicalRevision !== before.canonicalRevision) {
    throw new Error(`Expanded Flatten Image request reached the destructive owner: ${JSON.stringify({
      invalidFlatten, before: before.canonicalRevision, after: afterInvalidFlatten.canonicalRevision
    })}`);
  }
  const invalidInvert = await mcpClient.callTool({ name: 'lighttable_execute', arguments: {
    documentId, command: 'raster.invert', parameters: {
      layerId: before.activeLayerId, channel: 'all'
    }
  } });
  const afterInvalidInvert = (await call('lighttable_document', { documentId })).structuredContent;
  if (!invalidInvert.isError || afterInvalidInvert.canonicalRevision !== before.canonicalRevision) {
    throw new Error(`Expanded raster channel reached the GPU mutation owner: ${JSON.stringify({
      invalidInvert, before: before.canonicalRevision, after: afterInvalidInvert.canonicalRevision
    })}`);
  }
  const invalidRasterGradient = await mcpClient.callTool({ name: 'lighttable_execute', arguments: {
    documentId, command: 'raster.applyGradient', parameters: {
      layerId: before.activeLayerId, channel: 'pixels', paint: mcpGradient,
      opacity: 1, blendMode: 'normal', pointerSamples: [{ x: 0, y: 0 }]
    }
  } });
  const afterInvalidRasterGradient = (await call('lighttable_document', { documentId })).structuredContent;
  if (!invalidRasterGradient.isError
    || afterInvalidRasterGradient.canonicalRevision !== before.canonicalRevision) {
    throw new Error(`Pointer samples reached the final raster-gradient owner: ${JSON.stringify({
      invalidRasterGradient, before: before.canonicalRevision,
      after: afterInvalidRasterGradient.canonicalRevision
    })}`);
  }
  const sourceLayerId = before.activeLayerId;
  const openingLayers = (await call('lighttable_layers', { documentId })).structuredContent;
  const openingLayerList = Array.isArray(openingLayers)
    ? openingLayers : openingLayers.result ?? openingLayers.layers ?? openingLayers.value ?? [];
  const backgroundSourceLayerId = openingLayerList.find(({ id, type }) =>
    id === sourceLayerId && type === 'raster')?.id
    ?? openingLayerList.find(({ type }) => type === 'raster')?.id;
  const activeLayerDetail = (await call('lighttable_layer', { documentId,
    expectedDocumentRevision: before.canonicalRevision })).structuredContent;
  const activeLayerSummary = openingLayerList.find(({ id }) => id === sourceLayerId);
  if (activeLayerDetail?.status !== 'completed'
    || activeLayerDetail.resolvedFrom !== 'active-layer'
    || activeLayerDetail.layer?.id !== sourceLayerId
    || activeLayerDetail.content?.kind !== activeLayerSummary?.type) {
    throw new Error(`MCP active-layer inspection is incomplete: ${JSON.stringify(activeLayerDetail)}`);
  }
  if (!backgroundSourceLayerId) throw new Error('MCP fixture has no raster layer for layer preview.');
  const rasterLayerDetail = (await call('lighttable_layer', { documentId,
    layerId: backgroundSourceLayerId,
    expectedDocumentRevision: before.canonicalRevision })).structuredContent;
  if (rasterLayerDetail?.content?.kind !== 'raster'
    || !rasterLayerDetail.availableQueries?.includes('layer.preview:pixels')) {
    throw new Error(`MCP raster-layer inspection is incomplete: ${JSON.stringify(rasterLayerDetail)}`);
  }
  const openingPreview = await call('lighttable_preview', { documentId,
    expectedDocumentRevision: before.canonicalRevision, maxEdge: 256 });
  const openingPreviewMetadata = JSON.parse(
    openingPreview.content.find(({ type }) => type === 'text')?.text ?? '{}'
  );
  if (openingPreviewMetadata.canonicalRevision !== before.canonicalRevision
    || openingPreviewMetadata.artifact?.preview?.maxEdge !== 256) {
    throw new Error(`Opening MCP preview lost revision context: ${JSON.stringify(openingPreviewMetadata)}`);
  }
  const openingLayerPreview = await call('lighttable_layer_preview', { documentId,
    layerId: backgroundSourceLayerId, channel: 'pixels',
    expectedDocumentRevision: before.canonicalRevision, maxEdge: 256,
    format: 'webp', quality: 0.72 });
  const openingLayerPreviewMetadata = JSON.parse(
    openingLayerPreview.content.find(({ type }) => type === 'text')?.text ?? '{}'
  );
  if (!openingLayerPreview.content.some(({ type, mimeType }) => type === 'image' && mimeType === 'image/webp')
    || openingLayerPreviewMetadata.artifact?.preview?.target?.layerId !== backgroundSourceLayerId
    || openingLayerPreviewMetadata.artifact.preview.target.channel !== 'pixels'
    || openingLayerPreviewMetadata.artifact.preview.quality !== 0.72) {
    throw new Error(`Opening MCP layer preview lost target context: ${JSON.stringify(openingLayerPreviewMetadata)}`);
  }
  const reusedLayerPreview = await call('lighttable_layer_preview', { documentId,
    layerId: backgroundSourceLayerId, channel: 'pixels',
    expectedDocumentRevision: before.canonicalRevision, maxEdge: 256,
    format: 'webp', quality: 0.72,
    knownArtifactId: openingLayerPreviewMetadata.artifact.id });
  const reusedLayerPreviewMetadata = reusedLayerPreview.structuredContent;
  if (!reusedLayerPreviewMetadata.reused
    || !reusedLayerPreviewMetadata.unchanged
    || reusedLayerPreview.content.some(({ type }) => type === 'image')
    || reusedLayerPreviewMetadata.artifact?.id !== openingLayerPreviewMetadata.artifact?.id) {
    throw new Error('Unchanged MCP layer preview rendered or retransferred image bytes.');
  }
  const regionBounds = { x: 64, y: 48, width: 192, height: 96 };
  const openingRegionPreview = await call('lighttable_region_preview', { documentId,
    region: regionBounds, expectedDocumentRevision: before.canonicalRevision,
    maxEdge: 128, format: 'webp', quality: 0.68 });
  const openingRegionImage = openingRegionPreview.content.find(({ type }) => type === 'image');
  const openingRegionMetadata = JSON.parse(
    openingRegionPreview.content.find(({ type }) => type === 'text')?.text ?? '{}'
  );
  const decodedRegion = openingRegionImage
    ? await sharp(Buffer.from(openingRegionImage.data, 'base64')).metadata() : null;
  if (openingRegionImage?.mimeType !== 'image/webp'
    || decodedRegion?.width !== 128 || decodedRegion.height !== 64
    || openingRegionMetadata.artifact?.preview?.target?.coordinateSpace !== 'document-px'
    || JSON.stringify(openingRegionMetadata.artifact.preview.target.bounds) !== JSON.stringify(regionBounds)) {
    throw new Error(`MCP region preview lost crop context: ${JSON.stringify({
      decodedRegion, openingRegionMetadata
    })}`);
  }
  const openingEvents = (await call('lighttable_events', { afterCursor: 0, limit: 200 }))
    .structuredContent;
  let eventCursor = openingEvents.latestCursor;
  let firstEditRevision = before.canonicalRevision;
  if (process.env.LIGHTTABLE_SMOKE_BACKGROUND_REMOVAL === '1') {
    if (!backgroundSourceLayerId) throw new Error('MCP fixture has no raster layer for Remove Background.');
    const removal = (await call('lighttable_execute', {
      documentId, command: 'layer.removeBackground',
      parameters: { layerId: backgroundSourceLayerId, mode: 'replace' }
    })).structuredContent;
    if (removal?.status !== 'accepted' || !removal.taskId) {
      throw new Error(`MCP Remove Background was not accepted: ${JSON.stringify(removal)}`);
    }
    const task = await waitForDocumentTask(documentId, removal.taskId, 600_000);
    if (task?.status !== 'completed') {
      throw new Error(`MCP Remove Background failed: ${JSON.stringify(task)}`);
    }
    const maskedLayers = (await call('lighttable_layers', { documentId })).structuredContent;
    const maskedLayerList = Array.isArray(maskedLayers)
      ? maskedLayers : maskedLayers.result ?? maskedLayers.layers ?? maskedLayers.value ?? [];
    const maskedSource = maskedLayerList.find(({ id }) => id === backgroundSourceLayerId);
    if (!maskedSource?.hasMask || !maskedSource.maskContent?.raster?.pixelRevision) {
      throw new Error(`MCP Remove Background did not publish an editable raster mask: ${JSON.stringify(maskedSource)}`);
    }
    firstEditRevision = (await call('lighttable_document', { documentId })).structuredContent.canonicalRevision;
    eventCursor = (await call('lighttable_events', { afterCursor: 0, limit: 1 })).structuredContent.latestCursor;
  }
  const publicationWait = call('lighttable_wait_for_events', {
    afterCursor: eventCursor, limit: 20, timeoutMs: 10_000
  });
  const alignReference = (await call('lighttable_execute', {
    documentId, command: 'layer.createRaster', expectedDocumentRevision: firstEditRevision, parameters: {}
  })).structuredContent.value?.layerId;
  if (!alignReference) throw new Error('MCP Auto Align reference layer was not created.');
  const firstPublications = (await publicationWait).structuredContent;
  const firstPublicationTail = (await call('lighttable_events', {
    afterCursor: firstPublications.cursor, limit: 20
  })).structuredContent;
  const firstCommandPublications = [
    ...firstPublications.events,
    ...firstPublicationTail.events
  ];
  if (firstPublications.timedOut || firstPublications.gap
    || firstPublicationTail.gap
    || !firstPublications.events.some((event) => event.documentId === documentId)
    || !firstCommandPublications.some((event) => event.kind === 'document-revision-changed'
      && event.documentId === documentId && event.detail?.canonicalRevision > firstEditRevision)
    || !firstCommandPublications.some((event) => event.kind === 'history-changed'
      && event.documentId === documentId)) {
    throw new Error(`MCP bounded event wait missed the first edit: ${JSON.stringify({
      firstPublications, firstPublicationTail
    })}`);
  }
  await call('lighttable_execute', { documentId, command: 'raster.fill', parameters: {
    layerId: alignReference, channel: 'pixels', color: '#18202a', opacity: 1
  } });
  const paintAlignFeature = (color, samples) => call('lighttable_execute', {
    documentId, command: 'tool.commitGesture', parameters: {
      kind: 'brush-stroke', parameters: { layerId: alignReference, channel: 'pixels', erase: false,
        brush: { presetId: 'round', size: 18, hardness: 1, opacity: 1, flow: 1,
          spacing: 0.05, smooth: 0, color, backgroundColor: '#000000' } }, samples
    }
  });
  await paintAlignFeature('#f2f5f8', [
    { x: 48, y: 64, pressure: 1 }, { x: 128, y: 48, pressure: 1 },
    { x: 176, y: 132, pressure: 1 }, { x: 252, y: 72, pressure: 1 },
    { x: 332, y: 160, pressure: 1 }, { x: 416, y: 96, pressure: 1 }
  ]);
  await paintAlignFeature('#ff6b35', [
    { x: 72, y: 330, pressure: 1 }, { x: 148, y: 220, pressure: 1 },
    { x: 230, y: 360, pressure: 1 }, { x: 310, y: 244, pressure: 1 },
    { x: 430, y: 340, pressure: 1 }
  ]);
  const alignFixtureLayers = (await call('lighttable_layers', { documentId })).structuredContent;
  const alignFixtureList = Array.isArray(alignFixtureLayers)
    ? alignFixtureLayers : alignFixtureLayers.result ?? alignFixtureLayers.layers ?? alignFixtureLayers.value ?? [];
  const referenceLayer = alignFixtureList.find(({ id }) => id === alignReference);
  const duplicatedForAlign = (await call('lighttable_execute', {
    documentId, command: 'layer.duplicate', parameters: { layerId: alignReference }
  })).structuredContent;
  const alignTargetLayerId = duplicatedForAlign?.value?.layerId;
  if (!alignTargetLayerId || duplicatedForAlign?.value?.sourceLayerId !== alignReference
    || !referenceLayer?.transform) {
    throw new Error(`MCP Auto Align fixture could not be created: ${JSON.stringify(duplicatedForAlign)}`);
  }
  await call('lighttable_execute', { documentId, command: 'layer.setLock', parameters: {
    layerIds: [alignTargetLayerId], lock: 'all', locked: false
  } });
  await call('lighttable_execute', { documentId, command: 'layer.setLock', parameters: {
    layerIds: [alignTargetLayerId], lock: 'position', locked: false
  } });
  const shiftedTransform = { ...referenceLayer.transform,
    tx: referenceLayer.transform.tx + 12, ty: referenceLayer.transform.ty + 8 };
  await call('lighttable_execute', { documentId, command: 'layer.setTransform', parameters: {
    layerId: alignTargetLayerId, transform: shiftedTransform
  } });
  const autoAlign = (await call('lighttable_execute', { documentId, command: 'layer.autoAlign',
    parameters: { referenceLayerId: alignReference, targetLayerId: alignTargetLayerId }
  })).structuredContent;
  if (autoAlign?.status !== 'accepted' || !autoAlign.taskId) {
    throw new Error(`MCP Auto Align was not accepted: ${JSON.stringify(autoAlign)}`);
  }
  const autoAlignTask = await waitForDocumentTask(documentId, autoAlign.taskId);
  if (autoAlignTask?.status !== 'completed') {
    throw new Error(`MCP Auto Align failed: ${JSON.stringify(autoAlignTask)}`);
  }
  const alignedLayers = (await call('lighttable_layers', { documentId })).structuredContent;
  const alignedLayerList = Array.isArray(alignedLayers)
    ? alignedLayers : alignedLayers.result ?? alignedLayers.layers ?? alignedLayers.value ?? [];
  const alignedTarget = alignedLayerList.find(({ id }) => id === alignTargetLayerId);
  if (!alignedTarget || (alignedTarget.transform.tx === shiftedTransform.tx
    && alignedTarget.transform.ty === shiftedTransform.ty)) {
    throw new Error(`MCP Auto Align did not change target geometry: ${JSON.stringify(alignedTarget)}`);
  }
  await call('lighttable_execute', { documentId, command: 'layer.delete',
    parameters: { layerIds: [alignTargetLayerId, alignReference] } });
  firstEditRevision = (await call('lighttable_document', { documentId })).structuredContent.canonicalRevision;
  await call('lighttable_execute', { documentId, command: 'layer.createRaster',
    expectedDocumentRevision: firstEditRevision, parameters: {} });
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
  const layerCopy = (await call('lighttable_execute', {
    documentId, command: 'layer.copyToNewLayer', parameters: { layerId }
  })).structuredContent;
  const copiedLayerId = layerCopy?.value?.layerId;
  if (!copiedLayerId || layerCopy.value?.sourceLayerId !== layerId
    || layerCopy.value?.scope !== 'layer') {
    throw new Error(`MCP Layer via Copy did not return an editable target: ${JSON.stringify(layerCopy)}`);
  }
  await call('lighttable_execute', { documentId, command: 'layer.setVisibility',
    parameters: { layerIds: [layerId], visible: false } });
  const copiedDocument = (await call('lighttable_document', { documentId })).structuredContent;
  const copiedPreview = await call('lighttable_preview', { documentId,
    expectedDocumentRevision: copiedDocument.canonicalRevision, maxEdge: 256 });
  const copiedImage = copiedPreview.content.find(({ type }) => type === 'image');
  if (!copiedImage) throw new Error('MCP Layer via Copy preview did not return an image.');
  const copiedPixels = await sharp(Buffer.from(copiedImage.data, 'base64')).ensureAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  const copiedOffset = (Math.min(10, copiedPixels.info.height - 1) * copiedPixels.info.width
    + Math.min(10, copiedPixels.info.width - 1)) * 4;
  const copiedCorner = [...copiedPixels.data.subarray(copiedOffset, copiedOffset + 4)];
  if (copiedCorner[3] < 240 || copiedCorner[2] <= copiedCorner[0]) {
    throw new Error(`MCP Layer via Copy lost its GPU pixels: ${JSON.stringify(copiedCorner)}`);
  }
  const copiedLayers = (await call('lighttable_layers', { documentId })).structuredContent;
  const copiedLayerList = Array.isArray(copiedLayers)
    ? copiedLayers : copiedLayers.result ?? copiedLayers.layers ?? copiedLayers.value ?? [];
  if (!copiedLayerList.some(({ id, type }) => id === copiedLayerId && type === 'raster')) {
    throw new Error(`MCP Layer via Copy did not publish its raster layer: ${JSON.stringify(copiedLayerList)}`);
  }
  const clipped = (await call('lighttable_execute', { documentId, command: 'layer.setClipping',
    parameters: { layerId: copiedLayerId, clipping: true } })).structuredContent;
  const unclipped = (await call('lighttable_execute', { documentId, command: 'layer.setClipping',
    parameters: { layerId: copiedLayerId, clipping: false } })).structuredContent;
  const movedDown = (await call('lighttable_execute', { documentId, command: 'layer.move',
    parameters: { layerId: copiedLayerId, direction: 'down' } })).structuredContent;
  const movedUp = (await call('lighttable_execute', { documentId, command: 'layer.move',
    parameters: { layerId: copiedLayerId, direction: 'up' } })).structuredContent;
  if (clipped?.value?.clipping !== true || unclipped?.value?.clipping !== false
    || movedDown?.value?.direction !== 'down' || movedUp?.value?.direction !== 'up') {
    throw new Error(`MCP structural layer results diverged: ${JSON.stringify({
      clipped, unclipped, movedDown, movedUp
    })}`);
  }
  await call('lighttable_execute', { documentId, command: 'layer.setVisibility',
    parameters: { layerIds: [layerId], visible: true } });
  const deletedCopy = (await call('lighttable_execute', { documentId, command: 'layer.delete',
    parameters: { layerIds: [copiedLayerId] } })).structuredContent;
  if (deletedCopy?.value?.layerIds?.length !== 1
    || deletedCopy.value.layerIds[0] !== copiedLayerId) {
    throw new Error(`MCP layer deletion result diverged: ${JSON.stringify(deletedCopy)}`);
  }
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
  const magicWand = (await call('lighttable_execute', {
    documentId, command: 'selection.applyMagicWand', parameters: {
      kind: 'magic-wand', layerId, point: { x: 120, y: 110 }, mode: 'replace',
      options: { sampleSize: 3, tolerance: 24, antiAlias: true,
        contiguous: true, sampleAllLayers: false }
    }
  })).structuredContent;
  if (magicWand?.value?.layerId !== layerId || magicWand.value.mode !== 'replace') {
    throw new Error(`MCP Magic Wand command failed: ${JSON.stringify(magicWand)}`);
  }
  const featheredSelection = (await call('lighttable_execute', {
    documentId, command: 'selection.modify', parameters: {
      kind: 'modify', operation: 'feather', radius: 9
    }
  })).structuredContent;
  if (featheredSelection?.status !== 'completed'
    || featheredSelection.value?.operation !== 'feather'
    || featheredSelection.value?.radius !== 9) {
    throw new Error(`MCP selection feather failed: ${JSON.stringify(featheredSelection)}`);
  }
  const beforeFixedTransform = (await call('lighttable_document', { documentId })).structuredContent;
  const fixedTransform = (await call('lighttable_execute', {
    documentId, command: 'transform.applyFixed',
    expectedDocumentRevision: beforeFixedTransform.canonicalRevision,
    parameters: { operation: 'flip-horizontal' }
  })).structuredContent;
  if (fixedTransform?.status !== 'completed' || fixedTransform.value?.operation !== 'flip-horizontal'
    || fixedTransform.value?.target !== 'selection'
    || fixedTransform.revisions?.document <= beforeFixedTransform.canonicalRevision) {
    throw new Error(`MCP contextual fixed transform failed: ${JSON.stringify(fixedTransform)}`);
  }
  const createAdjustment = async (parameters, expectedPlacement) => {
    const document = (await call('lighttable_document', { documentId })).structuredContent;
    const created = (await call('lighttable_execute', {
      documentId, command: 'adjustment.create',
      expectedDocumentRevision: document.canonicalRevision, parameters
    })).structuredContent;
    if (created?.status !== 'completed' || created.value?.kind !== parameters.kind
      || created.value?.placement !== expectedPlacement
      || created.revisions?.document <= document.canonicalRevision) {
      throw new Error(`MCP adjustment creation failed: ${JSON.stringify(created)}`);
    }
    return created.value;
  };
  await createAdjustment({ kind: 'grade', placement: 'local', layerId }, 'local');
  const attached = await createAdjustment({
    kind: 'brightness-contrast', placement: 'attached', layerId
  }, 'attached');
  if (!attached.adjustmentId) throw new Error('MCP attached adjustment did not return a stable ID.');
  const adjustmentLayer = await createAdjustment({
    kind: 'curves', placement: 'adjustment-layer', aboveLayerId: layerId
  }, 'adjustment-layer');
  if (!adjustmentLayer.layerId || adjustmentLayer.layerId === layerId) {
    throw new Error('MCP adjustment layer did not return a new stable layer ID.');
  }
  const adjustmentRevision = (await call('lighttable_document', { documentId })).structuredContent;
  const curvesInspection = (await call('lighttable_adjustment', {
    documentId, expectedDocumentRevision: adjustmentRevision.canonicalRevision,
    target: { kind: 'layer', layerId: adjustmentLayer.layerId }
  })).structuredContent;
  if (curvesInspection?.status !== 'completed' || curvesInspection.adjustmentKind !== 'curves'
    || !curvesInspection.stack?.modules?.some(({ type }) => type === 'lt.curves')) {
    throw new Error(`MCP Curves inspection is incomplete: ${JSON.stringify(curvesInspection)}`);
  }
  const attachedInspection = (await call('lighttable_adjustment', {
    documentId, expectedDocumentRevision: adjustmentRevision.canonicalRevision,
    target: { kind: 'attached', layerId, adjustmentId: attached.adjustmentId }
  })).structuredContent;
  if (attachedInspection?.status !== 'completed'
    || attachedInspection.adjustmentKind !== 'brightness-contrast'
    || !attachedInspection.stack?.modules?.some(({ type }) => type === 'lt.photoshop-adjustment')) {
    throw new Error(`MCP attached adjustment inspection is incomplete: ${JSON.stringify(attachedInspection)}`);
  }
  for (let pass = 0; pass < 2; pass += 1) {
    const invertDocument = (await call('lighttable_document', { documentId })).structuredContent;
    const inverted = (await call('lighttable_execute', {
      documentId, command: 'raster.invert',
      expectedDocumentRevision: invertDocument.canonicalRevision,
      parameters: { layerId, channel: 'pixels' }
    })).structuredContent;
    if (inverted?.status !== 'completed' || inverted.value?.layerId !== layerId
      || inverted.value?.channel !== 'pixels'
      || inverted.revisions?.document <= invertDocument.canonicalRevision) {
      throw new Error(`MCP raster invert failed on pass ${pass + 1}: ${JSON.stringify(inverted)}`);
    }
  }
  const mcpPath = (await call('lighttable_execute', {
    documentId, command: 'vector.create', parameters: {
      name: 'MCP Path Text curve', fillRule: 'nonzero',
      subpaths: [{ id: 'mcp-path-text-subpath', closed: false, anchors: [
        { x: 40, y: 220, handleOut: { x: 100, y: 170 }, mode: 'smooth' },
        { x: 220, y: 190, handleIn: { x: 155, y: 235 }, mode: 'smooth' },
        { x: 360, y: 230, mode: 'corner' }
      ] }],
      style: { fill: null, stroke: { paint: { type: 'solid', color: [1, 1, 1, 1] },
        width: 3, alignment: 'center', cap: 'round', join: 'round', miterLimit: 4,
        dash: [], dashOffset: 0 }, opacity: 1 }
    }
  })).structuredContent;
  if (mcpPath?.status !== 'completed' || !mcpPath.value?.layerId || !mcpPath.value?.elementId) {
    throw new Error(`MCP Path Text curve creation failed: ${JSON.stringify(mcpPath)}`);
  }
  const mcpVector = (await call('lighttable_vector', {
    documentId, layerId: mcpPath.value.layerId
  })).structuredContent;
  const mcpPathElement = mcpVector.elements?.find(({ id }) => id === mcpPath.value.elementId);
  if (mcpPathElement?.subpaths?.[0]?.id !== 'mcp-path-text-subpath') {
    throw new Error(`MCP vector query lost the Path Text target: ${JSON.stringify(mcpVector)}`);
  }
  const mcpPathText = (await call('lighttable_execute', {
    documentId, command: 'text.create', parameters: {
      mode: 'path', text: 'MCP path label', name: 'MCP Path Label',
      origin: { x: 40, y: 220 }, writingMode: 'horizontal-tb',
      path: { layerId: mcpPath.value.layerId, elementId: mcpPath.value.elementId,
        subpathId: 'mcp-path-text-subpath', startOffset: 18, side: 'right',
        upright: false, direction: 'reverse' },
      style: { fontSize: 26, fill: { enabled: true, color: '#ffffff' } }
    }
  })).structuredContent;
  if (mcpPathText?.status !== 'completed' || !mcpPathText.value?.layerId) {
    throw new Error(`MCP Path Text creation failed: ${JSON.stringify(mcpPathText)}`);
  }
  const mcpText = (await call('lighttable_text', {
    documentId, layerId: mcpPathText.value.layerId
  })).structuredContent;
  if (mcpText.content?.text !== 'MCP path label' || mcpText.layout?.mode !== 'path'
    || mcpText.layout.pathLayerId !== mcpPath.value.layerId
    || mcpText.layout.pathElementId !== mcpPath.value.elementId
    || mcpText.layout.pathSubpathId !== 'mcp-path-text-subpath'
    || mcpText.layout.startOffset !== 18 || mcpText.layout.side !== 'right'
    || mcpText.layout.upright !== false || mcpText.layout.direction !== 'reverse') {
    throw new Error(`MCP Path Text query is incomplete: ${JSON.stringify(mcpText)}`);
  }
  const beforeShapeConversion = (await call('lighttable_document', { documentId })).structuredContent;
  const convertedShape = (await call('lighttable_execute', {
    documentId, command: 'text.convertToShape',
    expectedDocumentRevision: beforeShapeConversion.canonicalRevision,
    parameters: { layerId: mcpPathText.value.layerId }
  })).structuredContent;
  if (convertedShape?.status !== 'completed'
    || convertedShape.value?.layerId !== mcpPathText.value.layerId
    || convertedShape.value?.outputType !== 'vector'
    || convertedShape.revisions?.document <= beforeShapeConversion.canonicalRevision) {
    throw new Error(`MCP text-to-shape conversion failed: ${JSON.stringify(convertedShape)}`);
  }
  const convertedVector = (await call('lighttable_vector', {
    documentId, layerId: mcpPathText.value.layerId
  })).structuredContent;
  if (convertedVector.layerId !== mcpPathText.value.layerId || convertedVector.totalElements < 1) {
    throw new Error(`MCP text-to-shape output is not native vector geometry: ${JSON.stringify(convertedVector)}`);
  }
  const rasterText = (await call('lighttable_execute', {
    documentId, command: 'text.create', parameters: {
      mode: 'point', text: 'Rasterized MCP caption', name: 'MCP Raster Caption',
      origin: { x: 60, y: 80 }, writingMode: 'horizontal-tb',
      style: { fontSize: 22, fill: { enabled: true, color: '#ffffff' } }
    }
  })).structuredContent;
  if (rasterText?.status !== 'completed' || !rasterText.value?.layerId) {
    throw new Error(`MCP raster text creation failed: ${JSON.stringify(rasterText)}`);
  }
  const beforeRasterize = (await call('lighttable_document', { documentId })).structuredContent;
  const rasterizedText = (await call('lighttable_execute', {
    documentId, command: 'text.rasterize',
    expectedDocumentRevision: beforeRasterize.canonicalRevision,
    parameters: { layerId: rasterText.value.layerId }
  })).structuredContent;
  if (rasterizedText?.status !== 'completed'
    || rasterizedText.value?.layerId !== rasterText.value.layerId
    || rasterizedText.value?.outputType !== 'raster'
    || rasterizedText.revisions?.document <= beforeRasterize.canonicalRevision) {
    throw new Error(`MCP text rasterization failed: ${JSON.stringify(rasterizedText)}`);
  }
  const finalizedLayers = (await call('lighttable_layers', { documentId })).structuredContent;
  const finalizedLayerList = Array.isArray(finalizedLayers)
    ? finalizedLayers
    : finalizedLayers.result ?? finalizedLayers.layers ?? finalizedLayers.value ?? [];
  if (!finalizedLayerList.some(({ id, type }) => id === rasterText.value.layerId && type === 'raster')) {
    throw new Error(`MCP text rasterization did not retain a raster layer ID: ${JSON.stringify(finalizedLayers)}`);
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
  const previewDocument = (await call('lighttable_document', { documentId })).structuredContent;
  const preview = await call('lighttable_preview', { documentId,
    expectedDocumentRevision: previewDocument.canonicalRevision, maxEdge: 1024 });
  const image = preview.content.find(({ type }) => type === 'image');
  if (!image) throw new Error('MCP preview did not return an image.');
  const previewMetadata = JSON.parse(preview.content.find(({ type }) => type === 'text')?.text ?? '{}');
  if (previewMetadata.canonicalRevision !== previewDocument.canonicalRevision
    || previewMetadata.artifact?.kind !== 'render-preview'
    || previewMetadata.artifact?.preview?.maxEdge !== 1024
    || previewMetadata.canonicalRevision <= openingPreviewMetadata.canonicalRevision
    || previewMetadata.artifact?.id === openingPreviewMetadata.artifact?.id) {
    throw new Error(`MCP preview lost its revision context: ${JSON.stringify(previewMetadata)}`);
  }
  const publications = (await call('lighttable_events', {
    afterCursor: eventCursor, limit: 200
  })).structuredContent;
  if (publications.gap || !publications.events.some((event) =>
    event.kind === 'document-revision-changed' && event.documentId === documentId
      && event.detail?.canonicalRevision === previewDocument.canonicalRevision)
    || !publications.events.some((event) =>
      event.kind === 'history-changed' && event.documentId === documentId)) {
    throw new Error(`MCP publication stream missed the final edit: ${JSON.stringify(publications)}`);
  }
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
  const mergeBottom = (await call('lighttable_execute', {
    documentId, command: 'layer.createRaster', parameters: {}
  })).structuredContent.value?.layerId;
  const mergeTop = (await call('lighttable_execute', {
    documentId, command: 'layer.createRaster', parameters: {}
  })).structuredContent.value?.layerId;
  if (!mergeBottom || !mergeTop) throw new Error('MCP merge fixtures were not created.');
  await call('lighttable_execute', { documentId, command: 'raster.fill', parameters: {
    layerId: mergeBottom, channel: 'pixels', color: '#22aa66', opacity: 1
  } });
  await call('lighttable_execute', { documentId, command: 'raster.fill', parameters: {
    layerId: mergeTop, channel: 'pixels', color: '#3344ee', opacity: 0.5
  } });
  const mergedLayers = (await call('lighttable_execute', {
    documentId, command: 'layer.merge', parameters: { layerIds: [mergeBottom, mergeTop] }
  })).structuredContent;
  if (mergedLayers?.status !== 'completed' || !mergedLayers.value?.outputLayerId
    || mergedLayers.value.outputLayerId === mergeBottom
    || mergedLayers.value.outputLayerId === mergeTop) {
    throw new Error(`MCP explicit layer merge failed: ${JSON.stringify(mergedLayers)}`);
  }
  const flattenedImage = (await call('lighttable_execute', {
    documentId, command: 'document.flattenImage', parameters: {}
  })).structuredContent;
  if (flattenedImage?.status !== 'completed' || !flattenedImage.value?.outputLayerId) {
    throw new Error(`MCP image flatten failed: ${JSON.stringify(flattenedImage)}`);
  }
  const after = (await call('lighttable_document', { documentId })).structuredContent;
  const layers = (await call('lighttable_layers', { documentId })).structuredContent;
  const finalLayerList = Array.isArray(layers) ? layers : layers.result ?? layers.layers ?? layers.value ?? [];
  if (finalLayerList.length !== 1 || finalLayerList[0]?.id !== flattenedImage.value.outputLayerId
    || finalLayerList[0]?.type !== 'raster') {
    throw new Error(`MCP image flatten did not produce one raster layer: ${JSON.stringify(layers)}`);
  }
  const report = { source, workspace, before, after, publications, layerCount: finalLayerList.length,
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
