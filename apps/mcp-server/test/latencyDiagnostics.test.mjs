import assert from 'node:assert/strict';
import test from 'node:test';
import { McpLatencyDiagnostics } from '../src/latencyDiagnostics.mjs';

test('MCP latency diagnostics correlate bounded tool, command and bridge timings', async () => {
  let monotonic = 0;
  let wall = 1_000;
  const diagnostics = new McpLatencyDiagnostics({
    now: () => monotonic,
    wallNow: () => wall,
    maximum: 16
  });
  const client = diagnostics.instrument({
    async invoke(method, parameters) {
      monotonic += method === 'command.execute' ? 7 : 3;
      wall += 1;
      if (method === 'task.query') return {
        id: 'task-1', status: 'completed', elapsedMs: 41, durationMs: 40
      };
      return method === 'command.execute'
        ? { status: 'completed', value: { changed: true } }
        : { activeDocumentId: 'document-1', parameters };
    }
  });

  await diagnostics.measureTool('lighttable_context', async () => {
    monotonic += 2;
    await client.invoke('workspace.query');
    await client.invoke('command.execute', { command: 'layer.rename' });
    monotonic += 1;
  });
  await client.invoke('task.query', { taskId: 'task-1' });

  const report = diagnostics.snapshot(16);
  const tool = report.entries.find(({ kind }) => kind === 'tool');
  assert.deepEqual(tool, {
    id: 1, kind: 'tool', name: 'lighttable_context', outcome: 'completed',
    startedAt: 1_000, durationMs: 13, parentToolCallId: null,
    bridgeMs: 10, serverOverheadMs: 3
  });
  assert.deepEqual(report.entries.filter(({ kind }) => kind === 'bridge').map((entry) => ({
    name: entry.name, command: entry.command, durationMs: entry.durationMs,
    parentToolCallId: entry.parentToolCallId
  })), [
    { name: 'workspace.query', command: null, durationMs: 3, parentToolCallId: 1 },
    { name: 'command.execute', command: 'layer.rename', durationMs: 7, parentToolCallId: 1 },
    { name: 'task.query', command: null, durationMs: 3, parentToolCallId: null }
  ]);
  assert.ok(report.summary.some(({ name, totalMs }) => (
    name === 'command.execute:layer.rename' && totalMs === 7
  )));
  assert.deepEqual(report.tasks, [{
    taskId: 'task-1', elapsedMs: 41, durationMs: 40, observedAt: 1_002
  }]);

  diagnostics.reset();
  assert.equal(diagnostics.snapshot().capturedEntries, 0);
});

test('MCP latency diagnostics retain only the configured bounded tail', async () => {
  let now = 0;
  const diagnostics = new McpLatencyDiagnostics({ now: () => now, wallNow: () => 1, maximum: 16 });
  for (let index = 0; index < 20; index += 1) {
    await diagnostics.measureTool(`tool-${index}`, async () => { now += 1; });
  }
  const report = diagnostics.snapshot(256);
  assert.equal(report.capturedEntries, 16);
  assert.equal(report.droppedEntries, 4);
  assert.equal(report.entries[0].name, 'tool-4');
});
