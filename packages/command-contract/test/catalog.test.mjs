import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LIGHTTABLE_AGENT_ACCESS_COMMAND_IDS,
  LIGHTTABLE_COMMAND_DEFINITIONS,
  LIGHTTABLE_COMMAND_EXAMPLES,
  LIGHTTABLE_COMMAND_IDS,
  LIGHTTABLE_COMMAND_PARAMETER_PROPERTIES,
  LIGHTTABLE_COMMAND_SCHEMAS,
  LIGHTTABLE_EXTERNAL_MCP_DEDICATED_COMMAND_IDS,
  LIGHTTABLE_EXTERNAL_MCP_BATCH_OPERATION_IDS,
  LIGHTTABLE_EXTERNAL_MCP_EXECUTE_COMMAND_IDS,
  validateJsonSchemaValue
} from '../src/index.mjs';

test('every command has categorized Actions metadata and explicit rollout state', () => {
  assert.equal(LIGHTTABLE_COMMAND_DEFINITIONS.length, LIGHTTABLE_COMMAND_IDS.length);
  for (const command of LIGHTTABLE_COMMAND_DEFINITIONS) {
    assert.ok(command.category.length > 0);
    assert.ok(command.label.length > 0);
    assert.ok(command.description.length > 0);
    if (!command.agentAccess) assert.ok(command.agentAccessReason?.length > 0);
    if (command.externalMcp === null) assert.ok(command.externalMcpReason?.length > 0);
  }
});

test('every command has exactly one synchronized parameter property map', () => {
  assert.deepEqual(Object.keys(LIGHTTABLE_COMMAND_PARAMETER_PROPERTIES), [...LIGHTTABLE_COMMAND_IDS]);
  for (const command of LIGHTTABLE_COMMAND_DEFINITIONS) {
    const properties = LIGHTTABLE_COMMAND_PARAMETER_PROPERTIES[command.id];
    assert.equal(typeof properties, 'object');
    assert.equal(Object.keys(properties).length === 0, command.invocation === 'direct');
  }
});

test('every external MCP command is enforced by the downstream Agent Access profile', () => {
  const agentAccess = new Set(LIGHTTABLE_AGENT_ACCESS_COMMAND_IDS);
  for (const command of [
    ...LIGHTTABLE_EXTERNAL_MCP_EXECUTE_COMMAND_IDS,
    ...LIGHTTABLE_EXTERNAL_MCP_DEDICATED_COMMAND_IDS
  ]) {
    assert.equal(agentAccess.has(command), true, `${command} is not allowed by Agent Access`);
  }
});

test('external semantic contracts do not bind replaceable implementation identities', () => {
  const forbidden = new Set([
    'modelId', 'backend', 'expectedBackend', 'candidate', 'tensor', 'graphNames',
    'artifactRevision', 'preprocessingRevision', 'maskBytes', 'pointerId',
    'previewReused', 'correctionMatrix', 'diagnostics', 'algorithm'
  ]);
  const visit = (value, command, path = '') => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      assert.equal(forbidden.has(key), false,
        `${command} leaks implementation field ${path}/${key}`);
      visit(child, command, `${path}/${key}`);
    }
  };
  for (const command of LIGHTTABLE_EXTERNAL_MCP_EXECUTE_COMMAND_IDS) {
    const schema = LIGHTTABLE_COMMAND_SCHEMAS[command];
    if (schema) visit(schema, command);
  }
});

test('current remote rollout remains a strict subset of the application command contract', () => {
  const application = new Set(LIGHTTABLE_COMMAND_IDS);
  assert.ok(LIGHTTABLE_AGENT_ACCESS_COMMAND_IDS.length < LIGHTTABLE_COMMAND_IDS.length);
  for (const command of LIGHTTABLE_AGENT_ACCESS_COMMAND_IDS) assert.equal(application.has(command), true);
  assert.equal(LIGHTTABLE_AGENT_ACCESS_COMMAND_IDS.includes('document.duplicate'), true);
  assert.equal(LIGHTTABLE_AGENT_ACCESS_COMMAND_IDS.includes('document.resizeImage'), true);
  assert.equal(LIGHTTABLE_AGENT_ACCESS_COMMAND_IDS.includes('document.applyGeometry'), true);
  assert.equal(LIGHTTABLE_AGENT_ACCESS_COMMAND_IDS.includes('faceWarp.applyOperation'), false);
});

test('versioned schemas describe and validate every completed command vertical', () => {
  assert.deepEqual(Object.keys(LIGHTTABLE_COMMAND_SCHEMAS), [
    'adjustment.create',
    'file.exportNative',
    'file.exportPng',
    'file.exportBitmap',
    'file.exportPsd',
    'file.openArtifact',
    'layer.placeArtifact',
    'selection.copyPixels',
    'selection.pastePixels',
    'layer.autoAlign',
    'document.assignProfile',
    'document.resizeImage',
    'document.applyGeometry',
    'document.duplicate',
    'document.create',
    'raster.invert',
    'text.convertToShape',
    'text.rasterize',
    'tool.commitGesture',
    'grade.setBasic',
    'grade.copy',
    'grade.paste',
    'history.undo',
    'history.redo',
    'layer.style.setEnabled',
    'layer.style.update',
    'layer.effect.setEnabled',
    'layer.effect.add',
    'layer.effect.update',
    'layer.effect.remove',
    'layer.effect.move',
    'layer.createRaster',
    'layer.setMask',
    'layer.duplicate',
    'layer.copyToNewLayer',
    'layer.delete',
    'layer.move',
    'layer.setClipping',
    'layer.rename',
    'layer.setVisibility',
    'layer.setFillOpacity',
    'layer.setBlendMode',
    'layer.setLock',
    'layer.removeBackground',
    'layer.merge',
    'layer.flattenGroup',
    'document.flattenImage',
    'raster.fill',
    'raster.applyGradient',
    'selection.applyShape',
    'selection.applyMagicWand',
    'selection.selectSubject',
    'selection.modify',
    'task.cancel',
    'text.create',
    'text.replaceRange',
    'text.format',
    'text.setLayout',
    'layer.setTransform',
    'transform.applyFixed',
    'vector.create',
    'vector.update',
    'vector.remove',
    'view.setZoom',
    'warp.applyStroke',
    'command.batch'
  ]);
  for (const [command, schema] of Object.entries(LIGHTTABLE_COMMAND_SCHEMAS)) {
    assert.equal(schema.input.additionalProperties, false, `${command} input must be closed`);
    assert.equal(schema.result.additionalProperties, false, `${command} result must be closed`);
    for (const example of LIGHTTABLE_COMMAND_EXAMPLES[command] ?? []) {
      assert.deepEqual(validateJsonSchemaValue(schema.input, example), { valid: true, issues: [] }, command);
    }
  }
});

test('document creation schema keeps exact workspace document semantics', () => {
  const create = LIGHTTABLE_COMMAND_SCHEMAS['document.create'];
  for (const example of LIGHTTABLE_COMMAND_EXAMPLES['document.create']) {
    assert.deepEqual(validateJsonSchemaValue(create.input, example), { valid: true, issues: [] });
  }
  assert.equal(validateJsonSchemaValue(create.input, {
    ...LIGHTTABLE_COMMAND_EXAMPLES['document.create'][0], bitDepth: '8'
  }).valid, false);
  assert.equal(validateJsonSchemaValue(create.input, {
    ...LIGHTTABLE_COMMAND_EXAMPLES['document.create'][0], backgroundColor: '#ffffff'
  }).valid, false);
  assert.equal(validateJsonSchemaValue(create.input, {
    ...LIGHTTABLE_COMMAND_EXAMPLES['document.create'][0], background: { kind: 'solid' }
  }).valid, false);
  assert.deepEqual(validateJsonSchemaValue(create.result, { documentId: 'document-created' }),
    { valid: true, issues: [] });
});

test('document size and geometry schemas expose only bounded final operations', () => {
  const resize = LIGHTTABLE_COMMAND_SCHEMAS['document.resizeImage'];
  const geometry = LIGHTTABLE_COMMAND_SCHEMAS['document.applyGeometry'];
  for (const example of LIGHTTABLE_COMMAND_EXAMPLES['document.resizeImage']) {
    assert.equal(validateJsonSchemaValue(resize.input, example).valid, true);
  }
  for (const example of LIGHTTABLE_COMMAND_EXAMPLES['document.applyGeometry']) {
    assert.equal(validateJsonSchemaValue(geometry.input, example).valid, true, JSON.stringify(example));
  }
  for (const invalid of [
    { ...LIGHTTABLE_COMMAND_EXAMPLES['document.resizeImage'][0], width: 16385 },
    { ...LIGHTTABLE_COMMAND_EXAMPLES['document.resizeImage'][0], previewPixels: [] }
  ]) assert.equal(validateJsonSchemaValue(resize.input, invalid).valid, false);
  for (const invalid of [
    { operation: 'crop', bounds: { x: 0, y: 0, width: 0, height: 100 } },
    { operation: 'rotate', rotation: { degrees: 1e20 } },
    { operation: 'flip', axis: 'horizontal', bounds: { x: 0, y: 0, width: 1, height: 1 } },
    { operation: 'canvas-size', width: 100, height: 100, anchorX: 0.5, anchorY: 0.5,
      cropOverlay: true }
  ]) assert.equal(validateJsonSchemaValue(geometry.input, invalid).valid, false, JSON.stringify(invalid));
  assert.equal(validateJsonSchemaValue(resize.result, {
    width: 1200, height: 800, resolutionPpi: 144
  }).valid, true);
  assert.equal(validateJsonSchemaValue(geometry.result, {
    operation: 'rotate', width: 800, height: 1200
  }).valid, true);
});

test('atomic batch schema is derived from complete commands and preserves result references', () => {
  const batch = LIGHTTABLE_COMMAND_SCHEMAS['command.batch'];
  const variants = batch.input.properties.operations.items.oneOf;
  assert.deepEqual(variants.map(({ properties }) => properties.command.const),
    [...LIGHTTABLE_EXTERNAL_MCP_BATCH_OPERATION_IDS]);
  for (const command of LIGHTTABLE_EXTERNAL_MCP_BATCH_OPERATION_IDS) {
    assert.ok(LIGHTTABLE_COMMAND_SCHEMAS[command], `${command} lacks its source contract`);
  }

  const example = LIGHTTABLE_COMMAND_EXAMPLES['command.batch'][0];
  assert.equal(validateJsonSchemaValue(batch.input, example).valid, true);
  for (const invalid of [
    { ...example, privateState: true },
    { ...example, operations: [{ operationId: 'x', command: 'file.exportPng', parameters: {} }] },
    { ...example, operations: [{ operationId: 'x', command: 'layer.rename', parameters: {
      layerId: { resultOf: 'create-title', field: 'layerId', pointerId: 4 }, name: 'Title'
    } }] },
    { ...example, operations: [{ operationId: 'x', command: 'layer.rename', parameters: {
      layerId: { resultOf: 'create-title', field: 'privateResult' }, name: 'Title'
    } }] },
    { ...example, operations: [{ operationId: 'x', command: 'layer.rename', parameters: {
      layerId: 'title', name: 'Title', rendererState: {}
    } }] }
  ]) assert.equal(validateJsonSchemaValue(batch.input, invalid).valid, false,
    JSON.stringify(invalid));

  assert.equal(validateJsonSchemaValue(batch.result, { results: [
    { operationId: 'create-title', value: { layerId: 'title', fontStatus: {
      kind: 'exact', assetId: 'lighttable-inter-latin-regular', family: 'Inter'
    } } },
    { operationId: 'rename-title', value: { layerId: 'title', name: 'Hero title' } }
  ] }).valid, true);
  assert.equal(validateJsonSchemaValue(batch.result, { results: [
    { operationId: 'rename-title', value: { layerId: 'title', privateResult: true } }
  ] }).valid, false);
});

test('conditional text schemas distinguish point, paragraph, path and ranged edits', () => {
  const create = LIGHTTABLE_COMMAND_SCHEMAS['text.create'].input;
  const base = { text: 'Title', origin: { x: 20, y: 30 } };
  assert.equal(validateJsonSchemaValue(create, { ...base, mode: 'point' }).valid, true);
  assert.equal(validateJsonSchemaValue(create, { ...base, mode: 'point', frame: { width: 100, height: 40 } }).valid, false);
  assert.equal(validateJsonSchemaValue(create, { ...base, mode: 'paragraph' }).valid, false);
  assert.equal(validateJsonSchemaValue(create, { ...base, mode: 'paragraph', frame: { width: 100, height: 40 } }).valid, true);
  assert.equal(validateJsonSchemaValue(create, { ...base, mode: 'path' }).valid, false);
  assert.equal(validateJsonSchemaValue(create, { ...base, mode: 'path', path: {
    layerId: 'paths', elementId: 'curve', subpathId: 'main', startOffset: 0,
    side: 'left', upright: true, direction: 'forward'
  } }).valid, true);

  const format = LIGHTTABLE_COMMAND_SCHEMAS['text.format'].input;
  assert.equal(validateJsonSchemaValue(format, { layerId: 'title' }).valid, false);
  assert.equal(validateJsonSchemaValue(format, { layerId: 'title', style: {} }).valid, false);
  assert.equal(validateJsonSchemaValue(format, { layerId: 'title', style: { fontSize: 48 } }).valid, true);
  assert.equal(validateJsonSchemaValue(format, { layerId: 'title', start: 0, style: { underline: true } }).valid, false);
  assert.equal(validateJsonSchemaValue(format, {
    layerId: 'title', start: 0, end: 5, style: { underline: true }
  }).valid, true);
});

test('shared integer bounds reject unsafe text offsets before domain parsing', () => {
  const replace = LIGHTTABLE_COMMAND_SCHEMAS['text.replaceRange'].input;
  assert.equal(validateJsonSchemaValue(replace, {
    layerId: 'title', start: -1, end: 0, text: 'x'
  }).valid, false);
  assert.equal(validateJsonSchemaValue(replace, {
    layerId: 'title', start: 0, end: 1000001, text: 'x'
  }).valid, false);
});

test('shared schemas reject missing, extra, oversized and contradictory layer input', () => {
  const rename = LIGHTTABLE_COMMAND_SCHEMAS['layer.rename'].input;
  assert.equal(validateJsonSchemaValue(rename, { layerId: 'layer-1' }).valid, false);
  assert.equal(validateJsonSchemaValue(rename, { layerId: 'layer-1', name: '   ' }).valid, false);
  assert.equal(validateJsonSchemaValue(rename, { layerId: 'layer-1', name: 'Name', privateState: true }).valid, false);
  assert.equal(validateJsonSchemaValue(rename, { layerId: 'x'.repeat(257), name: 'Name' }).valid, false);

  const opacity = LIGHTTABLE_COMMAND_SCHEMAS['layer.setFillOpacity'].input;
  assert.equal(validateJsonSchemaValue(opacity, { layerId: 'layer-1', opacity: -0.01 }).valid, false);
  assert.equal(validateJsonSchemaValue(opacity, { layerId: 'layer-1', opacity: 1.01 }).valid, false);
  assert.equal(validateJsonSchemaValue(opacity, { layerId: 'layer-1', opacity: Number.NaN }).valid, false);

  const lock = LIGHTTABLE_COMMAND_SCHEMAS['layer.setLock'].input;
  assert.equal(validateJsonSchemaValue(lock, {
    layerIds: ['layer-1'], lock: 'made-up', locked: true
  }).valid, false);

  const duplicate = LIGHTTABLE_COMMAND_SCHEMAS['layer.duplicate'].input;
  assert.equal(validateJsonSchemaValue(duplicate, { layerId: '' }).valid, false);
  assert.equal(validateJsonSchemaValue(duplicate, { layerId: 'layer-1', selection: {} }).valid, false);
  const deletion = LIGHTTABLE_COMMAND_SCHEMAS['layer.delete'].input;
  assert.equal(validateJsonSchemaValue(deletion, { layerIds: [] }).valid, false);
  assert.equal(validateJsonSchemaValue(deletion, { layerIds: ['x'.repeat(257)] }).valid, false);
  const move = LIGHTTABLE_COMMAND_SCHEMAS['layer.move'].input;
  assert.equal(validateJsonSchemaValue(move, { layerId: 'layer-1', direction: 'left' }).valid, false);
  const clipping = LIGHTTABLE_COMMAND_SCHEMAS['layer.setClipping'].input;
  assert.equal(validateJsonSchemaValue(clipping, { layerId: 'layer-1', clipping: 1 }).valid, false);
});

test('shared result schemas accept the canonical layer result values', () => {
  const cases = {
    'layer.rename': { layerId: 'layer-1', name: 'Hero' },
    'layer.setVisibility': { layerIds: ['layer-1'], visible: false },
    'layer.setFillOpacity': { layerId: 'layer-1', opacity: 0.42 },
    'layer.setBlendMode': { layerId: 'layer-1', blendMode: 'multiply' },
    'layer.setLock': { layerIds: ['layer-1'], lock: 'position', locked: true },
    'layer.duplicate': { sourceLayerId: 'layer-1', layerId: 'layer-copy' },
    'layer.copyToNewLayer': { sourceLayerId: 'layer-1', layerId: 'layer-copy', scope: 'selection' },
    'layer.delete': { layerIds: ['layer-1'] },
    'layer.move': { layerId: 'layer-1', direction: 'up' },
    'layer.setClipping': { layerId: 'layer-1', clipping: true }
  };
  for (const [command, value] of Object.entries(cases)) {
    assert.deepEqual(validateJsonSchemaValue(LIGHTTABLE_COMMAND_SCHEMAS[command].result, value),
      { valid: true, issues: [] }, command);
  }
});

test('shared result schemas accept canonical text IDs and optional exact font status', () => {
  const cases = {
    'text.create': { layerId: 'text-title', fontStatus: {
      kind: 'exact', assetId: 'font-inter', family: 'Inter', style: 'Regular'
    } },
    'text.replaceRange': { layerId: 'text-title' },
    'text.format': { layerId: 'text-title' },
    'text.setLayout': { layerId: 'text-title' }
  };
  for (const [command, value] of Object.entries(cases)) {
    assert.deepEqual(validateJsonSchemaValue(LIGHTTABLE_COMMAND_SCHEMAS[command].result, value),
      { valid: true, issues: [] }, command);
  }
});

test('transform schemas distinguish exact matrices from contextual fixed operations', () => {
  const matrix = { a: 1, b: 0, c: 0, d: 1, tx: 32, ty: 16 };
  const setTransform = LIGHTTABLE_COMMAND_SCHEMAS['layer.setTransform'];
  assert.equal(validateJsonSchemaValue(setTransform.input, {
    layerId: 'hero', transform: matrix
  }).valid, true);
  assert.equal(validateJsonSchemaValue(setTransform.input, {
    layerId: 'hero', transform: { ...matrix, tx: 10000001 }
  }).valid, false);
  assert.equal(validateJsonSchemaValue(setTransform.input, {
    layerId: 'hero', transform: { ...matrix, runtimeBounds: [0, 0, 1, 1] }
  }).valid, false);
  assert.deepEqual(validateJsonSchemaValue(setTransform.result, {
    layerId: 'hero', transform: matrix
  }), { valid: true, issues: [] });

  const fixed = LIGHTTABLE_COMMAND_SCHEMAS['transform.applyFixed'];
  assert.equal(validateJsonSchemaValue(fixed.input, { operation: 'rotate-clockwise-90' }).valid, true);
  assert.equal(validateJsonSchemaValue(fixed.input, { operation: 'rotate-45' }).valid, false);
  assert.deepEqual(validateJsonSchemaValue(fixed.result, {
    operation: 'flip-horizontal', target: 'selection', documentRevision: 7
  }), { valid: true, issues: [] });
  assert.equal(validateJsonSchemaValue(fixed.result, {
    operation: 'flip-horizontal', target: 'canvas'
  }).valid, false);
});

test('layer mask schemas require only operation-relevant properties', () => {
  const create = LIGHTTABLE_COMMAND_SCHEMAS['layer.createRaster'];
  assert.deepEqual(validateJsonSchemaValue(create.input, {}), { valid: true, issues: [] });
  assert.equal(validateJsonSchemaValue(create.input, { internalPreset: true }).valid, false);
  assert.deepEqual(validateJsonSchemaValue(create.result, {
    created: true, layerId: 'new-raster'
  }), { valid: true, issues: [] });

  const mask = LIGHTTABLE_COMMAND_SCHEMAS['layer.setMask'];
  for (const value of [
    { layerId: 'photo', operation: 'add', source: 'selection' },
    { layerId: 'photo', operation: 'remove' },
    { layerId: 'photo', operation: 'set-enabled', enabled: false },
    { layerId: 'photo', operation: 'set-linked', linked: false }
  ]) assert.equal(validateJsonSchemaValue(mask.input, value).valid, true, JSON.stringify(value));
  for (const value of [
    { layerId: 'photo', operation: 'add', enabled: true },
    { layerId: 'photo', operation: 'remove', source: 'reveal-all' },
    { layerId: 'photo', operation: 'set-enabled' },
    { layerId: 'photo', operation: 'set-linked', linked: true, enabled: true }
  ]) assert.equal(validateJsonSchemaValue(mask.input, value).valid, false, JSON.stringify(value));
});

test('selection schemas bound final geometry, sampled recipes and conditional feather state', () => {
  const shape = LIGHTTABLE_COMMAND_SCHEMAS['selection.applyShape'];
  const rectangle = {
    mode: 'replace', shape: {
      kind: 'rectangle', points: [{ x: 20, y: 30 }, { x: 260, y: 180 }]
    }, featherRadius: 0, antiAlias: true
  };
  assert.equal(validateJsonSchemaValue(shape.input, rectangle).valid, true);
  assert.equal(validateJsonSchemaValue(shape.result, rectangle).valid, true);
  assert.equal(validateJsonSchemaValue(shape.input, {
    ...rectangle, shape: { ...rectangle.shape, points: [...rectangle.shape.points, { x: 1, y: 2 }] }
  }).valid, false);
  assert.equal(validateJsonSchemaValue(shape.input, {
    mode: 'replace', shape: { kind: 'polygon', points: [{ x: 1, y: 2 }, { x: 3, y: 4 }] }
  }).valid, false);

  const wand = LIGHTTABLE_COMMAND_SCHEMAS['selection.applyMagicWand'];
  const sampled = {
    kind: 'magic-wand', layerId: 'photo', point: { x: 320, y: 180 }, mode: 'replace',
    options: { sampleSize: 3, tolerance: 20, antiAlias: true,
      contiguous: true, sampleAllLayers: false }
  };
  assert.equal(validateJsonSchemaValue(wand.input, sampled).valid, true);
  assert.equal(validateJsonSchemaValue(wand.input, {
    ...sampled, options: { ...sampled.options, generatedMask: [0, 1] }
  }).valid, false);
  assert.equal(validateJsonSchemaValue(wand.input, {
    ...sampled, point: { ...sampled.point, pressure: 0.7 }
  }).valid, false);

  const subject = LIGHTTABLE_COMMAND_SCHEMAS['selection.selectSubject'];
  const subjectIntent = {
    kind: 'subject', sourceLayerId: 'photo', mode: 'replace', sampleAllLayers: false
  };
  assert.equal(validateJsonSchemaValue(subject.input, subjectIntent).valid, true);
  for (const privateKey of ['prompt', 'pointerId', 'generatedMask', 'backend', 'candidate',
    'modelId', 'refinementQuality']) {
    assert.equal(validateJsonSchemaValue(subject.input, {
      ...subjectIntent, [privateKey]: {}
    }).valid, false, `Select Subject must reject ${privateKey}`);
  }
  assert.equal(validateJsonSchemaValue(subject.result, subjectIntent).valid, true);

  const modify = LIGHTTABLE_COMMAND_SCHEMAS['selection.modify'];
  assert.equal(validateJsonSchemaValue(modify.input, {
    kind: 'modify', operation: 'feather', radius: 12
  }).valid, true);
  assert.equal(validateJsonSchemaValue(modify.input, {
    kind: 'modify', operation: 'feather'
  }).valid, false);
  assert.equal(validateJsonSchemaValue(modify.input, {
    kind: 'modify', operation: 'invert', radius: 12
  }).valid, false);
});

test('basic Grade schema requires a bounded partial patch and explicit target', () => {
  const grade = LIGHTTABLE_COMMAND_SCHEMAS['grade.setBasic'];
  for (const value of [
    { target: { kind: 'document' }, values: { exposureEV: 1.25, contrast: -20 } },
    { target: { kind: 'layer', layerId: 'photo' }, values: {
      temperature: -100, saturation: 100
    } }
  ]) assert.equal(validateJsonSchemaValue(grade.input, value).valid, true, JSON.stringify(value));
  for (const value of [
    { target: { kind: 'document' }, values: {} },
    { target: { kind: 'document', activeLayerId: 'private' }, values: { exposureEV: 1 } },
    { target: { kind: 'layer' }, values: { contrast: 1 } },
    { target: { kind: 'document' }, values: { exposureEV: 5.01 } },
    { target: { kind: 'document' }, values: { privateCurve: [0, 1] } }
  ]) assert.equal(validateJsonSchemaValue(grade.input, value).valid, false, JSON.stringify(value));
  assert.equal(validateJsonSchemaValue(grade.result, {
    target: { kind: 'document' }, values: { exposureEV: 1.25 }, changed: true
  }).valid, true);
});

test('destructive merge and flatten schemas require explicit bounded targets and stable outputs', () => {
  const merge = LIGHTTABLE_COMMAND_SCHEMAS['layer.merge'];
  assert.equal(validateJsonSchemaValue(merge.input, {
    layerIds: ['bottom', 'top']
  }).valid, true);
  assert.equal(validateJsonSchemaValue(merge.result, {
    layerIds: ['bottom', 'top'], outputLayerId: 'merged'
  }).valid, true);
  assert.equal(validateJsonSchemaValue(merge.input, {
    layerIds: ['same', 'same']
  }).valid, false);
  assert.equal(validateJsonSchemaValue(merge.input, {
    layerIds: ['bottom', 'top'], preserveSources: true
  }).valid, false);

  const group = LIGHTTABLE_COMMAND_SCHEMAS['layer.flattenGroup'];
  assert.equal(validateJsonSchemaValue(group.input, { groupId: 'card' }).valid, true);
  assert.equal(validateJsonSchemaValue(group.input, { groupId: '' }).valid, false);

  const image = LIGHTTABLE_COMMAND_SCHEMAS['document.flattenImage'];
  assert.deepEqual(validateJsonSchemaValue(image.input, {}), { valid: true, issues: [] });
  assert.equal(validateJsonSchemaValue(image.input, { preserveLayers: true }).valid, false);
  assert.equal(validateJsonSchemaValue(image.result, { outputLayerId: 'flattened' }).valid, true);
});

test('raster and text finalization schemas retain stable layer identity', () => {
  const invert = LIGHTTABLE_COMMAND_SCHEMAS['raster.invert'];
  assert.equal(validateJsonSchemaValue(invert.input, {
    layerId: 'photo', channel: 'pixels'
  }).valid, true);
  assert.equal(validateJsonSchemaValue(invert.result, {
    layerId: 'photo', channel: 'mask'
  }).valid, true);
  assert.equal(validateJsonSchemaValue(invert.input, {
    layerId: 'photo', channel: 'all'
  }).valid, false);

  const shape = LIGHTTABLE_COMMAND_SCHEMAS['text.convertToShape'];
  const raster = LIGHTTABLE_COMMAND_SCHEMAS['text.rasterize'];
  assert.equal(validateJsonSchemaValue(shape.input, { layerId: 'heading' }).valid, true);
  assert.equal(validateJsonSchemaValue(shape.result, {
    layerId: 'heading', outputType: 'vector'
  }).valid, true);
  assert.equal(validateJsonSchemaValue(shape.result, {
    layerId: 'heading', outputType: 'raster'
  }).valid, false);
  assert.equal(validateJsonSchemaValue(raster.result, {
    layerId: 'caption', outputType: 'raster'
  }).valid, true);
  assert.equal(validateJsonSchemaValue(raster.input, {
    layerId: 'caption', preserveText: true
  }).valid, false);
});

test('raster paint schemas describe final bounded GPU operations, not pointer streams', () => {
  const fill = LIGHTTABLE_COMMAND_SCHEMAS['raster.fill'];
  assert.equal(validateJsonSchemaValue(fill.input, {
    layerId: 'photo', channel: 'pixels', color: '#2F80ed',
    preserveTransparency: false, opacity: 1
  }).valid, true);
  assert.equal(validateJsonSchemaValue(fill.input, {
    layerId: 'photo', channel: 'pixels', color: '#fff', pointerSamples: []
  }).valid, false);
  assert.equal(validateJsonSchemaValue(fill.result, {
    layerId: 'photo', channel: 'mask'
  }).valid, true);

  const gradient = LIGHTTABLE_COMMAND_SCHEMAS['raster.applyGradient'];
  const example = LIGHTTABLE_COMMAND_EXAMPLES['raster.applyGradient'][0];
  assert.equal(validateJsonSchemaValue(gradient.input, example).valid, true);
  assert.equal(validateJsonSchemaValue(gradient.result, {
    layerId: 'photo', channel: 'pixels'
  }).valid, true);
  assert.equal(validateJsonSchemaValue(gradient.input, {
    ...example, paint: { ...example.paint, coordinateSpace: 'object-bounds' }
  }).valid, false);
  assert.equal(validateJsonSchemaValue(gradient.input, {
    ...example, paint: { ...example.paint, pointerPath: [[0, 0], [10, 10]] }
  }).valid, false);
});

test('vector schemas resolve shared definitions and reject UI-only or contradictory state', () => {
  const create = LIGHTTABLE_COMMAND_SCHEMAS['vector.create'];
  const update = LIGHTTABLE_COMMAND_SCHEMAS['vector.update'];
  const remove = LIGHTTABLE_COMMAND_SCHEMAS['vector.remove'];
  for (const example of LIGHTTABLE_COMMAND_EXAMPLES['vector.create']) {
    assert.equal(validateJsonSchemaValue(create.input, example).valid, true);
  }
  assert.equal(validateJsonSchemaValue(update.input,
    LIGHTTABLE_COMMAND_EXAMPLES['vector.update'][0]).valid, true);
  assert.equal(validateJsonSchemaValue(remove.input,
    LIGHTTABLE_COMMAND_EXAMPLES['vector.remove'][0]).valid, true);
  assert.equal(validateJsonSchemaValue(create.input, {
    ...LIGHTTABLE_COMMAND_EXAMPLES['vector.create'][0], pointerSamples: []
  }).valid, false);
  assert.equal(validateJsonSchemaValue(update.input, {
    layerId: 'shapes', elementId: 'card'
  }).valid, false);
  assert.equal(validateJsonSchemaValue(update.input, {
    layerId: 'shapes', elementId: 'card',
    geometry: { kind: 'ellipse', width: 20, height: 10 }, fillRule: 'evenodd'
  }).valid, false);
  assert.equal(validateJsonSchemaValue(remove.result, {
    layerId: 'shapes', elementId: 'card'
  }).valid, true);
  assert.deepEqual(Object.keys(remove.input.$defs), ['id']);
  assert.ok(JSON.stringify(remove).length < 1_000);
  assert.equal(validateJsonSchemaValue({ $ref: '#/$defs/missing', $defs: {} }, 1).valid, false);
});

test('layer effect schemas expose editable styles without accepting private or mixed-kind state', () => {
  const stack = LIGHTTABLE_COMMAND_SCHEMAS['layer.style.update'];
  const add = LIGHTTABLE_COMMAND_SCHEMAS['layer.effect.add'];
  const update = LIGHTTABLE_COMMAND_SCHEMAS['layer.effect.update'];
  const toggle = LIGHTTABLE_COMMAND_SCHEMAS['layer.effect.setEnabled'];
  assert.equal(validateJsonSchemaValue(add.input, {
    layerId: 'title', effectKind: 'drop-shadow',
    settings: { color: { r: 0, g: 0, b: 0, a: 1 }, opacity: 0.6, size: 24, distance: 12 }
  }).valid, true);
  assert.equal(validateJsonSchemaValue(update.input, {
    layerId: 'title', effectId: 'shadow', settings: { opacity: 0.4, size: 18 }
  }).valid, true);
  assert.equal(validateJsonSchemaValue(update.input, {
    layerId: 'title', effectId: 'shadow', settings: { opacity: 0.4, pointerState: {} }
  }).valid, false);
  assert.equal(validateJsonSchemaValue(stack.input, {
    layerId: 'title', settings: { scale: 1.5, globalLight: { angle: 120, altitude: 30 } }
  }).valid, true);
  assert.equal(validateJsonSchemaValue(stack.input, {
    layerId: 'title', settings: { scale: 0 }
  }).valid, false);
  assert.equal(validateJsonSchemaValue(stack.input, {
    layerId: 'title', settings: { globalLight: { angle: 120, altitude: 30, liveDrag: true } }
  }).valid, false);
  assert.equal(validateJsonSchemaValue(add.input, {
    layerId: 'title', effectKind: 'stroke', settings: { fill: { type: 'color',
      color: { r: 1, g: 1, b: 1, a: 1 }, privateTexture: true } }
  }).valid, false);
  assert.equal(validateJsonSchemaValue(update.input, {
    layerId: 'title', effectId: 'shadow', settings: {}
  }).valid, false);
  assert.equal(validateJsonSchemaValue(toggle.result, {
    layerId: 'title', effectId: 'shadow', enabled: false
  }).valid, true);
  assert.equal(validateJsonSchemaValue(add.result, {
    layerId: 'title', effectId: 'shadow'
  }).valid, true);
});

test('artifact schemas carry opaque handles and stable document or layer results only', () => {
  const open = LIGHTTABLE_COMMAND_SCHEMAS['file.openArtifact'];
  const place = LIGHTTABLE_COMMAND_SCHEMAS['layer.placeArtifact'];
  const copyPixels = LIGHTTABLE_COMMAND_SCHEMAS['selection.copyPixels'];
  const pastePixels = LIGHTTABLE_COMMAND_SCHEMAS['selection.pastePixels'];
  const copyGrade = LIGHTTABLE_COMMAND_SCHEMAS['grade.copy'];
  const pasteGrade = LIGHTTABLE_COMMAND_SCHEMAS['grade.paste'];
  assert.equal(validateJsonSchemaValue(open.input, { artifactId: 'artifact-1' }).valid, true);
  assert.equal(validateJsonSchemaValue(open.input, {
    artifactId: 'artifact-1', bytes: 'base64'
  }).valid, false);
  assert.equal(validateJsonSchemaValue(open.result, { documentId: 'document-1' }).valid, true);
  assert.equal(validateJsonSchemaValue(place.input, {
    artifactId: 'artifact-1', name: 'Placed image', x: -20, y: 40
  }).valid, true);
  assert.equal(validateJsonSchemaValue(place.input, {
    artifactId: 'artifact-1', name: '   '
  }).valid, false);
  assert.equal(validateJsonSchemaValue(place.result, {
    layerId: 'placed-1', width: 512, height: 384
  }).valid, true);
  assert.equal(validateJsonSchemaValue(copyPixels.input, { source: 'merged' }).valid, true);
  assert.equal(validateJsonSchemaValue(copyPixels.input, {
    source: 'merged', bytesBase64: 'private'
  }).valid, false);
  assert.equal(validateJsonSchemaValue(pastePixels.input, {
    artifactId: 'artifact-copy', bounds: { x: -4, y: 8, width: 20, height: 12 },
    name: 'Pasted Selection'
  }).valid, true);
  assert.equal(validateJsonSchemaValue(pastePixels.input, {
    artifactId: 'artifact-copy', bounds: { x: 0, y: 0, width: 20, height: 12 },
    filePath: 'private.png'
  }).valid, false);
  assert.equal(validateJsonSchemaValue(copyGrade.input, {}).valid, true);
  assert.equal(validateJsonSchemaValue(copyGrade.input, { settings: {} }).valid, false);
  assert.equal(validateJsonSchemaValue(copyGrade.result, {
    name: 'Portrait', hasLookAsset: true,
    artifact: { id: 'artifact-grade', kind: 'grade-clipboard',
      name: 'Portrait.ltgrade-clipboard',
      mediaType: 'application/vnd.lighttable.grade-clipboard',
      byteLength: 4096, createdAt: 1 }
  }).valid, true);
  assert.equal(validateJsonSchemaValue(pasteGrade.input, {
    artifactId: 'artifact-grade'
  }).valid, true);
  assert.equal(validateJsonSchemaValue(pasteGrade.input, {
    artifactId: 'artifact-grade', lutBase64: 'private'
  }).valid, false);
  assert.equal(validateJsonSchemaValue(pasteGrade.result, {
    name: 'Portrait', changed: true, hasLookAsset: true, importedLookAsset: true
  }).valid, true);
  assert.deepEqual(Object.keys(open.input.$defs), ['artifactId']);
});

test('view, history and task schemas expose only bounded discrete control state', () => {
  const zoom = LIGHTTABLE_COMMAND_SCHEMAS['view.setZoom'];
  assert.equal(validateJsonSchemaValue(zoom.input, { mode: 'fit' }).valid, true);
  assert.equal(validateJsonSchemaValue(zoom.input, { mode: '100' }).valid, true);
  assert.equal(validateJsonSchemaValue(zoom.input, { mode: 'custom', percent: 150 }).valid, true);
  assert.equal(validateJsonSchemaValue(zoom.input, { mode: 'custom' }).valid, false);
  assert.equal(validateJsonSchemaValue(zoom.input, { mode: 'fit', percent: 100 }).valid, false);
  assert.equal(validateJsonSchemaValue(zoom.input, { mode: 'custom', percent: 25601 }).valid, false);
  assert.equal(validateJsonSchemaValue(zoom.input, {
    mode: 'custom', percent: 100, pointerDelta: 2
  }).valid, false);
  assert.equal(validateJsonSchemaValue(zoom.result, { viewport: {
    zoomMode: 'custom', scale: 1.5, panX: -24, panY: 16
  } }).valid, true);

  for (const command of ['history.undo', 'history.redo']) {
    const schema = LIGHTTABLE_COMMAND_SCHEMAS[command];
    assert.equal(validateJsonSchemaValue(schema.input, {}).valid, true);
    assert.equal(validateJsonSchemaValue(schema.input, { steps: 2 }).valid, false);
    assert.equal(validateJsonSchemaValue(schema.result, {
      changed: true, documentChanged: command === 'history.undo'
    }).valid, true);
  }

  const cancel = LIGHTTABLE_COMMAND_SCHEMAS['task.cancel'];
  assert.equal(validateJsonSchemaValue(cancel.input, { taskId: 'task-export-1' }).valid, true);
  assert.equal(validateJsonSchemaValue(cancel.input, { taskId: '', force: true }).valid, false);
  assert.equal(validateJsonSchemaValue(cancel.result, { taskId: 'task-export-1' }).valid, true);
});

test('export schemas return bounded opaque metadata with command-specific kinds', () => {
  const metadata = {
    id: 'artifact-1', name: 'output.png', mediaType: 'image/png',
    byteLength: 1024, createdAt: 1
  };
  const cases = [
    ['file.exportNative', 'native-document'],
    ['file.exportPng', 'png-export'],
    ['file.exportPsd', 'psd-export']
  ];
  for (const [command, kind] of cases) {
    const schema = LIGHTTABLE_COMMAND_SCHEMAS[command];
    assert.equal(validateJsonSchemaValue(schema.input, {}).valid, true);
    assert.equal(validateJsonSchemaValue(schema.input, { path: 'D:/output' }).valid, false);
    assert.equal(validateJsonSchemaValue(schema.result, {
      artifact: { ...metadata, kind }
    }).valid, true, command);
    assert.equal(validateJsonSchemaValue(schema.result, {
      artifact: { ...metadata, kind: kind === 'png-export' ? 'psd-export' : 'png-export' }
    }).valid, false, `${command} must reject another export kind`);
    assert.equal(validateJsonSchemaValue(schema.result, {
      artifact: { ...metadata, kind, bytesBase64: 'not-allowed' }
    }).valid, false, `${command} must reject artifact bytes`);
  }
  const bitmapSchema = LIGHTTABLE_COMMAND_SCHEMAS['file.exportBitmap'];
  for (const [format, kind, mediaType] of [
    ['jpeg', 'jpeg-export', 'image/jpeg'],
    ['webp', 'webp-export', 'image/webp'],
    ['tiff', 'tiff-export', 'image/tiff']
  ]) {
    assert.equal(validateJsonSchemaValue(bitmapSchema.input, { format }).valid, true);
    assert.equal(validateJsonSchemaValue(bitmapSchema.result, {
      artifact: { ...metadata, kind, mediaType }
    }).valid, true, format);
  }
  assert.equal(validateJsonSchemaValue(bitmapSchema.input, {}).valid, false);
  assert.equal(validateJsonSchemaValue(bitmapSchema.input, { format: 'png' }).valid, false);
  assert.equal(validateJsonSchemaValue(bitmapSchema.result, {
    artifact: { ...metadata, kind: 'png-export' }
  }).valid, false);
  assert.equal(validateJsonSchemaValue(LIGHTTABLE_COMMAND_SCHEMAS['file.exportPsd'].result, {
    artifact: { ...metadata, kind: 'psd-export', compatibilityFindings: [{
      severity: 'degraded-editability', code: 'face-warp-baked',
      path: 'layers[0]', message: 'Face Warp was baked.'
    }] }
  }).valid, true);
});

test('adjustment creation schemas preserve exact placement semantics', () => {
  const create = LIGHTTABLE_COMMAND_SCHEMAS['adjustment.create'];
  for (const example of LIGHTTABLE_COMMAND_EXAMPLES['adjustment.create']) {
    assert.equal(validateJsonSchemaValue(create.input, example).valid, true);
  }
  for (const invalid of [
    { kind: 'threshold', placement: 'local', layerId: 'photo' },
    { kind: 'grade', placement: 'local' },
    { kind: 'curves', placement: 'attached', layerId: 'photo', aboveLayerId: 'anchor' },
    { kind: 'curves', placement: 'adjustment-layer', layerId: 'photo' },
    { kind: 'vibrance', placement: 'adjustment-layer' },
    { kind: 'grade', placement: 'local', layerId: 'photo', panelState: {} }
  ]) assert.equal(validateJsonSchemaValue(create.input, invalid).valid, false, JSON.stringify(invalid));
  assert.equal(validateJsonSchemaValue(create.result, {
    kind: 'grade', placement: 'local', layerId: 'photo'
  }).valid, true);
  assert.equal(validateJsonSchemaValue(create.result, {
    kind: 'threshold', placement: 'attached', layerId: 'photo', adjustmentId: 'adjustment-1'
  }).valid, true);
  assert.equal(validateJsonSchemaValue(create.result, {
    kind: 'curves', placement: 'adjustment-layer', layerId: 'curves-1'
  }).valid, true);
});

test('Assign Profile is a closed metadata operation and not a pixel conversion', () => {
  const assign = LIGHTTABLE_COMMAND_SCHEMAS['document.assignProfile'];
  assert.equal(validateJsonSchemaValue(assign.input, { profile: 'srgb' }).valid, true);
  assert.equal(validateJsonSchemaValue(assign.input, {
    profile: 'srgb', convertPixels: true
  }).valid, false);
  assert.equal(validateJsonSchemaValue(assign.input, {
    profile: 'srgb', iccBytes: 'base64'
  }).valid, false);
  assert.equal(validateJsonSchemaValue(assign.input, {
    profile: 'adobe-rgb-1998'
  }).valid, false);
  assert.equal(validateJsonSchemaValue(assign.result, {
    profile: 'srgb', profileState: 'assigned', changed: true
  }).valid, true);
});

test('Auto Align schema exposes semantic targets and outcome, not estimator state', () => {
  const align = LIGHTTABLE_COMMAND_SCHEMAS['layer.autoAlign'];
  assert.equal(validateJsonSchemaValue(align.input, {
    referenceLayerId: 'reference', targetLayerId: 'target'
  }).valid, true);
  for (const privateField of ['model', 'confidence', 'diagnostics', 'correctionMatrix', 'previewReused']) {
    assert.equal(validateJsonSchemaValue(align.input, {
      referenceLayerId: 'reference', targetLayerId: 'target', [privateField]: true
    }).valid, false, privateField);
  }
  assert.equal(validateJsonSchemaValue(align.result, {
    changed: true, referenceLayerId: 'reference', targetLayerId: 'target'
  }).valid, true);
  assert.equal(validateJsonSchemaValue(align.result, {
    changed: true, referenceLayerId: 'reference', targetLayerId: 'target', confidence: 0.98
  }).valid, false);
});

test('committed gesture schema describes final recipes without UI pointer state', () => {
  const gesture = LIGHTTABLE_COMMAND_SCHEMAS['tool.commitGesture'];
  for (const example of LIGHTTABLE_COMMAND_EXAMPLES['tool.commitGesture']) {
    assert.equal(validateJsonSchemaValue(gesture.input, example).valid, true,
      JSON.stringify(example));
  }
  const baseBrush = LIGHTTABLE_COMMAND_EXAMPLES['tool.commitGesture'][0];
  for (const invalid of [
    { ...baseBrush, pointerId: 4 },
    { ...baseBrush, samples: [{ x: 1, y: 2, pointerType: 'pen' }] },
    { ...baseBrush, parameters: { ...baseBrush.parameters, runtimeTexture: {} } },
    { ...baseBrush, parameters: { ...baseBrush.parameters, erase: true,
      operator: { operator: 'tone', mode: 'dodge', range: 'midtones',
        spongeMode: 'saturate', protectTones: true, vibrance: true } } },
    { kind: 'selection-rectangle', parameters: { mode: 'replace', layerId: 'x' },
      samples: [{ x: 0, y: 0 }, { x: 10, y: 10 }] },
    { kind: 'layer-translate', parameters: { layerId: 'x', delta: [1, 2] },
      samples: [{ x: 0, y: 0 }, { x: 10, y: 10 }] }
  ]) assert.equal(validateJsonSchemaValue(gesture.input, invalid).valid, false,
    JSON.stringify(invalid));
  assert.equal(validateJsonSchemaValue(gesture.result, {
    kind: 'brush-stroke', sampleCount: 2
  }).valid, true);
});

test('Warp schema retains authored stroke data but rejects preview and renderer state', () => {
  const warp = LIGHTTABLE_COMMAND_SCHEMAS['warp.applyStroke'];
  const example = LIGHTTABLE_COMMAND_EXAMPLES['warp.applyStroke'][0];
  assert.equal(validateJsonSchemaValue(warp.input, example).valid, true);
  for (const invalid of [
    { ...example, previewFrame: 12 },
    { ...example, settings: { ...example.settings, debugView: 'displacement' } },
    { ...example, samples: [{ ...example.samples[0], pointerId: 7 }] },
    { ...example, samples: [{ ...example.samples[0], tilt: [-91, 0] }] },
    { ...example, durationMs: 3600001 }
  ]) assert.equal(validateJsonSchemaValue(warp.input, invalid).valid, false,
    JSON.stringify(invalid));
  assert.equal(validateJsonSchemaValue(warp.result, {
    layerId: 'photo', strokeId: 'stroke-1', sampleCount: 2
  }).valid, true);
});
