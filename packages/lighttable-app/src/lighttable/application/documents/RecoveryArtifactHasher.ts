import { sha256Hex } from '../../../platform/LightTableRecoveryStore';

const WORKER_THRESHOLD_BYTES = 4 * 1024 * 1024;

export interface PreparedRecoveryArtifact { readonly checksumSha256: string; readonly bytes?: ArrayBuffer }
interface PendingHash { readonly resolve: (value: PreparedRecoveryArtifact) => void; readonly reject: (reason: Error) => void }

/** Keeps large recovery hashing off the interaction thread. Small artifacts use
 * WebCrypto directly so ordinary documents do not pay worker startup cost. */
export class RecoveryArtifactHasher {
  private worker: Worker | null = null;
  private sequence = 0;
  private readonly pending = new Map<number, PendingHash>();
  private disposed = false;

  hash(blob: Blob): Promise<string> {
    return this.prepare(blob).then(({ checksumSha256 }) => checksumSha256);
  }

  prepare(blob: Blob): Promise<PreparedRecoveryArtifact> {
    if (this.disposed) return Promise.reject(new Error('Recovery hashing is closed.'));
    if (blob.size < WORKER_THRESHOLD_BYTES || typeof Worker === 'undefined') {
      return sha256Hex(blob).then((checksumSha256) => ({ checksumSha256 }));
    }
    this.worker ??= this.createWorker();
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        this.worker!.postMessage({ id, blob });
      } catch (reason) {
        this.pending.delete(id);
        reject(reason instanceof Error ? reason : new Error('Recovery hashing failed to start.'));
      }
    });
  }

  dispose(): void {
    this.disposed = true;
    this.worker?.terminate(); this.worker = null;
    for (const { reject } of this.pending.values()) reject(new Error('Recovery hashing was canceled.'));
    this.pending.clear();
  }

  private createWorker(): Worker {
    const worker = new Worker(new URL('./recoveryHashWorker.ts', import.meta.url), {
      type: 'module', name: 'LightTable recovery hash'
    });
    worker.onmessage = ({ data }: MessageEvent<{ id: number; value?: string; bytes?: ArrayBuffer; error?: string }>) => {
      const pending = this.pending.get(data.id);
      if (!pending) return;
      this.pending.delete(data.id);
      if (data.error || !data.value) pending.reject(new Error(data.error ?? 'Recovery hashing failed.'));
      else pending.resolve({ checksumSha256: data.value, ...(data.bytes ? { bytes: data.bytes } : {}) });
    };
    worker.onerror = (event) => {
      const error = new Error(event.message || 'Recovery hashing worker failed.');
      for (const { reject } of this.pending.values()) reject(error);
      this.pending.clear(); worker.terminate(); this.worker = null;
    };
    worker.onmessageerror = () => {
      const error = new Error('Recovery hashing worker returned an unreadable response.');
      for (const { reject } of this.pending.values()) reject(error);
      this.pending.clear(); worker.terminate(); this.worker = null;
    };
    return worker;
  }
}
