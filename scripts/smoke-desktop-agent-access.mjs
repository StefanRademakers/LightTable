import { _electron as electron } from 'playwright-core';
import { access, mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { resolveDesktopTestLaunch, waitForDesktopLauncher } from './desktop-test-startup.mjs';

const root = path.resolve(import.meta.dirname, '..');
const fixture = path.resolve(process.argv[2] ?? 'D:\\shapes.psd');
const evidenceDirectory = path.join(root, 'tmp', 'agent-access-smoke');
const screenshot = path.join(root, 'tmp', 'screenshots', 'agent-access-settings.png');
const preferencesScreenshot = path.join(root, 'tmp', 'screenshots', 'preferences-file-handling.png');
const launch = await resolveDesktopTestLaunch(root);
await Promise.all([access(fixture), mkdir(evidenceDirectory, { recursive: true }),
  mkdir(path.dirname(screenshot), { recursive: true })]);
const userData = await mkdtemp(path.join(evidenceDirectory, 'profile-'));

const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
let app;
let lastAddress;
const invoke = async (address, token, method, parameters = {}, requestId = crypto.randomUUID()) => {
  const response = await fetch(`${address}/invoke`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ requestId, method, parameters })
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(`Agent invoke failed (${response.status}): ${JSON.stringify(payload)}`);
  return payload.value;
};
const agentGradient = (tx) => ({ kind: 'gradient',
  asset: { id: 'agent-gradient', name: 'Agent gradient', type: 'solid', smoothness: 1,
    colorStops: [
      { id: 'cool', position: 0, midpoint: 0.5, color: { r: 0.1, g: 0.3, b: 1, a: 1 } },
      { id: 'warm', position: 1, midpoint: 0.5, color: { r: 1, g: 0.35, b: 0.1, a: 1 } }
    ], opacityStops: [
      { id: 'opacity-0', position: 0, midpoint: 0.5, opacity: 1 },
      { id: 'opacity-1', position: 1, midpoint: 0.5, opacity: 1 }
    ], roughness: 0, seed: 0 }, shape: 'linear', coordinateSpace: 'document',
  transform: { a: 260, b: 0, c: 0, d: 260, tx, ty: 80 }, reverse: false,
  dither: true, interpolation: 'perceptual' });

try {
  app = await electron.launch({ executablePath: launch.executablePath, args: launch.args, cwd: root,
    env: { ...environment, LIGHTTABLE_AUTOMATION_USER_DATA: userData, LIGHTTABLE_AUTOMATION_OPEN_FILE: fixture },
    timeout: 30_000 });
  const window = await app.firstWindow({ timeout: 30_000 });
  const pageErrors = [];
  window.on('pageerror', (error) => pageErrors.push(error.message));
  const open = await waitForDesktopLauncher({
    app, page: window, outputDirectory: evidenceDirectory,
    sourceFile: fixture, pageErrors, label: 'agent-access'
  });
  await open.click();
  await window.locator('.lighttable-toolbar__meta').filter({ hasText: /ready/i }).waitFor({ timeout: 60_000 });
  if ((await app.windows()).length !== 1) throw new Error('Agent Access launched another Electron window.');

  await window.getByRole('menuitem', { name: 'Edit' }).click();
  await window.getByRole('menuitem', { name: 'Preferences...' }).click();
  const settings = window.getByRole('dialog', { name: 'Preferences' });
  await settings.getByRole('heading', { name: 'Autosave & recovery' }).waitFor();
  await settings.getByLabel(/Autosave location:/).waitFor();
  await window.screenshot({ path: preferencesScreenshot });
  await settings.getByRole('button', { name: 'Agent Access' }).click();
  const toggle = settings.getByRole('checkbox');
  await toggle.click();
  await settings.getByText(/running|error/, { exact: true }).waitFor({ timeout: 15_000 });
  const initialError = await settings.getByRole('alert').count()
    ? await settings.getByRole('alert').textContent()
    : null;
  if (initialError) throw new Error(`Agent Access enable failed: ${initialError}`);
  const tokenInput = settings.getByLabel('Connection token');
  const address = (await settings.locator('dd').nth(1).textContent())?.trim();
  const token = await tokenInput.inputValue();
  if (!address || !token) throw new Error('Agent Access did not publish its local credentials.');
  lastAddress = address;
  await window.screenshot({ path: screenshot });

  const workspace = await invoke(address, token, 'workspace.query');
  const originalId = workspace.documents[0]?.id;
  if (!originalId) throw new Error('Agent Access could not see the open document.');
  const layers = await invoke(address, token, 'layer.list', { documentId: originalId });
  const layerId = layers[0]?.id;
  if (!layerId) throw new Error('Agent Access could not see the existing layers.');
  const renamed = await invoke(address, token, 'command.execute', {
    commandRequestId: 'agent-rename', command: 'layer.rename', documentId: originalId,
    commandParameters: { layerId, name: 'Renamed through Agent Access' }
  });
  if (renamed.status !== 'completed') throw new Error(`Agent edit did not complete: ${JSON.stringify(renamed)}`);
  await window.getByRole('treeitem', { name: /Renamed through Agent Access/i }).waitFor();

  const gradeSet = await invoke(address, token, 'command.execute', {
    commandRequestId: 'agent-basic-grade', command: 'grade.setBasic', documentId: originalId,
    commandParameters: {
      target: { kind: 'document' },
      values: { exposureEV: 0.4, temperature: -8, vibrance: 16 }
    }
  });
  if (gradeSet.status !== 'completed') {
    throw new Error(`Agent Grade edit did not complete: ${JSON.stringify(gradeSet)}`);
  }
  const afterGradeSet = await invoke(address, token, 'document.query', { documentId: originalId });
  const queriedGrade = await invoke(address, token, 'grade.queryBasic', {
    documentId: originalId, target: { kind: 'document' }
  });
  const afterGradeQuery = await invoke(address, token, 'document.query', { documentId: originalId });
  if (queriedGrade.values?.exposureEV !== 0.4 || queriedGrade.values?.temperature !== -8
    || queriedGrade.values?.vibrance !== 16) {
    throw new Error(`Agent Grade query returned stale values: ${JSON.stringify(queriedGrade)}`);
  }
  if (afterGradeQuery.canonicalRevision !== afterGradeSet.canonicalRevision
    || afterGradeQuery.history.currentStateId !== afterGradeSet.history.currentStateId
    || afterGradeQuery.history.undoDepth !== afterGradeSet.history.undoDepth
    || afterGradeQuery.dirty !== afterGradeSet.dirty) {
    throw new Error('Agent Grade query mutated the document or its history.');
  }

  const textCreated = await invoke(address, token, 'command.execute', {
    commandRequestId: 'agent-create-text', command: 'text.create', documentId: originalId,
    commandParameters: {
      mode: 'point', text: 'Agent title', name: 'Agent Title',
      origin: { x: 80, y: 100 }, writingMode: 'horizontal-tb',
      style: { fontSize: 42, fill: { enabled: true, color: '#f0a020' } }
    }
  });
  const textLayerId = textCreated.status === 'completed' ? textCreated.value?.layerId : null;
  if (!textLayerId) throw new Error(`Agent text creation failed: ${JSON.stringify(textCreated)}`);
  const textFormatted = await invoke(address, token, 'command.execute', {
    commandRequestId: 'agent-format-text', command: 'text.format', documentId: originalId,
    commandParameters: {
      layerId: textLayerId,
      style: { fontSize: 54, syntheticItalic: true, underline: true,
        fill: { enabled: true, color: '#30c0e0' } }
    }
  });
  if (textFormatted.status !== 'completed') {
    throw new Error(`Agent text formatting failed: ${JSON.stringify(textFormatted)}`);
  }
  const queriedText = await invoke(address, token, 'text.query', {
    documentId: originalId, layerId: textLayerId
  });
  if (queriedText.sourceKind !== 'flow' || !queriedText.editable
    || queriedText.content?.text !== 'Agent title'
    || queriedText.styleRuns?.[0]?.fontSize !== 54
    || queriedText.styleRuns?.[0]?.syntheticItalic !== true
    || queriedText.styleRuns?.[0]?.underline !== true
    || !queriedText.styleRuns?.[0]?.fill
    || typeof queriedText.transform?.tx !== 'number'
    || typeof queriedText.transform?.ty !== 'number') {
    throw new Error(`Agent text query is incomplete: ${JSON.stringify(queriedText)}`);
  }

  const shape = await invoke(address, token, 'command.execute', {
    commandRequestId: 'agent-create-badge', command: 'vector.create', documentId: originalId,
    commandParameters: {
      name: 'Agent Badge',
      primitive: { kind: 'ellipse', x: 24, y: 24, width: 160, height: 160 },
      style: { fill: { type: 'solid', color: [0.08, 0.35, 0.9, 1] } }
    }
  });
  const badgeLayerId = shape.status === 'completed' ? shape.value?.layerId : null;
  if (!badgeLayerId) throw new Error(`Agent vector creation failed: ${JSON.stringify(shape)}`);
  const agentPath = await invoke(address, token, 'command.execute', {
    commandRequestId: 'agent-create-pen-path', command: 'vector.create', documentId: originalId,
    commandParameters: {
      layerId: badgeLayerId, name: 'Agent Pen', fillRule: 'nonzero',
      subpaths: [{ closed: false, anchors: [
        { x: 30, y: 35, handleOut: { x: 55, y: 20 }, mode: 'smooth' },
        { x: 110, y: 80, handleIn: { x: 80, y: 95 }, mode: 'smooth' },
        { x: 155, y: 45, mode: 'corner' }
      ] }],
      style: { fill: null, stroke: { paint: { type: 'solid', color: [1, 0.4, 0.1, 1] },
        width: 6, alignment: 'center', cap: 'round', join: 'round', miterLimit: 4,
        dash: [], dashOffset: 0 }, opacity: 0.9 }
    }
  });
  if (agentPath.status !== 'completed' || !agentPath.value?.elementId) {
    throw new Error(`Agent Pen path creation failed: ${JSON.stringify(agentPath)}`);
  }
  const agentPathUpdate = await invoke(address, token, 'command.execute', {
    commandRequestId: 'agent-update-pen-path', command: 'vector.update', documentId: originalId,
    commandParameters: {
      layerId: badgeLayerId, elementId: agentPath.value.elementId, name: 'Agent Pen',
      fillRule: 'nonzero', transform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
      subpaths: [{ closed: false, anchors: [
        { x: 36, y: 40, handleOut: { x: 60, y: 22 }, mode: 'smooth' },
        { x: 110, y: 80, handleIn: { x: 80, y: 95 }, mode: 'smooth' },
        { x: 155, y: 45, mode: 'corner' }
      ] }],
      style: { fill: null, stroke: { paint: { type: 'solid', color: [1, 0.4, 0.1, 1] },
        width: 6, alignment: 'center', cap: 'round', join: 'round', miterLimit: 4,
        dash: [], dashOffset: 0 }, opacity: 0.9 }
    }
  });
  if (agentPathUpdate.status !== 'completed') {
    throw new Error(`Agent Pen path update failed: ${JSON.stringify(agentPathUpdate)}`);
  }
  const selection = await invoke(address, token, 'command.execute', {
    commandRequestId: 'agent-select-badge', command: 'selection.applyShape', documentId: originalId,
    commandParameters: {
      mode: 'replace',
      shape: { kind: 'ellipse', points: [{ x: 24, y: 24 }, { x: 184, y: 184 }] },
      featherRadius: 1,
      antiAlias: true
    }
  });
  if (selection.status !== 'completed') {
    throw new Error(`Agent selection failed: ${JSON.stringify(selection)}`);
  }
  const magicWand = await invoke(address, token, 'command.execute', {
    commandRequestId: 'agent-magic-wand', command: 'selection.applyMagicWand',
    documentId: originalId,
    commandParameters: {
      kind: 'magic-wand', layerId, point: { x: 96, y: 96 }, mode: 'replace',
      options: { sampleSize: 3, tolerance: 24, antiAlias: true,
        contiguous: true, sampleAllLayers: false }
    }
  });
  if (magicWand.status !== 'completed' || magicWand.value?.layerId !== layerId) {
    throw new Error(`Agent Magic Wand failed: ${JSON.stringify(magicWand)}`);
  }
  const transformed = await invoke(address, token, 'command.execute', {
    commandRequestId: 'agent-transform-badge', command: 'layer.setTransform', documentId: originalId,
    commandParameters: {
      layerId: badgeLayerId,
      transform: { a: 1.1, b: 0, c: 0, d: 1.1, tx: 32, ty: 18 }
    }
  });
  const blended = await invoke(address, token, 'command.execute', {
    commandRequestId: 'agent-blend-badge', command: 'layer.setBlendMode', documentId: originalId,
    commandParameters: { layerId: badgeLayerId, blendMode: 'screen' }
  });
  if (transformed.status !== 'completed' || blended.status !== 'completed') {
    throw new Error('Agent badge treatment did not complete.');
  }
  const designedLayers = await invoke(address, token, 'layer.list', { documentId: originalId });
  const badge = designedLayers.find(({ id }) => id === badgeLayerId);
  if (badge?.type !== 'vector' || badge.name !== 'Agent Badge' || badge.blendMode !== 'screen'
    || badge.transform?.tx !== 32 || badge.transform?.ty !== 18
    || badge.vectorContent?.elementCount !== 2) {
    throw new Error(`Agent mixed design state is incomplete: ${JSON.stringify(badge)}`);
  }
  const queriedBadge = await invoke(address, token, 'vector.query', {
    documentId: originalId, layerId: badgeLayerId
  });
  const queriedPath = queriedBadge.elements?.find(({ id }) => id === agentPath.value.elementId);
  if (queriedPath?.type !== 'path' || queriedPath.subpaths?.[0]?.anchors?.length !== 3
    || queriedPath.subpaths[0].anchors[0]?.position?.x !== 36
    || queriedPath.style?.stroke?.width !== 6) {
    throw new Error(`Agent Pen path query is incomplete: ${JSON.stringify(queriedPath)}`);
  }
  const pathTextCreated = await invoke(address, token, 'command.execute', {
    commandRequestId: 'agent-create-path-text', command: 'text.create', documentId: originalId,
    commandParameters: {
      mode: 'path', text: 'Agent path label', name: 'Agent Path Label',
      origin: { x: 36, y: 40 }, writingMode: 'horizontal-tb',
      path: { layerId: badgeLayerId, elementId: agentPath.value.elementId,
        subpathId: queriedPath.subpaths[0].id, startOffset: 12, side: 'right',
        upright: false, direction: 'reverse' },
      style: { fontSize: 28, fill: { enabled: true, color: '#f5f5f5' } }
    }
  });
  const pathTextLayerId = pathTextCreated.status === 'completed'
    ? pathTextCreated.value?.layerId : null;
  if (!pathTextLayerId) {
    throw new Error(`Agent Path Text creation failed: ${JSON.stringify(pathTextCreated)}`);
  }
  const queriedPathText = await invoke(address, token, 'text.query', {
    documentId: originalId, layerId: pathTextLayerId
  });
  if (queriedPathText.content?.text !== 'Agent path label'
    || queriedPathText.layout?.mode !== 'path'
    || queriedPathText.layout.pathLayerId !== badgeLayerId
    || queriedPathText.layout.pathElementId !== agentPath.value.elementId
    || queriedPathText.layout.pathSubpathId !== queriedPath.subpaths[0].id
    || queriedPathText.layout.startOffset !== 12
    || queriedPathText.layout.side !== 'right'
    || queriedPathText.layout.upright !== false
    || queriedPathText.layout.direction !== 'reverse') {
    throw new Error(`Agent Path Text query is incomplete: ${JSON.stringify(queriedPathText)}`);
  }
  const activeBeforeMask = (await invoke(address, token, 'document.query', {
    documentId: originalId
  })).activeLayerId;
  for (const [commandRequestId, commandParameters] of [
    ['agent-add-mask', { layerId, operation: 'add', source: 'reveal-all' }],
    ['agent-disable-mask', { layerId, operation: 'set-enabled', enabled: false }],
    ['agent-unlink-mask', { layerId, operation: 'set-linked', linked: false }]
  ]) {
    const maskResult = await invoke(address, token, 'command.execute', {
      commandRequestId, command: 'layer.setMask', documentId: originalId, commandParameters
    });
    if (maskResult.status !== 'completed') {
      throw new Error(`Agent mask operation failed: ${JSON.stringify(maskResult)}`);
    }
  }
  const afterMaskDocument = await invoke(address, token, 'document.query', { documentId: originalId });
  const maskedLayers = await invoke(address, token, 'layer.list', { documentId: originalId });
  const masked = maskedLayers.find(({ id }) => id === layerId);
  if (afterMaskDocument.activeLayerId !== activeBeforeMask) {
    throw new Error('Explicit Agent mask operations changed the artist active layer.');
  }
  if (!masked?.hasMask || masked.maskContent?.raster?.enabled !== false
    || masked.maskContent?.raster?.linked !== false) {
    throw new Error(`Agent mask state is incomplete: ${JSON.stringify(masked)}`);
  }
  const gradientFill = await invoke(address, token, 'command.execute', {
    commandRequestId: 'agent-create-gradient-fill', command: 'vector.create', documentId: originalId,
    commandParameters: {
      layerName: 'Agent Gradient Fill', layerRole: 'gradient-fill',
      layerOpacity: 0.72, layerBlendMode: 'soft-light', name: 'Gradient Fill',
      primitive: { kind: 'rectangle', x: 0, y: 0, width: 512, height: 512,
        cornerRadii: [0, 0, 0, 0], linkedCorners: true },
      style: { fill: agentGradient(40), stroke: null, opacity: 1 }
    }
  });
  const gradientLayerId = gradientFill.status === 'completed' ? gradientFill.value?.layerId : null;
  const gradientElementId = gradientFill.status === 'completed' ? gradientFill.value?.elementId : null;
  if (!gradientLayerId || !gradientElementId) {
    throw new Error(`Agent Gradient Fill creation failed: ${JSON.stringify(gradientFill)}`);
  }
  const gradientEdit = await invoke(address, token, 'command.execute', {
    commandRequestId: 'agent-edit-gradient-fill', command: 'vector.update', documentId: originalId,
    commandParameters: {
      layerId: gradientLayerId, elementId: gradientElementId,
      style: { fill: agentGradient(65), stroke: null, opacity: 1 }
    }
  });
  if (gradientEdit.status !== 'completed') {
    throw new Error(`Agent Gradient Fill edit failed: ${JSON.stringify(gradientEdit)}`);
  }
  const gradientLayers = await invoke(address, token, 'layer.list', { documentId: originalId });
  const gradientLayer = gradientLayers.find(({ id }) => id === gradientLayerId);
  const queriedGradient = await invoke(address, token, 'vector.query', {
    documentId: originalId, layerId: gradientLayerId
  });
  if (gradientLayer?.vectorRole !== 'gradient-fill' || gradientLayer.opacity !== 0.72
    || gradientLayer.blendMode !== 'soft-light'
    || queriedGradient.elements?.[0]?.style?.fill?.transform?.tx !== 65) {
    throw new Error(`Agent Gradient Fill state is incomplete: ${JSON.stringify({ gradientLayer, queriedGradient })}`);
  }
  const rasterFill = await invoke(address, token, 'command.execute', {
    commandRequestId: 'agent-fill-raster', command: 'raster.fill', documentId: originalId,
    commandParameters: { layerId, channel: 'pixels', color: '#2f80ed',
      preserveTransparency: false, opacity: 0.35 }
  });
  if (rasterFill.status !== 'completed' || rasterFill.value?.layerId !== layerId
    || rasterFill.value?.channel !== 'pixels') {
    throw new Error(`Agent raster Fill failed: ${JSON.stringify(rasterFill)}`);
  }
  const rasterGradient = await invoke(address, token, 'command.execute', {
    commandRequestId: 'agent-gradient-raster', command: 'raster.applyGradient', documentId: originalId,
    commandParameters: { layerId, channel: 'pixels', paint: agentGradient(35),
      opacity: 0.45, blendMode: 'normal' }
  });
  if (rasterGradient.status !== 'completed' || rasterGradient.value?.layerId !== layerId
    || rasterGradient.value?.channel !== 'pixels') {
    throw new Error(`Agent raster Gradient failed: ${JSON.stringify(rasterGradient)}`);
  }
  const toneStroke = await invoke(address, token, 'command.execute', {
    commandRequestId: 'agent-tone-stroke', command: 'tool.commitGesture', documentId: originalId,
    commandParameters: {
      kind: 'brush-stroke', parameters: { layerId, channel: 'pixels', erase: false,
        brush: { presetId: 'round', size: 72, hardness: 0.5, opacity: 1,
          flow: 0.0525, spacing: 0.25, smooth: 0, color: '#000000', backgroundColor: '#ffffff' },
        operator: { operator: 'tone', mode: 'dodge', range: 'midtones',
          spongeMode: 'saturate', protectTones: true, vibrance: true } },
      samples: [{ x: 90, y: 110, pressure: 1 }, { x: 190, y: 130, pressure: 0.8 }]
    }
  });
  if (toneStroke.status !== 'completed' || toneStroke.value?.kind !== 'brush-stroke'
    || toneStroke.value?.sampleCount !== 2) {
    throw new Error(`Agent tone-brush stroke failed: ${JSON.stringify(toneStroke)}`);
  }
  const sampledStroke = await invoke(address, token, 'command.execute', {
    commandRequestId: 'agent-clone-stroke', command: 'tool.commitGesture', documentId: originalId,
    commandParameters: {
      kind: 'brush-stroke', parameters: { layerId, channel: 'pixels', erase: false,
        brush: { presetId: 'round', size: 48, hardness: 0.65, opacity: 1,
          flow: 0.4, spacing: 0.08, smooth: 0, color: '#000000', backgroundColor: '#ffffff' },
        operator: { operator: 'clone', source: { anchorLayerId: layerId, point: { x: 80, y: 80 } },
          sampleMode: 'current', sourceOffset: { x: -80, y: -40 }, diffusion: 5 } },
      samples: [{ x: 160, y: 120, pressure: 1 }, { x: 220, y: 140, pressure: 0.8 }]
    }
  });
  if (sampledStroke.status !== 'completed' || sampledStroke.value?.sampleCount !== 2) {
    throw new Error(`Agent Clone Stamp stroke failed: ${JSON.stringify(sampledStroke)}`);
  }
  const warpApplied = await invoke(address, token, 'command.execute', {
    commandRequestId: 'agent-warp-raster', command: 'warp.applyStroke', documentId: originalId,
    commandParameters: {
      layerId, mode: 'push',
      settings: { diameterPx: 120, strength: 0.75, hardness: 0.5, flow: 1,
        spacing: 0.04, smooth: 0.25, pressureSize: true, pressureStrength: true },
      samples: [
        { positionPx: [120, 140], deltaPx: [0, 0], pressure: 1, tilt: [0, 0], timeMs: 1000 },
        { positionPx: [148, 152], deltaPx: [28, 12], pressure: 0.8, tilt: [12, -8], timeMs: 1016 }
      ],
      startedAtMs: 1000, durationMs: 16
    }
  });
  if (warpApplied.status !== 'completed' || !warpApplied.value?.strokeId) {
    throw new Error(`Agent Warp command failed: ${JSON.stringify(warpApplied)}`);
  }
  const queriedWarp = await invoke(address, token, 'warp.query', {
    documentId: originalId, layerId
  });
  if (queriedWarp?.totalStrokes !== 1 || queriedWarp.totalSamples !== 2
    || queriedWarp.strokes?.[0]?.mode !== 'push'
    || queriedWarp.strokes?.[0]?.samples?.[1]?.positionPx?.[0] !== 148) {
    throw new Error(`Agent Warp query is incomplete: ${JSON.stringify(queriedWarp)}`);
  }
  await window.getByRole('treeitem', { name: /Agent Badge/i }).waitFor();

  const unauthorized = await fetch(`${address}/invoke`, { method: 'POST',
    headers: { authorization: 'Bearer wrong-token' }, body: '{}' });
  if (unauthorized.status !== 401) throw new Error('Invalid Agent Access token was accepted.');
  const created = await invoke(address, token, 'command.execute', {
    commandRequestId: 'agent-create-document', command: 'document.create', commandParameters: {
      name: 'Agent second document', width: 320, height: 240, resolutionPpi: 72,
      bitDepth: 8, profile: 'srgb', background: { kind: 'transparent' }
    }
  });
  if (created.status !== 'completed') throw new Error('Agent document-switch fixture failed.');
  const switched = await invoke(address, token, 'workspace.query');
  if (switched.documents.length !== 2) throw new Error('Agent bridge lost a document during a workspace switch.');

  const oldToken = token;
  await settings.getByRole('button', { name: 'Rotate credentials' }).click();
  await window.waitForFunction((previous) => {
    const input = document.querySelector('.lighttable-agent-settings__token input');
    return input instanceof HTMLInputElement && input.value !== previous;
  }, oldToken);
  const rotatedToken = await tokenInput.inputValue();
  if ((await fetch(`${address}/invoke`, { method: 'POST', headers: { authorization: `Bearer ${oldToken}` }, body: '{}' })).status !== 401) {
    throw new Error('Credential rotation left the previous token active.');
  }
  await invoke(address, rotatedToken, 'workspace.query');

  const interruptedGesture = await invoke(address, rotatedToken, 'gesture.begin', {
    documentId: switched.activeDocumentId, kind: 'selection-rectangle',
    coordinateSpace: 'document', parameters: { mode: 'replace' }, sample: { x: 2, y: 2 }
  });
  if (interruptedGesture.status !== 'started') {
    throw new Error(`Interrupted Agent gesture did not start: ${JSON.stringify(interruptedGesture)}`);
  }

  await settings.getByRole('button', { name: 'Stop' }).click();
  await settings.getByText('stopped', { exact: true }).waitFor();
  await expectClosed(address);
  await toggle.click();
  await settings.getByText('running', { exact: true }).waitFor();
  const restartedAddress = (await settings.locator('dd').nth(1).textContent())?.trim();
  const restartedToken = await tokenInput.inputValue();
  if (!restartedAddress) throw new Error('Agent Access did not restart.');
  lastAddress = restartedAddress;
  const afterRestart = await invoke(restartedAddress, restartedToken, 'workspace.query');
  if (afterRestart.documents.length !== 2) throw new Error('Restarting Agent Access lost open documents.');
  const activeDocumentId = afterRestart.activeDocumentId;
  const recoveredGesture = await invoke(restartedAddress, restartedToken, 'gesture.begin', {
    documentId: activeDocumentId, kind: 'selection-rectangle', coordinateSpace: 'document',
    parameters: { mode: 'replace' }, sample: { x: 4, y: 4 }
  });
  if (recoveredGesture.status !== 'started') {
    throw new Error(`Agent gesture did not recover after bridge restart: ${JSON.stringify(recoveredGesture)}`);
  }
  const canceledGesture = await invoke(restartedAddress, restartedToken, 'gesture.finish', {
    gestureId: recoveredGesture.gestureId, commit: false
  });
  if (canceledGesture.status !== 'canceled') {
    throw new Error(`Recovered Agent gesture did not cancel cleanly: ${JSON.stringify(canceledGesture)}`);
  }
  await settings.getByRole('button', { name: 'Stop' }).click();
  await expectClosed(restartedAddress);
  if (pageErrors.length) throw new Error(`Agent Access page errors: ${pageErrors.join(' | ')}`);
  process.stdout.write(`Desktop Agent Access smoke passed: ${screenshot}\n`);
} finally {
  await app?.close().catch(() => undefined);
  if (lastAddress) await expectClosed(lastAddress);
}

async function expectClosed(address) {
  await fetch(`${address}/health`, { signal: AbortSignal.timeout(1_000) }).then(() => {
    throw new Error(`Agent Access listener remained open at ${address}.`);
  }).catch((reason) => {
    if (reason instanceof Error && reason.message.includes('remained open')) throw reason;
  });
}
