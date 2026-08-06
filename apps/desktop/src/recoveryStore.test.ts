import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { LightTableRecoveryRecord } from '@lighttable/app';
import { DesktopRecoveryStore, recoveryDocumentIdHash } from './recoveryStore';

const directories: string[] = [];
const checksum = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const bytes = (value: string) => new TextEncoder().encode(value);

const record = ({
  documentId,
  revision,
  artifact,
  updatedAt = revision * 1_000,
  recoveryId = randomUUID()
}: {
  documentId: string;
  revision: number;
  artifact: Uint8Array;
  updatedAt?: number;
  recoveryId?: string;
}): LightTableRecoveryRecord => ({
  version: 1,
  recoveryId,
  documentIdHash: recoveryDocumentIdHash(documentId),
  sourceFingerprintSha256: checksum(bytes(`source:${documentId}`)),
  canonicalRevision: revision,
  historyStateId: revision,
  savedStateId: 0,
  createdAt: updatedAt,
  updatedAt,
  artifactByteLength: artifact.byteLength,
  artifactChecksumSha256: checksum(artifact),
  mediaType: 'image/png'
});

const fixture = async (limits?: ConstructorParameters<typeof DesktopRecoveryStore>[1]) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lighttable-recovery-'));
  directories.push(root);
  return {
    root,
    store: new DesktopRecoveryStore(root, limits, () => 100_000)
  };
};

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true
  })));
});

describe('DesktopRecoveryStore', () => {
  it('roundtrips a checksummed private recovery envelope', async () => {
    const { store } = await fixture();
    const artifact = bytes('canonical document snapshot');
    const metadata = record({ documentId: 'doc-1', revision: 4, artifact });
    expect(await store.write({ documentId: 'doc-1', record: metadata, bytes: artifact }))
      .toMatchObject({ status: 'committed' });
    expect((await store.list()).records).toEqual([metadata]);
    const restored = await store.read(metadata.recoveryId);
    expect(new Uint8Array(await restored!.artifact.arrayBuffer())).toEqual(artifact);
  });

  it('keeps only the newest bounded generations for a document', async () => {
    const { store } = await fixture({
      generationsPerDocument: 2,
      documents: 20,
      bytes: 1_000_000,
      ageMs: 1_000_000
    });
    for (let revision = 1; revision <= 3; revision += 1) {
      const artifact = bytes(`revision-${revision}`);
      await store.write({
        documentId: 'doc-1',
        record: record({ documentId: 'doc-1', revision, artifact, updatedAt: 90_000 + revision }),
        bytes: artifact
      });
    }
    expect((await store.list()).records.map(({ canonicalRevision }) => canonicalRevision))
      .toEqual([3, 2]);
  });

  it('prunes by age and document count deterministically', async () => {
    const { store } = await fixture({
      generationsPerDocument: 2,
      documents: 2,
      bytes: 1_000_000,
      ageMs: 20_000
    });
    for (const [documentId, revision, updatedAt] of [
      ['old', 1, 10_000],
      ['doc-a', 2, 90_000],
      ['doc-b', 3, 91_000],
      ['doc-c', 4, 92_000]
    ] as const) {
      const artifact = bytes('1234');
      await store.write({
        documentId,
        record: record({ documentId, revision, artifact, updatedAt }),
        bytes: artifact
      });
    }
    expect((await store.list()).records.map(({ canonicalRevision }) => canonicalRevision))
      .toEqual([4, 3]);
  });

  it('prunes older generations when the total byte budget is exhausted', async () => {
    const { store } = await fixture({
      generationsPerDocument: 3,
      documents: 20,
      bytes: 1_200,
      ageMs: 1_000_000
    });
    for (const revision of [1, 2]) {
      const artifact = bytes(String(revision).repeat(700));
      expect(await store.write({
        documentId: 'doc-1',
        record: record({ documentId: 'doc-1', revision, artifact, updatedAt: 90_000 + revision }),
        bytes: artifact
      })).toMatchObject({ status: 'committed' });
    }
    expect((await store.list()).records.map(({ canonicalRevision }) => canonicalRevision))
      .toEqual([2]);
  });

  it('removes only records through a verified saved revision', async () => {
    const { store } = await fixture();
    for (const revision of [2, 5]) {
      const artifact = bytes(`revision-${revision}`);
      await store.write({
        documentId: 'doc-1',
        record: record({ documentId: 'doc-1', revision, artifact, updatedAt: 90_000 + revision }),
        bytes: artifact
      });
    }
    await store.remove('doc-1', 2);
    expect((await store.list()).records.map(({ canonicalRevision }) => canonicalRevision))
      .toEqual([5]);
  });

  it('isolates malformed records and exposes a rejection reason', async () => {
    const { root, store } = await fixture();
    await writeFile(path.join(root, 'malformed-1.ltrecovery'), bytes('broken'));
    const listing = await store.list();
    expect(listing.records).toEqual([]);
    expect(listing.rejections).toEqual([expect.objectContaining({
      recoveryId: 'malformed-1',
      reason: 'malformed'
    })]);
  });

  it('rejects quota and mismatched identity without disturbing valid records', async () => {
    const { store } = await fixture({
      generationsPerDocument: 2,
      documents: 20,
      bytes: 64,
      ageMs: 1_000_000
    });
    const artifact = bytes('a'.repeat(100));
    const metadata = record({ documentId: 'doc-1', revision: 1, artifact });
    expect(await store.write({ documentId: 'doc-1', record: metadata, bytes: artifact }))
      .toMatchObject({ status: 'failed', phase: 'quota' });
    expect(await store.write({ documentId: 'wrong-doc', record: metadata, bytes: artifact }))
      .toMatchObject({ status: 'failed', phase: 'write' });
    expect((await store.list()).records).toEqual([]);
  });
});
