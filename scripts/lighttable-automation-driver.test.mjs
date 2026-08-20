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

test('render readiness waits beyond canonical document readiness for a submitted frame', async () => {
  let polls = 0;
  const client = new LightTableAutomationClient({
    waitForTimeout: async () => {}
  });
  client.queryWorkspace = async () => ({ activeDocumentId: 'document-1' });
  client.queryDocument = async () => readyDocument;
  client.queryRenderTelemetry = async () => ({
    submittedFrames: polls,
    presentedDocumentRevision: 7,
    stages: { 'document-composite': { executions: polls++ } }
  });

  const result = await client.waitForRenderedDocument('document-1', 1_000);

  assert.equal(result.document, readyDocument);
  assert.equal(result.telemetry.submittedFrames, 1);
});

test('render readiness accepts a locally edited presentation ahead of canonical state', async () => {
  const client = new LightTableAutomationClient({ waitForTimeout: async () => {} });
  client.queryWorkspace = async () => ({ activeDocumentId: 'document-1' });
  client.queryDocument = async () => ({ ...readyDocument, canonicalRevision: 7 });
  client.queryRenderTelemetry = async () => ({
    submittedFrames: 1,
    presentedDocumentRevision: 8,
    stages: { 'document-composite': { executions: 1 } }
  });

  const result = await client.waitForRenderedDocument('document-1', 1_000);
  assert.equal(result.telemetry.presentedDocumentRevision, 8);
});

test('render readiness rejects a presentation behind canonical state', async () => {
  let lifecycle = 'ready';
  const client = new LightTableAutomationClient({
    waitForTimeout: async () => { lifecycle = 'disposed'; }
  });
  client.queryWorkspace = async () => ({ activeDocumentId: 'document-1' });
  client.queryDocument = async () => ({ ...readyDocument, lifecycle });
  client.queryRenderTelemetry = async () => ({
    submittedFrames: 1,
    presentedDocumentRevision: 6,
    stages: { 'document-composite': { executions: 1 } }
  });

  await assert.rejects(
    client.waitForRenderedDocument('document-1', 1_000),
    /did not publish a rendered frame/
  );
});

test('render readiness rejects presentation-only frames without a document composite', async () => {
  let lifecycle = 'ready';
  const client = new LightTableAutomationClient({
    waitForTimeout: async () => { lifecycle = 'disposed'; }
  });
  client.queryWorkspace = async () => ({ activeDocumentId: 'document-1' });
  client.queryDocument = async () => ({ ...readyDocument, lifecycle });
  client.queryRenderTelemetry = async () => ({
    submittedFrames: 1,
    presentedDocumentRevision: 7,
    stages: { 'document-composite': { executions: 0 } }
  });

  await assert.rejects(
    client.waitForRenderedDocument('document-1', 1_000),
    /did not publish a rendered frame/
  );
});

test('render readiness does not accept a rendered background document', async () => {
  const client = new LightTableAutomationClient({
    waitForTimeout: async () => {}
  });
  client.queryWorkspace = async () => ({ activeDocumentId: 'document-2' });
  client.queryDocument = async () => ({ ...readyDocument, lifecycle: 'disposed' });
  client.queryRenderTelemetry = async () => ({
    submittedFrames: 3,
    presentedDocumentRevision: 7,
    stages: { 'document-composite': { executions: 1 } }
  });

  await assert.rejects(
    client.waitForRenderedDocument('document-1', 1_000),
    /did not publish a rendered frame/
  );
});

test('action recording projection stays read-only through the automation client', async () => {
  const recording = { status: 'recording', steps: [{ command: 'grade.setBasic' }] };
  const client = new LightTableAutomationClient({
    evaluate: async (callback) => callback({
      __lightTableAutomation: { actionRecordingSnapshot: () => recording }
    })
  });
  const previousWindow = globalThis.window;
  globalThis.window = {
    __lightTableAutomation: { actionRecordingSnapshot: () => recording }
  };
  try {
    assert.equal(await client.queryActionRecording(), recording);
  } finally {
    globalThis.window = previousWindow;
  }
});
