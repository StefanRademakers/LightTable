import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  compareReleaseVersions,
  canonicalUpdateManifestPayload,
  fetchUpdateManifest,
  releaseChannelFor,
  verifyUpdateArtifact,
  verifyUpdateManifest,
  type SignedUpdateManifest
} from './releaseUpdate';

const keys = generateKeyPairSync('ed25519');
const artifact = new TextEncoder().encode('signed LightTable release');
const unsigned = {
  schemaVersion: 1 as const,
  product: 'LightTable' as const,
  version: '0.2.0-preview.1',
  channel: 'preview' as const,
  publishedAt: '2026-08-06T00:00:00.000Z',
  releaseNotes: 'Faster and safer.',
  minimumDocumentManifestVersion: 6,
  maximumRecoveryVersion: 1,
  artifact: {
    url: 'https://updates.example.test/LightTable.exe',
    sha256: createHash('sha256').update(artifact).digest('hex'),
    byteLength: artifact.byteLength
  }
};
const signed = (): SignedUpdateManifest => ({
  ...unsigned,
  signature: sign(null, Buffer.from(canonicalUpdateManifestPayload(unsigned)), keys.privateKey).toString('base64')
});
const publicKeyPem = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();

describe('desktop release update boundary', () => {
  it('accepts a valid newer signed manifest and matching artifact', () => {
    const decision = verifyUpdateManifest({
      value: signed(), publicKeyPem, currentVersion: '0.1.0-alpha.1', currentChannel: 'preview'
    });
    expect(decision.status).toBe('available');
    expect(verifyUpdateArtifact(signed(), artifact)).toEqual({ ok: true });
  });

  it('rejects tampered manifest and artifact bytes', () => {
    expect(verifyUpdateManifest({
      value: { ...signed(), releaseNotes: 'tampered' },
      publicKeyPem,
      currentVersion: '0.1.0-alpha.1',
      currentChannel: 'preview'
    }).status).toBe('invalid');
    expect(verifyUpdateArtifact(signed(), new TextEncoder().encode('wrong')).ok).toBe(false);
  });

  it('does not offer older or incompatible-channel releases', () => {
    const older = { ...unsigned, version: '0.0.9' };
    const olderSigned = {
      ...older,
      signature: sign(null, Buffer.from(canonicalUpdateManifestPayload(older)), keys.privateKey).toString('base64')
    };
    expect(verifyUpdateManifest({
      value: olderSigned, publicKeyPem, currentVersion: '0.1.0-alpha.1', currentChannel: 'preview'
    }).status).toBe('older');
    expect(verifyUpdateManifest({
      value: signed(), publicKeyPem, currentVersion: '0.1.0-alpha.1', currentChannel: 'stable'
    }).status).toBe('channel-blocked');
  });

  it('uses one semantic version source to infer truthful channels', () => {
    expect(compareReleaseVersions('1.0.0', '1.0.0-preview.2')).toBeGreaterThan(0);
    expect(releaseChannelFor('0.1.0-alpha.1', false)).toBe('dev');
    expect(releaseChannelFor('0.1.0-alpha.1', true)).toBe('preview');
    expect(releaseChannelFor('1.0.0', true)).toBe('stable');
  });

  it('reports unavailable and canceled manifest requests without an update', async () => {
    const unavailable = await fetchUpdateManifest(
      'https://updates.example.test/manifest.json',
      new AbortController().signal,
      async () => new Response('', { status: 503 })
    );
    expect(unavailable).toMatchObject({ ok: false, status: 'unavailable' });
    const controller = new AbortController();
    controller.abort();
    const canceled = await fetchUpdateManifest(
      'https://updates.example.test/manifest.json',
      controller.signal,
      async () => { throw new DOMException('aborted', 'AbortError'); }
    );
    expect(canceled).toMatchObject({ ok: false, status: 'canceled' });
  });
});
