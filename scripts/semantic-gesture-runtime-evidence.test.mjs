import assert from 'node:assert/strict';
import test from 'node:test';
import {
  beginGestureRuntimeEvidence,
  captureGesturePreviewEvidence,
  finishGestureRuntimeEvidence
} from './semantic-gesture-runtime-evidence.mjs';

const createHarness = () => {
  const state = {
    document: { canonicalRevision: 7, history: { undoDepth: 3 } },
    recording: { steps: [], byteLength: 10 },
    telemetry: { submittedFrames: 2, stages: { output: { executions: 2 } } },
    resets: 0
  };
  const driver = {
    queryDocument: async () => structuredClone(state.document),
    queryActionRecording: async () => structuredClone(state.recording),
    queryRenderTelemetry: async () => structuredClone(state.telemetry),
    resetRenderTelemetry: async () => {
      state.resets += 1;
      state.telemetry.submittedFrames = 0;
      return true;
    }
  };
  const page = { waitForTimeout: async () => undefined };
  return { state, driver, page };
};

test('captures local previews followed by one semantic commit and frame', async () => {
  const { state, driver, page } = createHarness();
  const baseline = await beginGestureRuntimeEvidence(driver, 'document-1', 'grade.setBasic');
  assert.equal(state.resets, 1);
  state.telemetry.submittedFrames = 4;
  const preview = await captureGesturePreviewEvidence(
    driver, 'document-1', 'grade.setBasic', baseline
  );
  const evidence = await finishGestureRuntimeEvidence({
    page,
    driver,
    documentId: 'document-1',
    command: 'grade.setBasic',
    label: 'Exposure drag',
    baseline,
    preview,
    localInputUpdates: 20,
    commit: async () => {
      state.document.canonicalRevision += 1;
      state.document.history.undoDepth += 1;
      state.recording.steps.push({ command: 'grade.setBasic' });
      state.recording.byteLength += 120;
      state.telemetry.submittedFrames += 1;
    }
  });
  assert.deepEqual(evidence, {
    label: 'Exposure drag', command: 'grade.setBasic', localInputUpdates: 20,
    recordedSampleCount: null,
    semanticPublications: 1, historyEntries: 1, revisionDelta: 1,
    recorderByteDelta: 120, previewSubmittedFrames: 4, totalSubmittedFrames: 5,
    semanticCommitLatencyMs: evidence.semanticCommitLatencyMs,
    presentedFrameLatencyMs: evidence.presentedFrameLatencyMs,
    renderStages: { output: { executions: 2 } }
  });
});

test('rejects a preview that already crossed the semantic boundary', async () => {
  const { state, driver } = createHarness();
  const baseline = await beginGestureRuntimeEvidence(driver, 'document-1', 'tool.commitGesture');
  state.recording.steps.push({ command: 'tool.commitGesture' });
  await assert.rejects(
    captureGesturePreviewEvidence(driver, 'document-1', 'tool.commitGesture', baseline),
    /published semantic state before commit/
  );
});

test('accepts a GPU pixel commit whose structural document revision is unchanged', async () => {
  const { state, driver, page } = createHarness();
  const baseline = await beginGestureRuntimeEvidence(driver, 'document-1', 'tool.commitGesture');
  const preview = await captureGesturePreviewEvidence(
    driver, 'document-1', 'tool.commitGesture', baseline
  );
  const evidence = await finishGestureRuntimeEvidence({
    page, driver, documentId: 'document-1', command: 'tool.commitGesture',
    label: 'Brush stroke', baseline, preview, localInputUpdates: 25,
    commit: async () => {
      state.document.history.undoDepth += 1;
      state.recording.steps.push({ command: 'tool.commitGesture', result: { sampleCount: 25 } });
      state.telemetry.submittedFrames += 1;
    }
  });
  assert.equal(evidence.revisionDelta, 0);
  assert.equal(evidence.recordedSampleCount, 25);
  assert.equal(evidence.semanticPublications, 1);
  assert.equal(evidence.historyEntries, 1);
});
