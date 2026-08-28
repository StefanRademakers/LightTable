import { createHash } from 'node:crypto';
import { mkdir, open, readdir, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import type {
  LightTableRecoveryEntry,
  LightTableRecoveryListing,
  LightTableRecoveryRecord,
  LightTableRecoveryRejection,
  LightTableRecoveryWriteResult
} from '@lighttable/app';
import { atomicWriteFile } from './atomicFileWriter';

const MAGIC = new TextEncoder().encode('LTRECOV1');
const HEADER_SIZE = 12;
const MAX_METADATA_BYTES = 1024 * 1024;
const MAX_ARTIFACT_BYTES = 512 * 1024 * 1024;
const FILE_PATTERN = /^([a-zA-Z0-9-]{8,128})\.ltrecovery$/;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1_000;

export interface DesktopRecoveryStoreLimits {
  readonly generationsPerDocument: number;
  readonly documents: number;
  readonly bytes: number;
  readonly ageMs: number;
}

export interface DesktopRecoveryMetadataCodec {
  encode(value: string): Uint8Array;
  decode(value: Uint8Array): string;
}

export interface DesktopRecoveryWriteRequest {
  readonly documentId: string;
  readonly record: LightTableRecoveryRecord;
  readonly bytes: Uint8Array;
}

export type DesktopRecoveryStorePhase = 'serialize' | 'publish' | 'prune';
export interface DesktopRecoveryStoreDependencies {
  readonly atomicWrite?: typeof atomicWriteFile;
  readonly injectFault?: (phase: DesktopRecoveryStorePhase) => void | Promise<void>;
}

const DEFAULT_LIMITS: DesktopRecoveryStoreLimits = {
  generationsPerDocument: 2,
  documents: 20,
  bytes: 2 * 1024 * 1024 * 1024,
  ageMs: THIRTY_DAYS_MS
};

const UTF8_METADATA_CODEC: DesktopRecoveryMetadataCodec = {
  encode: (value) => new TextEncoder().encode(value),
  decode: (value) => new TextDecoder().decode(value)
};

const sha256 = (value: Uint8Array | string): string => createHash('sha256')
  .update(value)
  .digest('hex');

const isFiniteInteger = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0;

/** Main-process validation stays local so Electron never imports the renderer
 * application barrel merely to validate an IPC persistence envelope. */
const parseRecoveryRecord = (value: unknown): LightTableRecoveryRecord => {
  if (!value || typeof value !== 'object') throw new Error('Recovery metadata is not an object.');
  const record = value as Partial<LightTableRecoveryRecord>;
  if (record.version !== 1) {
    throw new Error(`Unsupported recovery version: ${String(record.version)}.`);
  }
  if (typeof record.recoveryId !== 'string'
    || !/^[a-zA-Z0-9-]{8,128}$/.test(record.recoveryId)) {
    throw new Error('Recovery ID is invalid.');
  }
  for (const field of [
    'documentIdHash', 'sourceFingerprintSha256', 'artifactChecksumSha256'
  ] as const) {
    if (typeof record[field] !== 'string' || !/^[a-f\d]{64}$/i.test(record[field]!)) {
      throw new Error(`Recovery ${field} is invalid.`);
    }
  }
  for (const field of [
    'canonicalRevision', 'historyStateId', 'savedStateId', 'createdAt',
    'updatedAt', 'artifactByteLength'
  ] as const) {
    if (!isFiniteInteger(record[field])) throw new Error(`Recovery ${field} is invalid.`);
  }
  if (typeof record.mediaType !== 'string' || record.mediaType.length > 256) {
    throw new Error('Recovery media type is invalid.');
  }
  for (const [field, maximum] of [
    ['sourceName', 512],
    ['sourceMediaType', 256],
    ['sourcePath', 32_768]
  ] as const) {
    if (record[field] !== undefined
      && (typeof record[field] !== 'string' || record[field]!.length > maximum)) {
      throw new Error(`Recovery ${field} is invalid.`);
    }
  }
  if (record.workspaceOrder !== undefined && !isFiniteInteger(record.workspaceOrder)) {
    throw new Error('Recovery workspaceOrder is invalid.');
  }
  if (record.wasActive !== undefined && typeof record.wasActive !== 'boolean') {
    throw new Error('Recovery wasActive is invalid.');
  }
  if (Number(record.artifactByteLength) > MAX_ARTIFACT_BYTES) {
    throw new Error('Recovery artifact exceeds the 512 MiB safety limit.');
  }
  return record as LightTableRecoveryRecord;
};

const encodeEnvelope = (
  record: LightTableRecoveryRecord,
  artifact: Uint8Array,
  metadataCodec: DesktopRecoveryMetadataCodec
): Uint8Array => {
  const metadata = metadataCodec.encode(JSON.stringify(record));
  const output = new Uint8Array(HEADER_SIZE + metadata.byteLength + artifact.byteLength);
  output.set(MAGIC, 0);
  new DataView(output.buffer).setUint32(8, metadata.byteLength, true);
  output.set(metadata, HEADER_SIZE);
  output.set(artifact, HEADER_SIZE + metadata.byteLength);
  return output;
};

const decodeEnvelope = (
  bytes: Uint8Array,
  metadataCodec: DesktopRecoveryMetadataCodec
): LightTableRecoveryEntry => {
  if (bytes.byteLength < HEADER_SIZE) throw new Error('Recovery envelope is truncated.');
  if (!MAGIC.every((byte, index) => bytes[index] === byte)) {
    throw new Error('Recovery envelope magic is invalid.');
  }
  const metadataLength = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength
  ).getUint32(8, true);
  const artifactOffset = HEADER_SIZE + metadataLength;
  if (metadataLength <= 0 || metadataLength > MAX_METADATA_BYTES || artifactOffset > bytes.byteLength) {
    throw new Error('Recovery metadata boundary is invalid.');
  }
  const record = parseRecoveryRecord(JSON.parse(metadataCodec.decode(
    bytes.subarray(HEADER_SIZE, artifactOffset)
  )));
  const artifact = bytes.subarray(artifactOffset);
  if (artifact.byteLength !== record.artifactByteLength) {
    throw new Error('Recovery artifact length does not match its record.');
  }
  if (sha256(artifact) !== record.artifactChecksumSha256) {
    throw new Error('Recovery artifact checksum does not match its record.');
  }
  return {
    record,
    artifact: new File([Uint8Array.from(artifact).buffer], 'recovered-lighttable.png', {
      type: record.mediaType
    })
  };
};

const readEnvelopeRecordDetails = async (
  filePath: string,
  metadataCodec: DesktopRecoveryMetadataCodec
): Promise<{ readonly record: LightTableRecoveryRecord; readonly artifactOffset: number }> => {
  const file = await open(filePath, 'r');
  try {
    const readExactly = async (target: Uint8Array, position: number): Promise<void> => {
      let offset = 0;
      while (offset < target.byteLength) {
        const read = await file.read(target, offset, target.byteLength - offset, position + offset);
        if (read.bytesRead === 0) throw new Error('Recovery envelope is truncated.');
        offset += read.bytesRead;
      }
    };
    const header = new Uint8Array(HEADER_SIZE);
    await readExactly(header, 0);
    if (!MAGIC.every((byte, index) => header[index] === byte)) {
      throw new Error('Recovery envelope header is invalid.');
    }
    const metadataLength = new DataView(header.buffer).getUint32(8, true);
    if (metadataLength < 1 || metadataLength > MAX_METADATA_BYTES) {
      throw new Error('Recovery metadata boundary is invalid.');
    }
    const metadata = new Uint8Array(metadataLength);
    await readExactly(metadata, HEADER_SIZE);
    const record = parseRecoveryRecord(JSON.parse(metadataCodec.decode(metadata)));
    const fileStats = await file.stat();
    if (!fileStats.isFile()
      || fileStats.size !== HEADER_SIZE + metadataLength + record.artifactByteLength) {
      throw new Error('Recovery artifact length does not match its record.');
    }
    return { record, artifactOffset: HEADER_SIZE + metadataLength };
  } finally {
    await file.close();
  }
};

const validateEnvelopeFile = async (
  filePath: string,
  metadataCodec: DesktopRecoveryMetadataCodec
): Promise<void> => {
  const { record, artifactOffset } = await readEnvelopeRecordDetails(filePath, metadataCodec);
  const file = await open(filePath, 'r');
  const hash = createHash('sha256');
  const chunk = new Uint8Array(1024 * 1024);
  let offset = 0;
  try {
    while (offset < record.artifactByteLength) {
      const length = Math.min(chunk.byteLength, record.artifactByteLength - offset);
      const read = await file.read(chunk, 0, length, artifactOffset + offset);
      if (read.bytesRead === 0) throw new Error('Recovery artifact is truncated.');
      hash.update(chunk.subarray(0, read.bytesRead));
      offset += read.bytesRead;
    }
  } finally {
    await file.close();
  }
  if (hash.digest('hex') !== record.artifactChecksumSha256) {
    throw new Error('Recovery artifact checksum does not match its record.');
  }
};

export class DesktopRecoveryStore {
  private tail: Promise<void> = Promise.resolve();

  constructor(
    private root: string,
    private readonly limits: DesktopRecoveryStoreLimits = DEFAULT_LIMITS,
    private readonly now: () => number = () => Date.now(),
    private readonly metadataCodec: DesktopRecoveryMetadataCodec = UTF8_METADATA_CODEC,
    private readonly dependencies: DesktopRecoveryStoreDependencies = {}
  ) {}

  /** Switches future recovery operations to another validated application root. */
  setRoot(root: string): Promise<void> {
    return this.serial(async () => { this.root = root; });
  }

  getRoot(): string {
    return this.root;
  }

  write(request: DesktopRecoveryWriteRequest): Promise<LightTableRecoveryWriteResult> {
    return this.serial(async () => {
      try {
        this.validateWrite(request);
        await mkdir(this.root, { recursive: true, mode: 0o700 });
        await this.dependencies.injectFault?.('serialize');
        const envelope = encodeEnvelope(request.record, request.bytes, this.metadataCodec);
        if (envelope.byteLength > this.limits.bytes) {
          return { status: 'failed', phase: 'quota', message: 'Recovery exceeds the storage budget.' };
        }
        await this.dependencies.injectFault?.('publish');
        await (this.dependencies.atomicWrite ?? atomicWriteFile)({
          targetPath: this.filePath(request.record.recoveryId),
          bytes: envelope,
          validate: (temporaryPath) => validateEnvelopeFile(temporaryPath, this.metadataCodec)
        });
        await this.dependencies.injectFault?.('prune');
        await this.prune();
        return { status: 'committed', byteLength: envelope.byteLength };
      } catch (reason) {
        return {
          status: 'failed',
          phase: 'write',
          message: reason instanceof Error ? reason.message : String(reason)
        };
      }
    });
  }

  remove(documentId: string, throughRevision = Number.MAX_SAFE_INTEGER): Promise<void> {
    return this.serial(async () => {
      const documentIdHash = sha256(documentId);
      const listing = await this.listUnsafe();
      for (const record of listing.records) {
        if (record.documentIdHash === documentIdHash
          && record.canonicalRevision <= throughRevision) {
          await unlink(this.filePath(record.recoveryId)).catch(() => undefined);
        }
      }
    });
  }

  removeRecord(recoveryId: string): Promise<void> {
    return this.serial(async () => {
      if (!FILE_PATTERN.test(`${recoveryId}.ltrecovery`)) return;
      await unlink(this.filePath(recoveryId)).catch(() => undefined);
    });
  }

  list(): Promise<LightTableRecoveryListing> {
    return this.serial(() => this.listUnsafe());
  }

  read(recoveryId: string): Promise<LightTableRecoveryEntry | null> {
    return this.serial(async () => {
      if (!FILE_PATTERN.test(`${recoveryId}.ltrecovery`)) return null;
      try {
        return decodeEnvelope(
          new Uint8Array(await readFile(this.filePath(recoveryId))),
          this.metadataCodec
        );
      } catch {
        return null;
      }
    });
  }

  private validateWrite({ documentId, record, bytes }: DesktopRecoveryWriteRequest): void {
    parseRecoveryRecord(record);
    if (record.documentIdHash !== sha256(documentId)) {
      throw new Error('Recovery document identity does not match its record.');
    }
    if (record.artifactByteLength !== bytes.byteLength
      || record.artifactChecksumSha256 !== sha256(bytes)) {
      throw new Error('Recovery artifact metadata does not match its bytes.');
    }
  }

  private async prune(): Promise<void> {
    const listing = await this.listUnsafe();
    const minimumTime = this.now() - this.limits.ageMs;
    const newestFirst = [...listing.records].sort((a, b) => b.updatedAt - a.updatedAt);
    const keptDocuments = new Set<string>();
    const generations = new Map<string, number>();
    let keptBytes = 0;
    for (const record of newestFirst) {
      const generation = generations.get(record.documentIdHash) ?? 0;
      const newDocument = !keptDocuments.has(record.documentIdHash);
      const keep = record.updatedAt >= minimumTime
        && generation < this.limits.generationsPerDocument
        && (!newDocument || keptDocuments.size < this.limits.documents)
        && keptBytes + record.artifactByteLength <= this.limits.bytes;
      if (keep) {
        generations.set(record.documentIdHash, generation + 1);
        keptDocuments.add(record.documentIdHash);
        keptBytes += record.artifactByteLength;
      } else {
        await unlink(this.filePath(record.recoveryId)).catch(() => undefined);
      }
    }
  }

  private async listUnsafe(): Promise<LightTableRecoveryListing> {
    const records: LightTableRecoveryRecord[] = [];
    const rejections: LightTableRecoveryRejection[] = [];
    let names: string[];
    try {
      names = await readdir(this.root);
    } catch {
      return { records, rejections };
    }
    for (const name of names.sort()) {
      const match = name.match(FILE_PATTERN);
      if (!match) continue;
      try {
        records.push((await readEnvelopeRecordDetails(path.join(this.root, name), this.metadataCodec)).record);
      } catch (reason) {
        rejections.push({
          recoveryId: match[1] ?? null,
          reason: reason instanceof Error && reason.message.includes('version')
            ? 'unsupported-version'
            : reason instanceof Error && reason.message.includes('checksum')
              ? 'checksum'
              : 'malformed',
          message: reason instanceof Error ? reason.message : String(reason)
        });
      }
    }
    records.sort((a, b) => b.updatedAt - a.updatedAt);
    return { records, rejections };
  }

  private filePath(recoveryId: string): string {
    if (!FILE_PATTERN.test(`${recoveryId}.ltrecovery`)) throw new Error('Invalid recovery ID.');
    return path.join(this.root, `${recoveryId}.ltrecovery`);
  }

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation, operation);
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }
}

export const recoveryDocumentIdHash = sha256;
