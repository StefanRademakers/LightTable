import { describe, expect, it } from 'vitest';
import { BrowserRecoveryStore } from './BrowserRecoveryStore';
import {
  LIGHTTABLE_RECOVERY_VERSION,
  sha256Hex,
  type LightTableRecoveryRecord
} from './LightTableRecoveryStore';

class MemoryFileHandle {
  readonly kind = 'file';
  data = new Blob();

  async getFile(): Promise<File> {
    return new File([this.data], 'memory');
  }

  async createWritable(): Promise<FileSystemWritableFileStream> {
    let pending = new Blob();
    return {
      write: async (value: unknown) => { pending = value as Blob; },
      close: async () => { this.data = pending; },
      abort: async () => undefined
    } as unknown as FileSystemWritableFileStream;
  }
}

class MemoryDirectoryHandle {
  readonly kind = 'directory';
  readonly files = new Map<string, MemoryFileHandle>();
  readonly directories = new Map<string, MemoryDirectoryHandle>();

  async getDirectoryHandle(name: string, options?: { create?: boolean }) {
    const existing = this.directories.get(name);
    if (existing) return existing;
    if (!options?.create) throw new DOMException('Missing', 'NotFoundError');
    const created = new MemoryDirectoryHandle();
    this.directories.set(name, created);
    return created;
  }

  async getFileHandle(name: string, options?: { create?: boolean }) {
    const existing = this.files.get(name);
    if (existing) return existing;
    if (!options?.create) throw new DOMException('Missing', 'NotFoundError');
    const created = new MemoryFileHandle();
    this.files.set(name, created);
    return created;
  }

  async removeEntry(name: string) {
    if (!this.files.delete(name) && !this.directories.delete(name)) {
      throw new DOMException('Missing', 'NotFoundError');
    }
  }

  async *entries(): AsyncIterableIterator<[string, MemoryFileHandle | MemoryDirectoryHandle]> {
    yield* this.files.entries();
    yield* this.directories.entries();
  }
}

const storageFixture = (quota = 1_000_000) => {
  const origin = new MemoryDirectoryHandle();
  const storage = {
    getDirectory: async () => origin,
    estimate: async () => ({ usage: 0, quota })
  } as unknown as StorageManager;
  return { origin, storage };
};

const recoveryFixture = async (
  documentId: string,
  revision: number,
  artifact: File
): Promise<LightTableRecoveryRecord> => ({
  version: LIGHTTABLE_RECOVERY_VERSION,
  recoveryId: `recovery-${revision}-fixture`,
  documentIdHash: await sha256Hex(documentId),
  sourceFingerprintSha256: await sha256Hex(`source:${documentId}`),
  canonicalRevision: revision,
  historyStateId: revision,
  savedStateId: 0,
  createdAt: revision * 1_000,
  updatedAt: revision * 1_000,
  artifactByteLength: artifact.size,
  artifactChecksumSha256: await sha256Hex(artifact),
  mediaType: artifact.type
});

describe('BrowserRecoveryStore', () => {
  it('returns an empty listing before the OPFS directory exists', async () => {
    const { storage } = storageFixture();
    await expect(new BrowserRecoveryStore(storage).list()).resolves.toEqual({
      records: [],
      rejections: []
    });
  });

  it('roundtrips, validates and removes metadata-last recovery records', async () => {
    const { storage } = storageFixture();
    const store = new BrowserRecoveryStore(storage, () => 5_000);
    const artifact = new File(['snapshot'], 'document.lighttable', {
      type: 'application/x-lighttable-document'
    });
    const record = await recoveryFixture('doc-1', 4, artifact);
    await expect(store.write({ documentId: 'doc-1', record, artifact }))
      .resolves.toEqual({ status: 'committed', byteLength: artifact.size });
    await expect(store.list()).resolves.toEqual({ records: [record], rejections: [] });
    expect(await (await store.read(record.recoveryId))!.artifact.text()).toBe('snapshot');
    await store.remove('doc-1');
    await expect(store.list()).resolves.toEqual({ records: [], rejections: [] });
  });

  it('reports quota exhaustion without publishing a partial record', async () => {
    const { storage } = storageFixture(2);
    const store = new BrowserRecoveryStore(storage);
    const artifact = new File(['snapshot'], 'document.lighttable');
    const record = await recoveryFixture('doc-1', 1, artifact);
    await expect(store.write({ documentId: 'doc-1', record, artifact }))
      .resolves.toMatchObject({ status: 'failed', phase: 'quota' });
    await expect(store.list()).resolves.toEqual({ records: [], rejections: [] });
  });

  it('isolates corrupt metadata with an explicit rejection reason', async () => {
    const { origin, storage } = storageFixture();
    const root = await origin.getDirectoryHandle('lighttable-recovery-v1', { create: true });
    const handle = await root.getFileHandle('broken-fixture.json', { create: true });
    const writable = await handle.createWritable();
    await writable.write(new Blob(['not-json']));
    await writable.close();
    await expect(new BrowserRecoveryStore(storage).list()).resolves.toEqual({
      records: [],
      rejections: [expect.objectContaining({
        recoveryId: 'broken-fixture',
        reason: 'malformed'
      })]
    });
  });
});
