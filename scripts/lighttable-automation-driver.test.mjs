import assert from 'node:assert/strict';
import test from 'node:test';
import { LightTableAutomationClient } from './lighttable-automation-driver.mjs';

const readyDocument = {
  lifecycle: 'ready',
  canonicalRevision: 7,
  renderer: { status: 'ready', active: true },
  canvas: { width: 32, height: 32 },
  tasks: { activeCount: 0 }
};

test('initial readiness waits for collected submission and composite evidence', async () => {
  let polls = 0;
  const client = new LightTableAutomationClient({
    waitForTimeout: async () => {}
  });
  client.queryWorkspace = async () => ({ activeDocumentId: 'document-1' });
  client.queryDocument = async () => readyDocument;
  client.queryRenderTelemetry = async () => ({
    submittedFrames: polls,
    stages: { 'document-composite': { executions: polls++ } }
  });

  const result = await client.waitForReadyDocument('document-1', 1_000);

  assert.equal(result.document, readyDocument);
  assert.equal(result.telemetry.submittedFrames, 1);
});

test('readiness does not compare session revisions with tree revisions', async () => {
  const client = new LightTableAutomationClient({ waitForTimeout: async () => {} });
  client.queryWorkspace = async () => ({ activeDocumentId: 'document-1' });
  client.queryDocument = async () => ({ ...readyDocument, canonicalRevision: 41 });
  client.queryRenderTelemetry = async () => ({
    submittedFrames: 1,
    // A legacy diagnostic can be present; it is not a session revision.
    presentedDocumentRevision: 0,
    stages: { 'document-composite': { executions: 1 } }
  });

  const result = await client.waitForReadyDocument('document-1', 1_000);
  assert.equal(result.document.canonicalRevision, 41);
  assert.equal(result.telemetry.presentedDocumentRevision, 0);
});

test('readiness rejects an unavailable renderer even with old frame counters', async () => {
  let lifecycle = 'ready';
  const client = new LightTableAutomationClient({
    waitForTimeout: async () => { lifecycle = 'disposed'; }
  });
  client.queryWorkspace = async () => ({ activeDocumentId: 'document-1' });
  client.queryDocument = async () => ({ ...readyDocument, lifecycle,
    renderer: { status: 'initializing', active: true } });
  client.queryRenderTelemetry = async () => ({
    submittedFrames: 1,
    stages: { 'document-composite': { executions: 1 } }
  });

  await assert.rejects(
    client.waitForReadyDocument('document-1', 1_000),
    /did not become active and ready/
  );
});

test('initial readiness rejects collected frames without a document composite', async () => {
  let lifecycle = 'ready';
  const client = new LightTableAutomationClient({
    waitForTimeout: async () => { lifecycle = 'disposed'; }
  });
  client.queryWorkspace = async () => ({ activeDocumentId: 'document-1' });
  client.queryDocument = async () => ({ ...readyDocument, lifecycle });
  client.queryRenderTelemetry = async () => ({
    submittedFrames: 1,
    stages: { 'document-composite': { executions: 0 } }
  });

  await assert.rejects(
    client.waitForReadyDocument('document-1', 1_000),
    /did not become active and ready/
  );
});

test('readiness does not accept a background document', async () => {
  let lifecycle = 'ready';
  const client = new LightTableAutomationClient({
    waitForTimeout: async () => { lifecycle = 'disposed'; }
  });
  client.queryWorkspace = async () => ({ activeDocumentId: 'document-2' });
  client.queryDocument = async () => ({ ...readyDocument, lifecycle });
  client.queryRenderTelemetry = async () => ({
    submittedFrames: 3,
    stages: { 'document-composite': { executions: 1 } }
  });

  await assert.rejects(
    client.waitForReadyDocument('document-1', 1_000),
    /did not become active and ready/
  );
});

test('clean-build readiness is availability only and performs no rendering action', async () => {
  const client = new LightTableAutomationClient({
    waitForTimeout: async () => {},
    evaluate: async () => { throw new Error('Unexpected host action.'); }
  });
  client.queryWorkspace = async () => ({ activeDocumentId: 'document-1' });
  client.queryDocument = async () => ({ ...readyDocument, canonicalRevision: 1 });
  client.queryRenderTelemetry = async () => ({ collectionEnabled: false, submittedFrames: 0,
    stages: { 'document-composite': { executions: 0 } } });
  const result = await client.waitForReadyDocument('document-1', 1_000);
  assert.equal(result.document.canonicalRevision, 1);
  assert.equal(result.telemetry.submittedFrames, 0);
  assert.equal(client.waitForRenderedDocument, undefined);
});

for (const [name, overrides] of [
  ['inactive renderer', { renderer: { status: 'ready', active: false } }],
  ['missing canvas', { canvas: null }],
  ['pending task', { tasks: { activeCount: 1 } }],
  ['failed lifecycle', { lifecycle: 'failed' }]
]) {
  test(`readiness rejects ${name}`, async () => {
    let expired = false;
    const client = new LightTableAutomationClient({ waitForTimeout: async () => { expired = true; } });
    client.queryWorkspace = async () => ({ activeDocumentId: 'document-1' });
    client.queryDocument = async () => expired ? { ...readyDocument, lifecycle: 'disposed' }
      : { ...readyDocument, ...overrides };
    client.queryRenderTelemetry = async () => ({ collectionEnabled: false });
    await assert.rejects(client.waitForReadyDocument('document-1', 1_000), /did not become active and ready/);
  });
}

test('action recording projection and packaged recording controls stay isolated', async () => {
  const recording = { status: 'recording', steps: [{ command: 'grade.setBasic' }] };
  const started = [];
  let stopped = 0;
  const client = new LightTableAutomationClient({
    evaluate: async (callback, argument) => callback(argument)
  });
  const previousWindow = globalThis.window;
  globalThis.window = {
    __lightTableAutomation: {
      actionRecordingSnapshot: () => recording,
      startActionRecording: (name) => started.push(name),
      stopActionRecording: () => { stopped += 1; }
    }
  };
  try {
    assert.equal(await client.queryActionRecording(), recording);
    await client.startActionRecording('Adjustment smoke');
    await client.stopActionRecording();
    assert.deepEqual(started, ['Adjustment smoke']);
    assert.equal(stopped, 1);
  } finally {
    globalThis.window = previousWindow;
  }
});
