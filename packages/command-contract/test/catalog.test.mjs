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

test('current remote rollout remains a strict subset of the application command contract', () => {
  const application = new Set(LIGHTTABLE_COMMAND_IDS);
  assert.ok(LIGHTTABLE_AGENT_ACCESS_COMMAND_IDS.length < LIGHTTABLE_COMMAND_IDS.length);
  for (const command of LIGHTTABLE_AGENT_ACCESS_COMMAND_IDS) assert.equal(application.has(command), true);
  assert.equal(LIGHTTABLE_AGENT_ACCESS_COMMAND_IDS.includes('document.duplicate'), false);
  assert.equal(LIGHTTABLE_AGENT_ACCESS_COMMAND_IDS.includes('document.applyGeometry'), false);
  assert.equal(LIGHTTABLE_AGENT_ACCESS_COMMAND_IDS.includes('faceWarp.applyOperation'), false);
});

test('versioned schemas describe and validate every completed command vertical', () => {
  assert.deepEqual(Object.keys(LIGHTTABLE_COMMAND_SCHEMAS), [
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
    'text.create',
    'text.replaceRange',
    'text.format',
    'text.setLayout',
    'layer.setTransform',
    'transform.applyFixed'
  ]);
  for (const [command, schema] of Object.entries(LIGHTTABLE_COMMAND_SCHEMAS)) {
    assert.equal(schema.input.additionalProperties, false, `${command} input must be closed`);
    assert.equal(schema.result.additionalProperties, false, `${command} result must be closed`);
    for (const example of LIGHTTABLE_COMMAND_EXAMPLES[command] ?? []) {
      assert.deepEqual(validateJsonSchemaValue(schema.input, example), { valid: true, issues: [] }, command);
    }
  }
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
