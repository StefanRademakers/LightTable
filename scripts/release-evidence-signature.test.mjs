import assert from 'node:assert/strict';
import test from 'node:test';
import {
  serializeReleaseEvidence,
  signReleaseEvidence,
  verifyReleaseEvidenceSignature
} from './release-evidence-signature.mjs';

test('signature verifies against the exact persisted report bytes', () => {
  const payload = serializeReleaseEvidence({ candidate: 'abc123', passed: true });
  const evidence = signReleaseEvidence(payload);
  assert.equal(verifyReleaseEvidenceSignature(payload, evidence), true);
});

test('formatting or content changes invalidate signed release evidence', () => {
  const payload = serializeReleaseEvidence({ candidate: 'abc123', passed: true });
  const evidence = signReleaseEvidence(payload);
  assert.equal(verifyReleaseEvidenceSignature(Buffer.from(payload.toString().trim()), evidence), false);
  assert.equal(verifyReleaseEvidenceSignature(
    serializeReleaseEvidence({ candidate: 'abc123', passed: false }), evidence
  ), false);
});

test('malformed signature evidence fails closed', () => {
  const payload = serializeReleaseEvidence({ passed: true });
  assert.equal(verifyReleaseEvidenceSignature(payload, null), false);
  assert.equal(verifyReleaseEvidenceSignature(payload, {
    algorithm: 'Ed25519', payloadSha256: 'invalid', publicKeySpkiBase64: '', signatureBase64: ''
  }), false);
});
