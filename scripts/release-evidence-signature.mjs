import {
  createHash,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify
} from 'node:crypto';

export const serializeReleaseEvidence = (report) => Buffer.from(
  `${JSON.stringify(report, null, 2)}\n`,
  'utf8'
);

export const signReleaseEvidence = (payload) => {
  const bytes = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  const keys = generateKeyPairSync('ed25519');
  const signature = sign(null, bytes, keys.privateKey);
  if (!verify(null, bytes, keys.publicKey, signature)) {
    throw new Error('Release evidence signature self-verification failed.');
  }
  const publicKey = createPublicKey(keys.privateKey).export({ format: 'der', type: 'spki' });
  return {
    algorithm: 'Ed25519',
    trust: 'ephemeral-local-evidence',
    payloadSha256: createHash('sha256').update(bytes).digest('hex'),
    publicKeySpkiBase64: publicKey.toString('base64'),
    signatureBase64: signature.toString('base64')
  };
};

export const verifyReleaseEvidenceSignature = (payload, evidence) => {
  const bytes = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  if (evidence?.algorithm !== 'Ed25519'
    || createHash('sha256').update(bytes).digest('hex') !== evidence.payloadSha256) {
    return false;
  }
  try {
    return verify(
      null,
      bytes,
      createPublicKey({
        key: Buffer.from(evidence.publicKeySpkiBase64, 'base64'),
        format: 'der',
        type: 'spki'
      }),
      Buffer.from(evidence.signatureBase64, 'base64')
    );
  } catch {
    return false;
  }
};
