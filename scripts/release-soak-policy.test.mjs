import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assessGpuRetentionTrend,
  assessStableTail,
  resolveReleaseSoakPlan
} from './release-soak-policy.mjs';

test('overnight profile represents at least twelve hours and remains overrideable', () => {
  assert.equal(resolveReleaseSoakPlan({ profile: 'overnight' }).durationMinutes, 720);
  assert.equal(resolveReleaseSoakPlan({ profile: 'local' }).stressIterations, 6);
  assert.deepEqual(resolveReleaseSoakPlan({ profile: 'ci', cycles: '3', iterations: '4' }), {
    profile: 'ci', durationMinutes: 0, maximumCycles: 3, stressIterations: 4
  });
});

test('stable-tail assessment rejects zero-action and invalid render samples', () => {
  const valid = {
    sourceFile: 'fixture.png', passed: true, actions: [{}], pageErrors: [],
    growth: { suspicious: false }, background: { submittedFrames: 0 },
    firstUsefulFrame: { status: 'available', milliseconds: 10 },
    samples: [{ gpuBytes: 1, runtimeStopped: false }]
  };
  assert.equal(assessStableTail([valid]).passed, true);
  assert.deepEqual(assessStableTail([{ ...valid, actions: [] }]).reasons, ['fixture.png: zero actions']);
});

test('GPU retention accepts a flat or single bounded lazy realization', () => {
  const samples = (values) => values.map((estimatedGpuBytes) => ({ estimatedGpuBytes }));
  assert.deepEqual(assessGpuRetentionTrend(samples([100, 100, 100])), {
    available: true,
    passed: true,
    reason: 'GPU high-water remained flat',
    baselineBytes: 100,
    peakBytes: 100,
    highWaterGrowthBytes: 0,
    highWaterIncreases: 0,
    positiveRounds: 0,
    highWaterSteps: [],
    tailSampleCount: 4,
    tailHighWaterGrowthBytes: 0,
    tailHighWaterIncreases: 0,
    maximumHighWaterGrowthBytes: 1024 * 1024,
    maximumTailHighWaterIncreases: 1
  });
  const lateRealization = assessGpuRetentionTrend(samples([100, 100, 100, 292, 292]));
  assert.equal(lateRealization.passed, true);
  assert.equal(lateRealization.highWaterGrowthBytes, 192);
  assert.equal(lateRealization.highWaterIncreases, 1);
  assert.equal(lateRealization.reason, 'bounded lazy GPU realization');
});

test('GPU retention ignores oscillation below its high-water mark', () => {
  const result = assessGpuRetentionTrend([
    { estimatedGpuBytes: 100 },
    { estimatedGpuBytes: 292 },
    { estimatedGpuBytes: 100 },
    { estimatedGpuBytes: 292 }
  ]);
  assert.equal(result.passed, true);
  assert.equal(result.highWaterIncreases, 1);
  assert.equal(result.positiveRounds, 2);
});

test('GPU retention separates bounded warm-up from stable-tail growth', () => {
  const result = assessGpuRetentionTrend([
    100, 868, 1636, 2404, 2404, 2404, 2404, 2596, 2596
  ].map((estimatedGpuBytes) => ({ estimatedGpuBytes })));
  assert.equal(result.passed, true);
  assert.equal(result.highWaterIncreases, 4);
  assert.equal(result.tailHighWaterIncreases, 1);
  assert.equal(result.tailHighWaterGrowthBytes, 192);
});

test('GPU retention rejects repeated or unbounded high-water growth', () => {
  const repeated = assessGpuRetentionTrend([100, 100, 100, 100, 100, 292, 484, 676].map((estimatedGpuBytes) => ({
    estimatedGpuBytes
  })));
  assert.equal(repeated.passed, false);
  assert.match(repeated.reason, /stable tail/);

  const large = assessGpuRetentionTrend([
    { estimatedGpuBytes: 100 },
    { estimatedGpuBytes: 100 + 1024 * 1024 + 1 }
  ]);
  assert.equal(large.passed, false);
  assert.match(large.reason, /exceeds 1048576 bytes/);
});

test('GPU retention reports missing telemetry without inventing a failure', () => {
  const result = assessGpuRetentionTrend([
    { estimatedGpuBytes: null },
    { estimatedGpuBytes: undefined }
  ]);
  assert.equal(result.available, false);
  assert.equal(result.passed, true);
});
