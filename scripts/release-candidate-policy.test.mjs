import assert from 'node:assert/strict';
import test from 'node:test';
import { assessMultiHourSoakEvidence, TWO_HOURS_MS } from './release-candidate-policy.mjs';

const commit = 'a'.repeat(40);
const valid = () => ({
  passed: true,
  validity: { commit, worktreeDirty: false },
  elapsedMs: TWO_HOURS_MS + 1,
  cycles: [{ passed: true }, { passed: true }],
  orphanProcesses: []
});

test('accepts exact clean two-hour candidate evidence', () => {
  const result = assessMultiHourSoakEvidence(valid(), commit);
  assert.equal(result.accepted, true);
  assert.deepEqual(result.reasons, []);
  assert.equal(result.summary.cycles, 2);
});

test('rejects a different commit, dirty checkout or shortened run', () => {
  const report = valid();
  report.validity = { commit: 'b'.repeat(40), worktreeDirty: true };
  report.elapsedMs = TWO_HOURS_MS - 1;
  const result = assessMultiHourSoakEvidence(report, commit);
  assert.equal(result.accepted, false);
  assert.equal(result.reasons.length, 3);
});

test('rejects failed cycles and orphan processes even when top-level passed is stale', () => {
  const report = valid();
  report.cycles.push({ passed: false });
  report.orphanProcesses.push({ processId: 42 });
  const result = assessMultiHourSoakEvidence(report, commit);
  assert.equal(result.accepted, false);
  assert.match(result.reasons.join(' '), /failed cycle/);
  assert.match(result.reasons.join(' '), /orphan/);
});

test('rejects absent evidence', () => {
  assert.equal(assessMultiHourSoakEvidence(null, commit).accepted, false);
});
