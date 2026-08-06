import { _electron as electron } from 'playwright-core';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';

const workspaceRoot = path.resolve(import.meta.dirname, '..');
const sourceFile = path.resolve(process.argv[2] ?? 'D:\\shapes.psd');
const executablePath = path.join(workspaceRoot, 'node_modules', 'electron', 'dist', 'electron.exe');
const outputDirectory = path.join(workspaceRoot, 'tmp', 'command-driver');
const userDataPath = path.join(outputDirectory, `user-data-${process.pid}`);
const screenshotPath = path.join(outputDirectory, 'command-driver.png');
const reportPath = path.join(outputDirectory, 'command-driver.json');

await Promise.all([access(sourceFile), access(executablePath), mkdir(userDataPath, { recursive: true })]);
const launchEnvironment = { ...process.env };
delete launchEnvironment.ELECTRON_RUN_AS_NODE;

const app = await electron.launch({
  executablePath,
  args: [path.join(workspaceRoot, 'apps', 'desktop')],
  cwd: workspaceRoot,
  env: {
    ...launchEnvironment,
    LIGHTTABLE_AUTOMATION_OPEN_FILE: sourceFile,
    LIGHTTABLE_AUTOMATION_USER_DATA: userDataPath
  },
  timeout: 30_000
});

try {
  const page = await app.firstWindow({ timeout: 30_000 });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
  await page.getByRole('button', { name: 'Open file' }).click();
  await page.locator('.lighttable-toolbar__meta').filter({ hasText: /ready/i })
    .waitFor({ state: 'visible', timeout: 30_000 });
  const driver = await attachLightTableAutomation(page, 'command-smoke');
  const semanticCreate = await driver.executeWorkspace('document.create', {
    name: 'Command canvas', width: 320, height: 240, resolutionPpi: 144,
    bitDepth: 16, profile: 'adobe-rgb-1998', background: { kind: 'solid', color: '#112233' }
  });
  const semanticDocumentId = semanticCreate.value?.documentId;
  if (!semanticDocumentId) throw new Error('Semantic document creation returned no stable ID.');
  const makeImageBytes = async (mediaType) => Buffer.from(await page.evaluate(async (type) => {
    const canvas = document.createElement('canvas');
    canvas.width = 4; canvas.height = 3;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D is unavailable.');
    context.fillStyle = '#f40'; context.fillRect(0, 0, 4, 3);
    const blob = await new Promise((resolve, reject) => canvas.toBlob(
      (value) => value ? resolve(value) : reject(new Error(`Could not encode ${type}.`)), type, 0.9
    ));
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  }, mediaType));
  const placements = [];
  for (const [mediaType, extension, x] of [
    ['image/png', 'png', -1], ['image/jpeg', 'jpg', 8], ['image/webp', 'webp', 16]
  ]) {
    const artifact = await driver.registerInputArtifact(
      await makeImageBytes(mediaType), `placed.${extension}`, mediaType
    );
    if (!artifact?.id) throw new Error(`${mediaType} artifact registration failed.`);
    placements.push(await driver.execute(semanticDocumentId, 'layer.placeArtifact', {
      artifactId: artifact.id, name: `Placed ${extension}`, x, y: 24
    }));
  }
  const placedLayers = await driver.queryLayers(semanticDocumentId);
  if (placements.some(({ status }) => status !== 'completed') || !placedLayers?.some((layer) => layer.name === 'Placed png'
    && layer.rasterSurface?.width > 0 && layer.transform?.tx === -1)) {
    throw new Error('Placed image media, bounds or transform were not preserved.');
  }
  const textLatencies = {};
  const runTextCommand = async (label, command, parameters) => {
    const startedAt = performance.now();
    const result = await driver.execute(semanticDocumentId, command, parameters);
    textLatencies[label] = performance.now() - startedAt;
    return result;
  };
  const textCreated = await runTextCommand('create', 'text.create', {
    mode: 'paragraph', name: 'Semantic text', text: 'Automation text 👋',
    origin: { x: 24, y: 64 }, frame: { width: 220, height: 120 }, writingMode: 'horizontal-tb',
    style: { font: { family: 'Inter', style: 'Regular' }, fontSize: 48,
      fill: { enabled: true, color: '#ff0088' } },
    paragraph: { alignment: 'start', direction: 'auto', leading: { value: 58 } }
  });
  const textLayerId = textCreated.value?.layerId;
  if (!textLayerId) throw new Error('Semantic text creation returned no layer ID.');
  await runTextCommand('replace', 'text.replaceRange', {
    layerId: textLayerId, start: 0, end: 10, text: 'Semantic'
  });
  await runTextCommand('format', 'text.format', {
    layerId: textLayerId, start: 0, end: 8,
    style: { fontSize: 54, tracking: 80, stroke: { enabled: true, color: '#112233', width: 2 } },
    paragraph: { alignment: 'end', direction: 'rtl', startIndent: 4 }
  });
  await runTextCommand('layout', 'text.setLayout', {
    layerId: textLayerId, frame: { x: 0, y: 0, width: 240, height: 130 },
    transform: { a: 0.9659258, b: 0.258819, c: -0.258819, d: 0.9659258, tx: 30, ty: 70 }
  });
  const textProjection = await driver.queryText(semanticDocumentId, textLayerId);
  if (textProjection?.content.text !== 'Semantic text 👋' || textProjection.styleRuns.length < 2) {
    throw new Error(`Semantic text projection is incorrect: ${JSON.stringify(textProjection)}`);
  }
  if (Math.max(textLatencies.replace, textLatencies.format, textLatencies.layout) > 1_000) {
    throw new Error(`Semantic text edit latency exceeded 1000 ms: ${JSON.stringify(textLatencies)}`);
  }
  const vectorStartedAt = performance.now();
  const vectorCreated = await driver.execute(semanticDocumentId, 'vector.create', {
    name: 'Semantic vector', primitive: { kind: 'rectangle', x: 170, y: 35, width: 120, height: 80,
      cornerRadii: [12, 12, 12, 12] }, style: { fill: { kind: 'gradient',
        asset: { id: 'smoke-gradient', name: 'Smoke gradient', type: 'solid', smoothness: 1,
          colorStops: [
            { id: 'pink', position: 0, midpoint: 0.5, color: { r: 1, g: 0, b: 0.5, a: 1 } },
            { id: 'blue', position: 1, midpoint: 0.5, color: { r: 0, g: 0.3, b: 1, a: 1 } }
          ], opacityStops: [
            { id: 'opaque-0', position: 0, midpoint: 0.5, opacity: 1 },
            { id: 'opaque-1', position: 1, midpoint: 0.5, opacity: 1 }
          ], roughness: 0, seed: 0 }, shape: 'linear', coordinateSpace: 'object-bounds',
        transform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0.5 }, reverse: false,
        dither: true, interpolation: 'perceptual' }, stroke: { paint: { type: 'solid', color: [1, 1, 1, 1] },
        width: 6, alignment: 'outside', cap: 'round', join: 'round', miterLimit: 4, dash: [], dashOffset: 0 } }
  });
  const vectorCreateLatencyMs = performance.now() - vectorStartedAt;
  const vectorLayerId = vectorCreated.value?.layerId; const vectorElementId = vectorCreated.value?.elementId;
  if (!vectorLayerId || !vectorElementId) throw new Error('Semantic vector creation returned no stable IDs.');
  const effectStartedAt = performance.now();
  const effectCreated = await driver.execute(semanticDocumentId, 'layer.effect.add', {
    layerId: vectorLayerId, effectKind: 'drop-shadow', settings: { distance: 18, size: 12, spread: 0.2 }
  });
  const effectCreateLatencyMs = performance.now() - effectStartedAt;
  const vectorProjection = await driver.queryVector(semanticDocumentId, vectorLayerId);
  const effectProjection = await driver.queryLayerEffects(semanticDocumentId, vectorLayerId);
  if (vectorProjection?.elements[0]?.style?.fill?.kind !== 'gradient'
    || vectorProjection.elements[0].style.stroke?.width !== 6 || effectProjection?.effects[0]?.settings?.size !== 12) {
    throw new Error(`Semantic vector/style projection is incorrect: ${JSON.stringify({ vectorProjection, effectProjection })}`);
  }
  if (Math.max(vectorCreateLatencyMs, effectCreateLatencyMs) > 1_000) {
    throw new Error(`Semantic vector/style latency exceeded 1000 ms: ${JSON.stringify({ vectorCreateLatencyMs, effectCreateLatencyMs })}`);
  }
  const batchHistoryBefore = (await driver.queryDocument(semanticDocumentId)).history.undoDepth;
  await driver.resetRenderTelemetry(semanticDocumentId);
  const batchStartedAt = performance.now();
  const batchAccepted = await driver.execute(semanticDocumentId, 'command.batch', {
    name: 'Agent: build mini card', operations: [
      { operationId: 'card', command: 'vector.create', parameters: {
        name: 'Batch shape', primitive: { kind: 'rectangle', x: 20, y: 180, width: 120, height: 42 }
      } },
      { operationId: 'name-card', command: 'layer.rename', parameters: {
        layerId: { resultOf: 'card', field: 'layerId' }, name: 'Agent mini card'
      } },
      { operationId: 'shadow', command: 'layer.effect.add', parameters: {
        layerId: { resultOf: 'card', field: 'layerId' }, effectKind: 'drop-shadow',
        settings: { distance: 8, size: 6, opacity: 0.5 }
      } }
    ]
  }, { requireCompleted: false });
  const batchTask = await driver.waitForTask(semanticDocumentId, batchAccepted.taskId);
  const batchLatencyMs = performance.now() - batchStartedAt;
  const batchDocument = await driver.queryDocument(semanticDocumentId);
  const batchLayer = (await driver.queryLayers(semanticDocumentId))?.find(({ name }) => name === 'Agent mini card');
  const batchEffects = batchLayer ? await driver.queryLayerEffects(semanticDocumentId, batchLayer.id) : null;
  const batchRenderTelemetry = await driver.queryRenderTelemetry(semanticDocumentId);
  if (batchTask.status !== 'completed' || !batchLayer || batchEffects?.effects[0]?.kind !== 'drop-shadow'
    || batchDocument.history.undoDepth !== batchHistoryBefore + 1
    || Number(batchRenderTelemetry?.submittedFrames ?? 99) > 3) {
    throw new Error(`Atomic mini-design batch or undo boundary is incorrect: ${JSON.stringify({ batchTask, batchLayer, batchEffects, batchDocument, batchRenderTelemetry })}`);
  }
  await driver.execute(semanticDocumentId, 'history.undo', {});
  if ((await driver.queryLayers(semanticDocumentId))?.some(({ name }) => name === 'Agent mini card')) {
    throw new Error('One batch undo did not restore the exact baseline.');
  }
  await driver.execute(semanticDocumentId, 'history.redo', {});
  if (!(await driver.queryLayers(semanticDocumentId))?.some(({ name }) => name === 'Agent mini card')) {
    throw new Error('One batch redo did not restore the mini design.');
  }
  const nativeExport = await driver.execute(semanticDocumentId, 'file.exportNative', {}, { requireCompleted: false });
  const nativeTask = await driver.waitForTask(semanticDocumentId, nativeExport.taskId);
  const psdExport = await driver.execute(semanticDocumentId, 'file.exportPsd', {}, { requireCompleted: false });
  const psdTask = await driver.waitForTask(semanticDocumentId, psdExport.taskId);
  if (!nativeTask.artifact || !psdTask.artifact) throw new Error('Placed document exports did not complete.');
  const nativeOpen = await driver.executeWorkspace('file.openArtifact', { artifactId: nativeTask.artifact.id });
  const nativeDocumentId = nativeOpen.value?.documentId;
  if (!nativeDocumentId) throw new Error('Native text roundtrip did not return a document ID.');
  await driver.waitForDocument(nativeDocumentId);
  const nativeLayers = await driver.waitForLayers(nativeDocumentId);
  const nativeTextLayer = nativeLayers?.find(({ name }) => name === 'Semantic text');
  const nativeText = nativeTextLayer ? await driver.queryText(nativeDocumentId, nativeTextLayer.id) : null;
  if (!nativeTextLayer || nativeText?.content.text !== 'Semantic text 👋') {
    throw new Error(`Native text roundtrip did not preserve editable content: ${JSON.stringify({ nativeText, nativeLayers })}`);
  }
  const nativeVectorLayer = nativeLayers?.find(({ name }) => name === 'Semantic vector');
  const nativeVector = nativeVectorLayer ? await driver.queryVector(nativeDocumentId, nativeVectorLayer.id) : null;
  if (!nativeVector?.elements.length) throw new Error('Native vector roundtrip lost editable geometry.');
  const psdOpen = await driver.executeWorkspace('file.openArtifact', { artifactId: psdTask.artifact.id });
  const psdDocumentId = psdOpen.value?.documentId;
  if (!psdDocumentId) throw new Error('PSD text roundtrip did not return a document ID.');
  await driver.waitForDocument(psdDocumentId);
  const psdLayers = await driver.waitForLayers(psdDocumentId);
  const psdTextLayer = psdLayers?.find(({ name }) => name === 'Semantic text');
  const psdText = psdTextLayer ? await driver.queryText(psdDocumentId, psdTextLayer.id) : null;
  if (!psdText?.editable || psdText.content.text !== 'Semantic text 👋') {
    throw new Error(`PSD text roundtrip lost editable content: ${JSON.stringify({ psdText, psdLayers })}`);
  }
  const psdVectorLayer = psdLayers?.find(({ name }) => name === 'Semantic vector');
  const psdVector = psdVectorLayer ? await driver.queryVector(psdDocumentId, psdVectorLayer.id) : null;
  const psdEffects = psdVectorLayer ? await driver.queryLayerEffects(psdDocumentId, psdVectorLayer.id) : null;
  if (!psdVector?.elements.length || !psdEffects?.effects.some(({ kind }) => kind === 'drop-shadow')) {
    throw new Error(`PSD vector/style roundtrip lost editable semantics: ${JSON.stringify({ psdVector, psdEffects })}`);
  }
  const workspace = await driver.queryWorkspace();
  const documentId = workspace?.documents.find(({ title }) => title === path.basename(sourceFile))?.id;
  if (!documentId) throw new Error('No active document.');
  const before = await driver.queryDocument(documentId);
  const layerProjection = await driver.queryLayers(documentId) ?? [];
  const activeLayer = layerProjection.find(({ id }) => id === before?.activeLayerId);
  if (!activeLayer) throw new Error('No active layer projection.');
  const zoom = await driver.execute(documentId, 'view.setZoom', { mode: 'custom', percent: 175 });
  const hidden = await driver.execute(documentId, 'layer.setVisibility', {
    layerIds: [activeLayer.id], visible: false
  });
  const shown = await driver.execute(documentId, 'layer.setVisibility', {
    layerIds: [activeLayer.id], visible: true
  });
  const created = await driver.execute(documentId, 'layer.createRaster', {});
  const createdId = (await driver.queryDocument(documentId))?.activeLayerId;
  if (!createdId) throw new Error('Raster command did not select a layer.');
  const renamed = await driver.execute(documentId, 'layer.rename', {
    layerId: createdId, name: 'Command driver layer'
  });
  const undone = await driver.execute(documentId, 'history.undo', {});
  const pngExport = await driver.execute(documentId, 'file.exportPng', {}, { requireCompleted: false });
  if (pngExport.status !== 'accepted') throw new Error('PNG artifact export was not accepted.');
  const pngTask = await driver.waitForTask(documentId, pngExport.taskId);
  if (!pngTask.artifact) throw new Error('PNG artifact task did not publish an artifact.');

  const runGesture = async (request, samples) => {
    const started = await driver.beginGesture(request);
    if (started?.status !== 'started') throw new Error(`Gesture did not start: ${JSON.stringify(started)}`);
    await driver.updateGesture(started.gestureId, samples);
    return driver.finishGesture(started.gestureId, true);
  };
  const translated = await runGesture({
    documentId, kind: 'layer-translate', coordinateSpace: 'document',
    parameters: { layerId: createdId }, sample: { x: 20, y: 20 }
  }, [{ x: 32, y: 27 }]);
  const selected = await runGesture({
    documentId, kind: 'selection-rectangle', coordinateSpace: 'document',
    parameters: { mode: 'replace' }, sample: { x: 20, y: 20 }
  }, [{ x: 120, y: 100 }]);
  const painted = await runGesture({
    documentId, kind: 'brush-stroke', coordinateSpace: 'document',
    parameters: { layerId: createdId, channel: 'pixels' }, sample: { x: 50, y: 50, pressure: 1 }
  }, [{ x: 90, y: 75, pressure: 0.8 }]);
  const report = {
    workspace, semantic: { create: semanticCreate, placements, layers: placedLayers,
      text: { created: textCreated, projection: textProjection, latenciesMs: textLatencies,
        nativeDocumentId, psdDocumentId },
      vector: { created: vectorCreated, effectCreated, projection: vectorProjection,
        effects: effectProjection, latenciesMs: { create: vectorCreateLatencyMs, effect: effectCreateLatencyMs },
        nativeLayerId: nativeVectorLayer.id, psdLayerId: psdVectorLayer.id },
      batch: { accepted: batchAccepted, task: batchTask, latencyMs: batchLatencyMs, renderTelemetry: batchRenderTelemetry,
        layerId: batchLayer.id, events: await driver.queryTaskEvents(0, 200) },
      exports: { native: nativeTask, psd: psdTask } },
    before, layersBefore: layerProjection.length,
    results: { zoom, hidden, shown, created, renamed, undone },
    artifactExport: { accepted: pngExport, task: pngTask },
    gestures: { translated, selected, painted },
    after: await driver.queryDocument(documentId),
    layersAfter: await driver.queryLayers(documentId)
  };

  await page.screenshot({ path: screenshotPath });
  const rejected = Object.values(report.results).filter((result) => result.status !== 'completed');
  const rejectedGestures = Object.values(report.gestures).filter((result) => result.status !== 'completed');
  if (rejected.length || rejectedGestures.length || pageErrors.length) {
    throw new Error(`Command driver smoke failed: ${JSON.stringify({ rejected, rejectedGestures, pageErrors })}`);
  }
  await writeFile(reportPath, `${JSON.stringify({ ...report, pageErrors, screenshotPath }, null, 2)}\n`);
  process.stdout.write(`Command driver smoke passed. Report: ${reportPath}\n`);
} finally {
  await app.close().catch(() => {});
}
