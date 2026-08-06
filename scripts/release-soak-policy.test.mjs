import assert from 'node:assert/strict';
import test from 'node:test';
import { assessStableTail, resolveReleaseSoakPlan } from './release-soak-policy.mjs';

test('overnight profile represents at least twelve hours and remains overrideable', () => {
  assert.equal(resolveReleaseSoakPlan({ profile: 'overnight' }).durationMinutes, 720);
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
