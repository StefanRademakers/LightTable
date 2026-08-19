import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LIGHTTABLE_AGENT_ACCESS_COMMAND_IDS,
  LIGHTTABLE_COMMAND_IDS,
  LIGHTTABLE_EXTERNAL_MCP_DEDICATED_COMMAND_IDS,
  LIGHTTABLE_EXTERNAL_MCP_EXECUTE_COMMAND_IDS
} from '../src/index.mjs';

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
