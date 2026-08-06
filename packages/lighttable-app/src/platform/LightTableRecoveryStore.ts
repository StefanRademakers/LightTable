export const LIGHTTABLE_RECOVERY_VERSION = 1 as const;

export interface LightTableRecoveryRecord {
  readonly version: typeof LIGHTTABLE_RECOVERY_VERSION;
  readonly recoveryId: string;
  readonly documentIdHash: string;
  readonly sourceFingerprintSha256: string;
  readonly sourceName?: string;
  readonly sourceMediaType?: string;
  readonly sourcePath?: string;
  readonly sourceLastModified?: number;
  readonly sourceAvailability?: 'available' | 'missing' | 'newer' | 'unavailable';
  readonly workspaceOrder?: number;
  readonly wasActive?: boolean;
  readonly canonicalRevision: number;
  readonly historyStateId: number;
  readonly savedStateId: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly artifactByteLength: number;
  readonly artifactChecksumSha256: string;
  readonly mediaType: string;
}

export interface LightTableRecoveryWriteRequest {
  readonly documentId: string;
  readonly record: LightTableRecoveryRecord;
  readonly artifact: File;
}

export type LightTableRecoveryWriteResult =
  | { readonly status: 'committed'; readonly byteLength: number }
  | { readonly status: 'superseded' }
  | {
      readonly status: 'failed';
      readonly phase: 'quota' | 'write' | 'validate' | 'prune' | 'unavailable';
      readonly message: string;
    };

export interface LightTableRecoveryEntry {
  readonly record: LightTableRecoveryRecord;
  readonly artifact: File;
}

export interface LightTableRecoveryRejection {
  readonly recoveryId: string | null;
  readonly reason: 'malformed' | 'unsupported-version' | 'checksum' | 'missing';
  readonly message: string;
}

export interface LightTableRecoveryListing {
  readonly records: readonly LightTableRecoveryRecord[];
  readonly rejections: readonly LightTableRecoveryRejection[];
}

export interface LightTableRecoveryStore {
  write(request: LightTableRecoveryWriteRequest): Promise<LightTableRecoveryWriteResult>;
  remove(documentId: string, throughRevision?: number): Promise<void>;
  removeRecord(recoveryId: string): Promise<void>;
  list(): Promise<LightTableRecoveryListing>;
  read(recoveryId: string): Promise<LightTableRecoveryEntry | null>;
}

export const sha256Hex = async (value: Blob | string): Promise<string> => {
  const bytes = typeof value === 'string'
    ? new TextEncoder().encode(value)
    : new Uint8Array(await value.arrayBuffer());
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
};

const isFiniteInteger = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0;

export const parseLightTableRecoveryRecord = (
  value: unknown
): LightTableRecoveryRecord => {
  if (!value || typeof value !== 'object') throw new Error('Recovery metadata is not an object.');
  const record = value as Partial<LightTableRecoveryRecord>;
  if (record.version !== LIGHTTABLE_RECOVERY_VERSION) {
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
  if (record.sourceLastModified !== undefined && !isFiniteInteger(record.sourceLastModified)) {
    throw new Error('Recovery sourceLastModified is invalid.');
  }
  if (record.sourceAvailability !== undefined
    && !['available', 'missing', 'newer', 'unavailable'].includes(record.sourceAvailability)) {
    throw new Error('Recovery sourceAvailability is invalid.');
  }
  return record as LightTableRecoveryRecord;
};
