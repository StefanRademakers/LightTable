import {
  parseLightTableRecoveryRecord,
  sha256Hex,
  type LightTableRecoveryEntry,
  type LightTableRecoveryListing,
  type LightTableRecoveryRecord,
  type LightTableRecoveryRejection,
  type LightTableRecoveryStore,
  type LightTableRecoveryWriteRequest,
  type LightTableRecoveryWriteResult
} from './LightTableRecoveryStore';

const ROOT_NAME = 'lighttable-recovery-v1';
const METADATA_SUFFIX = '.json';
const ARTIFACT_SUFFIX = '.artifact';
const MAX_GENERATIONS = 2;
const MAX_DOCUMENTS = 20;
const MAX_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1_000;

type IterableDirectoryHandle = FileSystemDirectoryHandle & {
  entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
};

const unavailable = (message: string): LightTableRecoveryWriteResult => ({
  status: 'failed',
  phase: 'unavailable',
  message
});

const removeEntry = async (
  directory: FileSystemDirectoryHandle,
  name: string
): Promise<void> => {
  try {
    await directory.removeEntry(name);
  } catch (reason) {
    if (!(reason instanceof DOMException && reason.name === 'NotFoundError')) throw reason;
  }
};

const writeBlob = async (
  directory: FileSystemDirectoryHandle,
  name: string,
  value: Blob
): Promise<void> => {
  const handle = await directory.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  try {
    await writable.write(value);
    await writable.close();
  } catch (reason) {
    await writable.abort(reason).catch(() => undefined);
    throw reason;
  }
};

/** OPFS recovery adapter. Metadata publication is last, so orphan artifacts
 * from a terminated write are invisible and removable without corrupting a
 * previous valid generation. */
export class BrowserRecoveryStore implements LightTableRecoveryStore {
  private tail: Promise<void> = Promise.resolve();

  constructor(
    private readonly storage: StorageManager,
    private readonly now: () => number = () => Date.now()
  ) {}

  write(request: LightTableRecoveryWriteRequest): Promise<LightTableRecoveryWriteResult> {
    return this.serial(async () => {
      if (typeof this.storage.getDirectory !== 'function') {
        return unavailable('Origin-private recovery storage is unavailable in this browser.');
      }
      let root: FileSystemDirectoryHandle | null = null;
      let recoveryId: string | null = null;
      try {
        const record = parseLightTableRecoveryRecord(request.record);
        recoveryId = record.recoveryId;
        if (record.documentIdHash !== await sha256Hex(request.documentId)) {
          throw new Error('Recovery document identity does not match its record.');
        }
        if (record.artifactByteLength !== request.artifact.size
          || record.artifactChecksumSha256 !== await sha256Hex(request.artifact)) {
          throw new Error('Recovery artifact metadata does not match its bytes.');
        }
        const estimate = await this.storage.estimate();
        if (estimate.quota !== undefined && estimate.usage !== undefined
          && estimate.usage + request.artifact.size > estimate.quota) {
          return { status: 'failed', phase: 'quota', message: 'Browser recovery quota is exhausted.' };
        }
        root = await this.root(true);
        await writeBlob(root, `${record.recoveryId}${ARTIFACT_SUFFIX}`, request.artifact);
        await writeBlob(root, `${record.recoveryId}${METADATA_SUFFIX}`, new Blob(
          [JSON.stringify(record)],
          { type: 'application/json' }
        ));
        await this.prune(root);
        return { status: 'committed', byteLength: request.artifact.size };
      } catch (reason) {
        if (root && recoveryId) await this.removeRecordUnsafe(root, recoveryId).catch(() => undefined);
        const quota = reason instanceof DOMException && reason.name === 'QuotaExceededError';
        return {
          status: 'failed',
          phase: quota ? 'quota' : 'write',
          message: reason instanceof Error ? reason.message : String(reason)
        };
      }
    });
  }

  remove(documentId: string, throughRevision = Number.MAX_SAFE_INTEGER): Promise<void> {
    return this.serial(async () => {
      if (typeof this.storage.getDirectory !== 'function') return;
      const root = await this.existingRoot();
      if (!root) return;
      const documentIdHash = await sha256Hex(documentId);
      for (const record of (await this.listUnsafe(root)).records) {
        if (record.documentIdHash === documentIdHash
          && record.canonicalRevision <= throughRevision) {
          await this.removeRecordUnsafe(root, record.recoveryId);
        }
      }
    });
  }

  removeRecord(recoveryId: string): Promise<void> {
    return this.serial(async () => {
      if (!/^[a-zA-Z0-9-]{8,128}$/.test(recoveryId)
        || typeof this.storage.getDirectory !== 'function') return;
      const root = await this.existingRoot();
      if (root) await this.removeRecordUnsafe(root, recoveryId);
    });
  }

  list(): Promise<LightTableRecoveryListing> {
    return this.serial(async () => {
      if (typeof this.storage.getDirectory !== 'function') return { records: [], rejections: [] };
      const root = await this.existingRoot();
      return root ? this.listUnsafe(root) : { records: [], rejections: [] };
    });
  }

  read(recoveryId: string): Promise<LightTableRecoveryEntry | null> {
    return this.serial(async () => {
      if (!/^[a-zA-Z0-9-]{8,128}$/.test(recoveryId)
        || typeof this.storage.getDirectory !== 'function') return null;
      try {
        const root = await this.root(false);
        const metadata = parseLightTableRecoveryRecord(JSON.parse(await (
          await root.getFileHandle(`${recoveryId}${METADATA_SUFFIX}`)
        ).getFile().then((file) => file.text())));
        const source = await (
          await root.getFileHandle(`${recoveryId}${ARTIFACT_SUFFIX}`)
        ).getFile();
        if (source.size !== metadata.artifactByteLength
          || await sha256Hex(source) !== metadata.artifactChecksumSha256) return null;
        return {
          record: metadata,
          artifact: new File([source], 'recovered-lighttable.png', { type: metadata.mediaType })
        };
      } catch {
        return null;
      }
    });
  }

  private async root(create: boolean): Promise<FileSystemDirectoryHandle> {
    const origin = await this.storage.getDirectory();
    return origin.getDirectoryHandle(ROOT_NAME, { create });
  }

  private async existingRoot(): Promise<FileSystemDirectoryHandle | null> {
    try {
      return await this.root(false);
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'NotFoundError') return null;
      throw reason;
    }
  }

  private async listUnsafe(root: FileSystemDirectoryHandle): Promise<LightTableRecoveryListing> {
    const records: LightTableRecoveryRecord[] = [];
    const rejections: LightTableRecoveryRejection[] = [];
    for await (const [name, handle] of (root as IterableDirectoryHandle).entries()) {
      if (handle.kind !== 'file' || !name.endsWith(METADATA_SUFFIX)) continue;
      const recoveryId = name.slice(0, -METADATA_SUFFIX.length);
      try {
        const record = parseLightTableRecoveryRecord(JSON.parse(await (
          await (handle as FileSystemFileHandle).getFile()
        ).text()));
        const artifact = await (await root.getFileHandle(`${recoveryId}${ARTIFACT_SUFFIX}`)).getFile();
        if (artifact.size !== record.artifactByteLength) throw new Error('Recovery artifact length does not match its record.');
        records.push(record);
      } catch (reason) {
        rejections.push({
          recoveryId,
          reason: reason instanceof Error && reason.message.includes('version')
            ? 'unsupported-version'
            : 'malformed',
          message: reason instanceof Error ? reason.message : String(reason)
        });
      }
    }
    records.sort((a, b) => b.updatedAt - a.updatedAt);
    return { records, rejections };
  }

  private async prune(root: FileSystemDirectoryHandle): Promise<void> {
    const listing = await this.listUnsafe(root);
    const records = [...listing.records]
      .sort((a, b) => b.updatedAt - a.updatedAt);
    const publishedIds = new Set(records.map(({ recoveryId }) => recoveryId));
    for await (const [name, handle] of (root as IterableDirectoryHandle).entries()) {
      if (handle.kind !== 'file' || !name.endsWith(ARTIFACT_SUFFIX)) continue;
      const recoveryId = name.slice(0, -ARTIFACT_SUFFIX.length);
      if (!publishedIds.has(recoveryId)) await removeEntry(root, name);
    }
    const documentIds = new Set<string>();
    const generations = new Map<string, number>();
    const minimumTime = this.now() - MAX_AGE_MS;
    let bytes = 0;
    for (const record of records) {
      const generation = generations.get(record.documentIdHash) ?? 0;
      const isNewDocument = !documentIds.has(record.documentIdHash);
      const keep = record.updatedAt >= minimumTime
        && generation < MAX_GENERATIONS
        && (!isNewDocument || documentIds.size < MAX_DOCUMENTS)
        && bytes + record.artifactByteLength <= MAX_BYTES;
      if (keep) {
        generations.set(record.documentIdHash, generation + 1);
        documentIds.add(record.documentIdHash);
        bytes += record.artifactByteLength;
      } else {
          await this.removeRecordUnsafe(root, record.recoveryId);
      }
    }
  }

  private async removeRecordUnsafe(root: FileSystemDirectoryHandle, recoveryId: string): Promise<void> {
    await removeEntry(root, `${recoveryId}${METADATA_SUFFIX}`);
    await removeEntry(root, `${recoveryId}${ARTIFACT_SUFFIX}`);
  }

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation, operation);
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }
}

export const createBrowserRecoveryStore = (): LightTableRecoveryStore | undefined => {
  const storage = globalThis.navigator?.storage;
  return storage ? new BrowserRecoveryStore(storage) : undefined;
};
