import type { DocumentFontAsset } from '../../editor/document/documentTypes';
import type { FontAssetBlob } from '../../editor/persistence/layeredDocumentFormat';
import type { DocumentFontRegistry } from '../../text/fonts/DocumentFontRegistry';
import { hydrateDocumentFonts } from './hydrateDocumentFonts';

export interface DocumentFontHydrationSnapshot {
  readonly pending: boolean;
  readonly error: string | null;
}

/** Document-lifetime font loading; a tab's presentation only subscribes. */
export class DocumentFontHydrationOwner {
  private operation: object | null = null;
  private disposed = false;
  private snapshot: DocumentFontHydrationSnapshot = { pending: false, error: null };
  private readonly listeners = new Set<() => void>();

  constructor(private readonly registry: DocumentFontRegistry) {}

  getSnapshot = (): DocumentFontHydrationSnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    if (this.disposed) throw new Error('Document font hydration has been disposed.');
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  load = (binaries: readonly FontAssetBlob[], metadata: readonly DocumentFontAsset[]): void => {
    if (this.disposed) throw new Error('Document font hydration has been disposed.');
    const operation = {};
    this.operation = operation;
    this.publish({ pending: metadata.length > 0, error: null });
    void hydrateDocumentFonts(this.registry, binaries, metadata,
      () => !this.disposed && this.operation === operation).then(
      () => this.finish(operation, null),
      (reason: unknown) => this.finish(operation,
        reason instanceof Error ? reason.message : 'Document fonts could not be loaded.')
    );
  };

  dispose = (): void => {
    this.disposed = true;
    this.operation = null;
    this.listeners.clear();
  };

  reset = (): void => {
    if (this.disposed) throw new Error('Document font hydration has been disposed.');
    this.operation = null;
    this.publish({ pending: false, error: null });
  };

  private finish(operation: object, error: string | null): void {
    if (this.disposed || this.operation !== operation) return;
    this.operation = null;
    this.publish({ pending: false, error });
  }

  private publish(snapshot: DocumentFontHydrationSnapshot): void {
    this.snapshot = snapshot;
    this.listeners.forEach(listener => listener());
  }
}
