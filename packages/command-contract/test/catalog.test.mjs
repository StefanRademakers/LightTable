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

test('versioned layer schemas describe and validate the first complete vertical set', () => {
  assert.deepEqual(Object.keys(LIGHTTABLE_COMMAND_SCHEMAS), [
    'layer.rename',
    'layer.setVisibility',
    'layer.setFillOpacity',
    'layer.setBlendMode',
    'layer.setLock'
  ]);
  for (const [command, schema] of Object.entries(LIGHTTABLE_COMMAND_SCHEMAS)) {
    assert.equal(schema.input.additionalProperties, false, `${command} input must be closed`);
    assert.equal(schema.result.additionalProperties, false, `${command} result must be closed`);
    for (const example of LIGHTTABLE_COMMAND_EXAMPLES[command] ?? []) {
      assert.deepEqual(validateJsonSchemaValue(schema.input, example), { valid: true, issues: [] }, command);
    }
  }
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
});

test('shared result schemas accept the canonical layer result values', () => {
  const cases = {
    'layer.rename': { layerId: 'layer-1', name: 'Hero' },
    'layer.setVisibility': { layerIds: ['layer-1'], visible: false },
    'layer.setFillOpacity': { layerId: 'layer-1', opacity: 0.42 },
    'layer.setBlendMode': { layerId: 'layer-1', blendMode: 'multiply' },
    'layer.setLock': { layerIds: ['layer-1'], lock: 'position', locked: true }
  };
  for (const [command, value] of Object.entries(cases)) {
    assert.deepEqual(validateJsonSchemaValue(LIGHTTABLE_COMMAND_SCHEMAS[command].result, value),
      { valid: true, issues: [] }, command);
  }
});
