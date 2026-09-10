import type { ImageDocument } from '../../editor/document/documentTypes';
import type { DocumentMutationTransaction } from '../documents/useDocumentMutationController';

export interface TextPropertyProjectionScheduler {
  request(callback: () => void): number;
  cancel(frame: number): void;
  reportError(message: string): void;
}

/**
 * Keeps pointer-rate text property input staged in the document transaction and
 * projects at most once per animation frame. The transaction remains the only
 * canonical/history owner.
 */
export class DocumentTextPropertyGestureController {
  private frame: number | null = null;

  constructor(
    readonly transaction: DocumentMutationTransaction,
    private readonly scheduler: TextPropertyProjectionScheduler
  ) {}

  get active() {
    return this.transaction.active;
  }

  stage(change: (document: ImageDocument) => ImageDocument) {
    if (!this.transaction.stage(change)) return false;
    if (this.frame === null) {
      this.frame = this.scheduler.request(() => {
        this.frame = null;
        try {
          this.transaction.project();
        } catch (error) {
          this.transaction.cancel();
          this.scheduler.reportError(error instanceof Error
            ? `The text property preview failed: ${error.message}`
            : 'The text property preview failed.');
        }
      });
    }
    return true;
  }

  commit() {
    this.cancelFrame();
    return this.transaction.commit();
  }

  cancel() {
    this.cancelFrame();
    return this.transaction.cancel();
  }

  private cancelFrame() {
    if (this.frame === null) return;
    this.scheduler.cancel(this.frame);
    this.frame = null;
  }
}
