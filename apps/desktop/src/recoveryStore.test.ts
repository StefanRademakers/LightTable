import { createHash, randomUUID } from 'node:crypto';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { LightTableRecoveryRecord } from '@lighttable/app';
import { DesktopRecoveryStore, recoveryDocumentIdHash } from './recoveryStore';
import { atomicWriteFile, type AtomicWritePhase } from './atomicFileWriter';

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

  it('protects source metadata with the host codec and removes by recovery ID', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'lighttable-recovery-protected-'));
    directories.push(root);
    const protect = (value: Uint8Array) => Uint8Array.from(value, (byte) => byte ^ 0xa5);
    const store = new DesktopRecoveryStore(
      root,
      undefined,
      () => 100_000,
      {
        encode: (value) => protect(new TextEncoder().encode(value)),
        decode: (value) => new TextDecoder().decode(protect(value))
      }
    );
    const artifact = bytes('protected snapshot');
    const metadata = {
      ...record({ documentId: 'doc-private', revision: 1, artifact, updatedAt: 90_000 }),
      sourceName: 'private.psd',
      sourceMediaType: 'image/vnd.adobe.photoshop',
      sourcePath: 'D:\\private\\client\\private.psd',
      workspaceOrder: 2,
      wasActive: true
    } satisfies LightTableRecoveryRecord;
    await expect(store.write({ documentId: 'doc-private', record: metadata, bytes: artifact }))
      .resolves.toMatchObject({ status: 'committed' });
    const raw = await readFile(path.join(root, `${metadata.recoveryId}.ltrecovery`));
    expect(raw.includes(Buffer.from(metadata.sourcePath!))).toBe(false);
    await expect(store.list()).resolves.toEqual({ records: [metadata], rejections: [] });
    await store.removeRecord(metadata.recoveryId);
    await expect(store.list()).resolves.toEqual({ records: [], rejections: [] });
  });

  it.each<AtomicWritePhase>(['prepare', 'write', 'flush', 'validate', 'replace'])(
    'keeps the prior valid generation when publication stops during %s',
    async (failedPhase) => {
      const { root, store } = await fixture();
      const previous = bytes('previous valid recovery');
      const previousRecord = record({ documentId: 'doc-1', revision: 1, artifact: previous, updatedAt: 90_001 });
      await expect(store.write({ documentId: 'doc-1', record: previousRecord, bytes: previous }))
        .resolves.toMatchObject({ status: 'committed' });
      const next = bytes('unpublished recovery');
      const nextRecord = record({ documentId: 'doc-1', revision: 2, artifact: next, updatedAt: 90_002 });
      const faulted = new DesktopRecoveryStore(root, undefined, () => 100_000, undefined, {
        atomicWrite: (options) => atomicWriteFile({ ...options, injectFault: (phase) => {
          if (phase === failedPhase) throw new Error(`terminated during ${phase}`);
        } })
      });
      await expect(faulted.write({ documentId: 'doc-1', record: nextRecord, bytes: next }))
        .resolves.toMatchObject({ status: 'failed', phase: 'write' });
      await expect(store.list()).resolves.toEqual({ records: [previousRecord], rejections: [] });
      await expect(access(path.join(root, `${nextRecord.recoveryId}.ltrecovery`))).rejects.toThrow();
    }
  );

  it.each(['serialize', 'publish', 'prune'] as const)(
    'never destroys the prior generation when recovery stops during %s',
    async (failedPhase) => {
      const { root, store } = await fixture();
      const previous = bytes('previous valid recovery');
      const previousRecord = record({ documentId: 'doc-1', revision: 1, artifact: previous, updatedAt: 90_001 });
      await store.write({ documentId: 'doc-1', record: previousRecord, bytes: previous });
      const next = bytes('next recovery');
      const nextRecord = record({ documentId: 'doc-1', revision: 2, artifact: next, updatedAt: 90_002 });
      const faulted = new DesktopRecoveryStore(root, undefined, () => 100_000, undefined, {
        injectFault: (phase) => { if (phase === failedPhase) throw new Error(`terminated during ${phase}`); }
      });
      await expect(faulted.write({ documentId: 'doc-1', record: nextRecord, bytes: next }))
        .resolves.toMatchObject({ status: 'failed' });
      const listing = await store.list();
      expect(listing.records).toContainEqual(previousRecord);
      expect(listing.rejections).toEqual([]);
    }
  );

  it('serializes an explicit save cleanup behind the active checkpoint writer', async () => {
    const { root } = await fixture();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let writing = false;
    const store = new DesktopRecoveryStore(root, undefined, () => 100_000, undefined, {
      atomicWrite: async (options) => { writing = true; await gate; return atomicWriteFile(options); }
    });
    const artifact = bytes('overlapping checkpoint');
    const metadata = record({ documentId: 'doc-1', revision: 4, artifact, updatedAt: 90_004 });
    const pendingWrite = store.write({ documentId: 'doc-1', record: metadata, bytes: artifact });
    await expect.poll(() => writing).toBe(true);
    let removed = false;
    const pendingRemove = store.remove('doc-1', 4).then(() => { removed = true; });
    await Promise.resolve();
    expect(removed).toBe(false);
    release();
    await expect(pendingWrite).resolves.toMatchObject({ status: 'committed' });
    await pendingRemove;
    await expect(store.list()).resolves.toEqual({ records: [], rejections: [] });
  });

  it('isolates unsupported schema and corrupt records on every startup listing', async () => {
    const { root, store } = await fixture();
    const artifact = bytes('future schema');
    const metadata = record({ documentId: 'doc-1', revision: 1, artifact, updatedAt: 90_001 });
    await store.write({ documentId: 'doc-1', record: metadata, bytes: artifact });
    const filePath = path.join(root, `${metadata.recoveryId}.ltrecovery`);
    const envelope = await readFile(filePath);
    const versionOffset = envelope.indexOf(Buffer.from('"version":1'));
    expect(versionOffset).toBeGreaterThanOrEqual(0);
    envelope[versionOffset + '"version":'.length] = '2'.charCodeAt(0);
    await writeFile(filePath, envelope);
    for (let startup = 0; startup < 3; startup += 1) {
      await expect(store.list()).resolves.toEqual({ records: [], rejections: [expect.objectContaining({
        recoveryId: metadata.recoveryId, reason: 'unsupported-version'
      })] });
    }
  });

  it('handles backward and forward wall-clock changes deterministically', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'lighttable-recovery-clock-'));
    directories.push(root);
    let now = 100_000;
    const store = new DesktopRecoveryStore(root, {
      generationsPerDocument: 2, documents: 20, bytes: 1_000_000, ageMs: 10_000
    }, () => now);
    const first = bytes('first');
    const firstRecord = record({ documentId: 'doc-1', revision: 1, artifact: first, updatedAt: 95_000 });
    await store.write({ documentId: 'doc-1', record: firstRecord, bytes: first });
    now = 90_000;
    const second = bytes('second');
    await store.write({ documentId: 'doc-2', record: record({
      documentId: 'doc-2', revision: 2, artifact: second, updatedAt: 90_000
    }), bytes: second });
    expect((await store.list()).records).toContainEqual(firstRecord);
    now = 200_000;
    const third = bytes('third');
    const thirdRecord = record({ documentId: 'doc-3', revision: 3, artifact: third, updatedAt: 200_000 });
    await store.write({ documentId: 'doc-3', record: thirdRecord, bytes: third });
    await expect(store.list()).resolves.toEqual({ records: [thirdRecord], rejections: [] });
  });
});
