import type { ImageDocument } from '../../editor/document/documentTypes';
import type { DocumentRendererLifecycle, DocumentRendererSnapshot } from './documentRendererLifecycle';
import { resolveDocumentGpuRecoveryPolicy } from './documentGpuRecoveryPolicy';

export type GpuRecoverySource =
  | { readonly kind: 'document'; readonly document: ImageDocument }
  | { readonly kind: 'startup' }
  | { readonly kind: 'unavailable' };

export interface DocumentGpuRecoveryScope {
  readonly session: object | undefined;
  readonly lifecycle: DocumentRendererLifecycle;
  readonly renderer: object | null;
  isCurrent(): boolean;
  getSource(): GpuRecoverySource;
  reportError(message: string): void;
  requestReopen(): void;
}

interface Failure {
  readonly session: object | undefined;
  readonly lifecycle: DocumentRendererLifecycle;
  readonly renderer: object | null;
  readonly generation: number;
}
const sameFailure = (a: Failure | null, b: Failure) => a !== null && a.session === b.session
  && a.lifecycle === b.lifecycle && a.renderer === b.renderer && a.generation === b.generation;
const RECOVERY_LIMIT = 2;
const STABILITY_WINDOW_MS = 30_000;
const RETRY_DELAY_MS = 50;

/** Host-wide recovery admission only. The existing open controller owns all renderer work. */
export class DocumentGpuRecoveryController {
  private attempts = 0;
  private handled: Failure | null = null;
  private readonly lostRenderers = new WeakSet<object>();
  private disconnect: (() => void) | null = null;

  /** Check the opener's actual retained candidate; this gate never consumes a flag. */
  canReuseRenderer = (candidate: object): boolean => !this.lostRenderers.has(candidate);

  connect(scope: DocumentGpuRecoveryScope): () => void {
    this.disconnect?.();
    let connected = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let previous: DocumentRendererSnapshot | null = null;
    const cancelTimer = () => { if (timer !== null) clearTimeout(timer); timer = null; };
    const owns = (generation: number, status: DocumentRendererSnapshot['status']) => {
      const current = scope.lifecycle.getSnapshot();
      return connected && scope.isCurrent() && current.generation === generation && current.status === status;
    };
    const reportBlocked = (failure: Failure, error: string, reason: string) => {
      this.handled = failure;
      scope.reportError(`${error} ${reason}`);
    };
    const eligible = (failure: Failure, error: string): boolean => {
      const source = scope.getSource();
      if (source.kind === 'unavailable') {
        reportBlocked(failure, error, 'Automatic renderer recovery was stopped because canonical document state is unavailable. Reopen the saved source or restore its recovery checkpoint.');
        return false;
      }
      if (source.kind === 'document') {
        const policy = resolveDocumentGpuRecoveryPolicy(source.document);
        if (policy.mode === 'checkpoint-required') {
          reportBlocked(failure, error, `Automatic renderer recovery was stopped to protect ${policy.reasons.join(', ')}. Restore the document from its recovery checkpoint or reopen the saved source; LightTable will not present missing pixels as recovered.`);
          return false;
        }
      }
      if (this.attempts >= RECOVERY_LIMIT) {
        reportBlocked(failure, error, `Automatic renderer recovery was stopped after ${RECOVERY_LIMIT} consecutive device-loss recoveries. Reopen the saved source or restore its recovery checkpoint.`);
        return false;
      }
      return true;
    };
    const observe = (snapshot: DocumentRendererSnapshot) => {
      if (!connected || !scope.isCurrent()) { cancelTimer(); return; }
      if (previous?.generation === snapshot.generation && previous.status === snapshot.status && previous.error === snapshot.error) return;
      previous = snapshot;
      cancelTimer();
      if (snapshot.status === 'ready') {
        timer = setTimeout(() => {
          timer = null;
          if (owns(snapshot.generation, 'ready')) this.attempts = 0;
        }, STABILITY_WINDOW_MS);
        return;
      }
      if (snapshot.status !== 'failed' || !/^WebGPU device lost:/u.test(snapshot.error ?? '')) return;
      const failure: Failure = { session: scope.session, lifecycle: scope.lifecycle, renderer: scope.renderer, generation: snapshot.generation };
      if (scope.renderer) this.lostRenderers.add(scope.renderer);
      if (sameFailure(this.handled, failure) || !eligible(failure, snapshot.error!)) return;
      timer = setTimeout(() => {
        timer = null;
        if (!owns(failure.generation, 'failed') || sameFailure(this.handled, failure)) return;
        // A pending authored commit may have completed after the device failed.
        // Recheck canonical recoverability at the actual reopen admission.
        if (!eligible(failure, snapshot.error!)) return;
        this.handled = failure;
        this.attempts += 1;
        scope.requestReopen();
      }, RETRY_DELAY_MS);
    };
    const unsubscribe = scope.lifecycle.subscribe(observe);
    const disconnect = () => {
      if (!connected) return;
      connected = false; cancelTimer(); unsubscribe();
      if (this.disconnect === disconnect) this.disconnect = null;
    };
    this.disconnect = disconnect;
    observe(scope.lifecycle.getSnapshot());
    return disconnect;
  }
}
