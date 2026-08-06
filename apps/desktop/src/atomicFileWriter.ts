import { randomUUID } from 'node:crypto';
import {
  lstat,
  open,
  rename,
  stat,
  unlink,
  type FileHandle
} from 'node:fs/promises';
import path from 'node:path';

export type AtomicWritePhase =
  | 'prepare'
  | 'write'
  | 'flush'
  | 'validate'
  | 'replace'
  | 'cleanup';

export interface AtomicWriteFaultInjector {
  (phase: AtomicWritePhase): void | Promise<void>;
}

export class AtomicWriteError extends Error {
  readonly phase: AtomicWritePhase;
  readonly cause: unknown;

  constructor(phase: AtomicWritePhase, message: string, cause?: unknown) {
    super(message);
    this.name = 'AtomicWriteError';
    this.phase = phase;
    this.cause = cause;
  }
}

export interface AtomicWriteFileOptions {
  readonly targetPath: string;
  readonly bytes: Uint8Array;
  readonly injectFault?: AtomicWriteFaultInjector;
  readonly validate?: (temporaryPath: string, expectedBytes: Uint8Array) => Promise<void>;
  /** Deterministic filesystem seam for replacement-compatibility tests. */
  readonly renameFile?: typeof rename;
}

export interface AtomicWriteFileResult {
  readonly durability: 'atomic-replace' | 'safe-replace';
}

const fault = async (
  inject: AtomicWriteFaultInjector | undefined,
  phase: AtomicWritePhase
) => inject?.(phase);

const errorCode = (reason: unknown): string | null => (
  reason && typeof reason === 'object' && 'code' in reason
    ? String(reason.code)
    : null
);

const isReplaceCompatibilityError = (reason: unknown): boolean => (
  ['EEXIST', 'EPERM', 'ENOTEMPTY'].includes(errorCode(reason) ?? '')
);

const unlinkIfPresent = async (filePath: string): Promise<void> => {
  try {
    await unlink(filePath);
  } catch (reason) {
    if (errorCode(reason) !== 'ENOENT') throw reason;
  }
};

const closeIfOpen = async (handle: FileHandle | null): Promise<void> => {
  if (!handle) return;
  try {
    await handle.close();
  } catch {
    // The original write/flush failure is more actionable than a late close.
  }
};

const syncParentDirectory = async (targetPath: string): Promise<void> => {
  if (process.platform === 'win32') return;
  const directory = await open(path.dirname(targetPath), 'r');
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
};

/**
 * Publishes a complete sibling temporary file. The compatibility fallback
 * moves the previous target to a sibling backup before publication and restores
 * it on failure, so a failed replace never destroys the last valid document.
 */
export const atomicWriteFile = async ({
  targetPath,
  bytes,
  injectFault,
  validate = validateLightTableSaveArtifact,
  renameFile = rename
}: AtomicWriteFileOptions): Promise<AtomicWriteFileResult> => {
  const absoluteTarget = path.resolve(targetPath);
  const directory = path.dirname(absoluteTarget);
  const base = path.basename(absoluteTarget);
  const transactionId = randomUUID();
  const temporaryPath = path.join(directory, `.${base}.${transactionId}.tmp`);
  const backupPath = path.join(directory, `.${base}.${transactionId}.previous`);
  let handle: FileHandle | null = null;
  let previousMoved = false;
  let published = false;
  let phase: AtomicWritePhase = 'prepare';

  try {
    await fault(injectFault, 'prepare');
    try {
      const existing = await lstat(absoluteTarget);
      if (existing.isSymbolicLink()) {
        throw new Error('Refusing to replace a symbolic-link save target.');
      }
      if (!existing.isFile()) throw new Error('The save target is not a regular file.');
    } catch (reason) {
      if (errorCode(reason) !== 'ENOENT') throw reason;
    }

    phase = 'write';
    await fault(injectFault, phase);
    handle = await open(temporaryPath, 'wx', 0o600);
    await handle.writeFile(bytes);

    phase = 'flush';
    await fault(injectFault, phase);
    await handle.sync();
    await handle.close();
    handle = null;

    phase = 'validate';
    await fault(injectFault, phase);
    await validate(temporaryPath, bytes);

    phase = 'replace';
    await fault(injectFault, phase);
    try {
      await renameFile(temporaryPath, absoluteTarget);
      published = true;
      await syncParentDirectory(absoluteTarget);
      return { durability: 'atomic-replace' };
    } catch (reason) {
      if (!isReplaceCompatibilityError(reason)) throw reason;
    }

    try {
      await renameFile(absoluteTarget, backupPath);
      previousMoved = true;
    } catch (reason) {
      if (errorCode(reason) !== 'ENOENT') throw reason;
    }
    try {
      await renameFile(temporaryPath, absoluteTarget);
      published = true;
      await syncParentDirectory(absoluteTarget);
    } catch (reason) {
      if (previousMoved) {
        await renameFile(backupPath, absoluteTarget);
        previousMoved = false;
      }
      throw reason;
    }
    if (previousMoved) {
      await unlinkIfPresent(backupPath);
      previousMoved = false;
    }
    return { durability: 'safe-replace' };
  } catch (reason) {
    await closeIfOpen(handle);
    if (previousMoved && !published) {
      try {
        await renameFile(backupPath, absoluteTarget);
        previousMoved = false;
      } catch (restoreReason) {
        throw new AtomicWriteError(
          'cleanup',
          `Save failed during ${phase} and the previous file could not be restored: ${String(restoreReason)}`,
          reason
        );
      }
    }
    throw reason instanceof AtomicWriteError
      ? reason
      : new AtomicWriteError(
          phase,
          `Save failed during ${phase}: ${reason instanceof Error ? reason.message : String(reason)}`,
          reason
        );
  } finally {
    try {
      await unlinkIfPresent(temporaryPath);
      if (!previousMoved) await unlinkIfPresent(backupPath);
    } catch (reason) {
      if (!published) {
        throw new AtomicWriteError('cleanup', `Save cleanup failed: ${String(reason)}`, reason);
      }
    }
  }
};

const PNG_SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
const PSD_SIGNATURE = new TextEncoder().encode('8BPS');
const PDF_SIGNATURE = new TextEncoder().encode('%PDF-');
const LIGHTTABLE_FOOTER_MAGIC = new TextEncoder().encode('LTBLDOC1');

const bytesEqual = (left: Uint8Array, right: Uint8Array): boolean =>
  left.byteLength === right.byteLength && left.every((value, index) => value === right[index]);

/** Validates size plus known container boundaries without a full-file reread. */
export const validateLightTableSaveArtifact = async (
  temporaryPath: string,
  expectedBytes: Uint8Array
): Promise<void> => {
  const details = await stat(temporaryPath);
  if (!details.isFile() || details.size !== expectedBytes.byteLength) {
    throw new Error('The prepared file length does not match the serialized artifact.');
  }
  if (expectedBytes.byteLength === 0) throw new Error('The serialized artifact is empty.');
  const handle = await open(temporaryPath, 'r');
  try {
    const signature = new Uint8Array(Math.min(PNG_SIGNATURE.byteLength, expectedBytes.byteLength));
    await handle.read(signature, 0, signature.byteLength, 0);
    const expectedIsPng = expectedBytes.byteLength >= PNG_SIGNATURE.byteLength
      && bytesEqual(expectedBytes.subarray(0, PNG_SIGNATURE.byteLength), PNG_SIGNATURE);
    const expectedIsPsd = expectedBytes.byteLength >= PSD_SIGNATURE.byteLength
      && bytesEqual(expectedBytes.subarray(0, PSD_SIGNATURE.byteLength), PSD_SIGNATURE);
    const expectedIsPdf = expectedBytes.byteLength >= PDF_SIGNATURE.byteLength
      && bytesEqual(expectedBytes.subarray(0, PDF_SIGNATURE.byteLength), PDF_SIGNATURE);
    const expectedSignature = expectedIsPng
      ? PNG_SIGNATURE
      : expectedIsPsd
        ? PSD_SIGNATURE
        : expectedIsPdf
          ? PDF_SIGNATURE
          : expectedBytes.subarray(0, signature.byteLength);
    if (!bytesEqual(signature.subarray(0, expectedSignature.byteLength), expectedSignature)) {
      throw new Error('The prepared artifact signature was not written completely.');
    }
    if (expectedIsPng && expectedBytes.byteLength >= 12) {
      const footer = new Uint8Array(12);
      await handle.read(footer, 0, footer.byteLength, expectedBytes.byteLength - footer.byteLength);
      const expectedHasFooter = bytesEqual(
        expectedBytes.subarray(expectedBytes.byteLength - 12, expectedBytes.byteLength - 4),
        LIGHTTABLE_FOOTER_MAGIC
      );
      const writtenHasFooter = bytesEqual(footer.subarray(0, 8), LIGHTTABLE_FOOTER_MAGIC);
      if (expectedHasFooter !== writtenHasFooter) {
        throw new Error('The LightTable container footer was not written completely.');
      }
      if (writtenHasFooter) {
        const manifestLength = new DataView(
          footer.buffer,
          footer.byteOffset,
          footer.byteLength
        ).getUint32(8, true);
        if (manifestLength <= 0 || manifestLength > expectedBytes.byteLength - 12) {
          throw new Error('The LightTable container manifest boundary is invalid.');
        }
      }
    }
  } finally {
    await handle.close();
  }
};
