import { performance } from 'node:perf_hooks';

const commandCount = (recording, command) => (
  recording?.steps?.filter((step) => step.command === command).length ?? 0
);

const waitFor = async (page, read, accepts, label, timeoutMs = 15_000) => {
  const deadline = Date.now() + timeoutMs;
  let value = await read();
  while (!accepts(value) && Date.now() < deadline) {
    await page.waitForTimeout(16);
    value = await read();
  }
  if (!accepts(value)) throw new Error(`${label} timed out: ${JSON.stringify(value)}`);
  return value;
};

/** Reset counters and capture the exact semantic publication baseline. */
export const beginGestureRuntimeEvidence = async (driver, documentId, command) => {
  const [document, recording] = await Promise.all([
    driver.queryDocument(documentId),
    driver.queryActionRecording()
  ]);
  if (!document || !recording) throw new Error(`Cannot capture ${command} gesture baseline.`);
  if (!await driver.resetRenderTelemetry(documentId)) {
    throw new Error(`Cannot reset render telemetry for ${command}.`);
  }
  return {
    documentRevision: document.canonicalRevision,
    undoDepth: document.history.undoDepth,
    actionCount: commandCount(recording, command),
    recorderBytes: recording.byteLength
  };
};

export const captureGesturePreviewEvidence = async (
  driver,
  documentId,
  command,
  baseline
) => {
  const [document, recording, telemetry] = await Promise.all([
    driver.queryDocument(documentId),
    driver.queryActionRecording(),
    driver.queryRenderTelemetry(documentId)
  ]);
  const preview = {
    documentRevision: document?.canonicalRevision ?? null,
    undoDepth: document?.history.undoDepth ?? null,
    actionCount: commandCount(recording, command),
    submittedFrames: telemetry?.submittedFrames ?? 0
  };
  if (preview.documentRevision !== baseline.documentRevision
    || preview.undoDepth !== baseline.undoDepth
    || preview.actionCount !== baseline.actionCount) {
    throw new Error(`${command} published semantic state before commit: ${JSON.stringify({ baseline, preview })}`);
  }
  return preview;
};

/**
 * Measure release to one recorded command/history commit and then the first
 * subsequent submitted frame. Durations are diagnostics, not a score.
 */
export const finishGestureRuntimeEvidence = async ({
  page,
  driver,
  documentId,
  command,
  label,
  baseline,
  preview,
  localInputUpdates,
  commit
}) => {
  const startedAt = performance.now();
  await commit();
  const committed = await waitFor(page, async () => {
    const [document, recording] = await Promise.all([
      driver.queryDocument(documentId),
      driver.queryActionRecording()
    ]);
    return { document, recording };
  }, ({ document, recording }) => (
    document?.history.undoDepth === baseline.undoDepth + 1
      && commandCount(recording, command) === baseline.actionCount + 1
  ), `${label} semantic commit`);
  const semanticCommitLatencyMs = performance.now() - startedAt;
  const finalTelemetry = await waitFor(page,
    () => driver.queryRenderTelemetry(documentId),
    (telemetry) => (telemetry?.submittedFrames ?? 0) > preview.submittedFrames,
    `${label} post-commit frame`);
  const presentedFrameLatencyMs = performance.now() - startedAt;
  const finalRecording = committed.recording;
  const publishedStep = finalRecording.steps
    .filter((step) => step.command === command).at(-1);
  const recordedSampleCount = typeof publishedStep?.result?.sampleCount === 'number'
    ? publishedStep.result.sampleCount
    : null;
  const evidence = {
    label,
    command,
    localInputUpdates,
    recordedSampleCount,
    semanticPublications: commandCount(finalRecording, command) - baseline.actionCount,
    historyEntries: committed.document.history.undoDepth - baseline.undoDepth,
    revisionDelta: committed.document.canonicalRevision - baseline.documentRevision,
    recorderByteDelta: finalRecording.byteLength - baseline.recorderBytes,
    previewSubmittedFrames: preview.submittedFrames,
    totalSubmittedFrames: finalTelemetry.submittedFrames,
    semanticCommitLatencyMs: Number(semanticCommitLatencyMs.toFixed(2)),
    presentedFrameLatencyMs: Number(presentedFrameLatencyMs.toFixed(2)),
    renderStages: finalTelemetry.stages
  };
  if (evidence.semanticPublications !== 1 || evidence.historyEntries !== 1) {
    throw new Error(`${label} did not remain one bounded semantic operation: ${JSON.stringify(evidence)}`);
  }
  return evidence;
};
