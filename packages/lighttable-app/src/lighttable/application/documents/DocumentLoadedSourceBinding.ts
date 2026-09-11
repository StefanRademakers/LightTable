import type { ImageDocument } from '../../editor/document/documentTypes';
import type { FontAssetBlob, PreservedSourceAssetBlob } from '../../editor/persistence/layeredDocumentFormat';
import type { LightTableImageMetadata } from '../../types';
import type { DocumentSession } from './documentSession';
import type { DocumentFontHydrationOwner } from './DocumentFontHydrationOwner';

export interface LoadedSourcePresentationPort {
  isCurrent(): boolean;
  getDocument(): ImageDocument | null;
  metadata(value: LightTableImageMetadata | null): void;
  source(name: string, blob: Blob | null, identity: string): void;
  fontPending(value: boolean): void;
  fontError(message: string): void;
}

/**
 * Loaded-source publication for one mounted document binding. Session state is
 * canonical; the embedded host (without a session) retains only export assets.
 * This owner does not open documents, reset tools/history or own session fonts.
 * Its synchronous writes participate in publishPreparedDocument's outer batch.
 */
export class DocumentLoadedSourceBinding {
  private embeddedPreservedSources: readonly PreservedSourceAssetBlob[] = [];

  constructor(
    private readonly session: DocumentSession | undefined,
    private readonly fontHydration: DocumentFontHydrationOwner,
    private readonly port: LoadedSourcePresentationPort
  ) {}

  /** Cleanup removes only this view; background font work belongs to its document. */
  connect = (): (() => void) => {
    const unsubscribe = this.fontHydration.subscribe(this.projectHydration);
    this.projectHydration();
    return unsubscribe;
  };

  private projectHydration = (): void => {
    if (!this.port.isCurrent()) return;
    const snapshot = this.fontHydration.getSnapshot();
    this.port.fontPending(snapshot.pending);
    if (snapshot.error) this.port.fontError(snapshot.error);
  };

  resetPresentation = (name: string): void => {
    this.assertCurrent();
    this.embeddedPreservedSources = [];
    this.port.source(name, null, '');
    this.port.metadata(null);
    this.port.fontPending(false);
  };

  publishMetadata = (metadata: LightTableImageMetadata): void => {
    this.assertCurrent();
    this.session?.updateLoadedSource(current => ({ ...current, metadata }));
    this.port.metadata(metadata);
  };

  publishSource = (name: string, blob: Blob, identity: string): void => {
    this.assertCurrent();
    this.session?.updateLoadedSource(current => ({ ...current, name, blob, identity }));
    this.port.source(name, blob, identity);
  };

  publishBinaryAssets = (
    fonts: readonly FontAssetBlob[], preservedSources: readonly PreservedSourceAssetBlob[]
  ): void => {
    this.assertCurrent();
    const document = this.port.getDocument();
    if (!document) throw new Error('Document assets require a published document.');
    this.session?.updateLoadedSource(current => ({
      ...current, fontAssets: [...fonts], preservedSources: [...preservedSources]
    }));
    if (!this.session) this.embeddedPreservedSources = [...preservedSources];
    this.fontHydration.load(fonts, document.assets.fonts);
  };

  /** Read-only rebind: never republish source data or reset history/content. */
  presentExisting = (): void => {
    this.assertCurrent();
    const snapshot = this.session?.getSnapshot();
    if (!snapshot?.document) throw new Error('Source rebind requires an existing document session.');
    const { loadedSource: loaded, document, source } = snapshot;
    this.port.metadata(loaded.metadata ?? {
      name: document.name, width: document.width, height: document.height,
      contentType: source.mediaType
    });
    this.port.source(loaded.name, loaded.blob, loaded.identity);
    // Rebind clears general interaction errors after subscriptions reconnect.
    // Restore a retained font failure after that reset, not only at connect.
    this.projectHydration();
  };

  getPreservedSources = (): readonly PreservedSourceAssetBlob[] => {
    this.assertCurrent();
    return this.session?.getSnapshot().loadedSource.preservedSources ?? this.embeddedPreservedSources;
  };

  private assertCurrent(): void {
    if (!this.port.isCurrent()) throw new Error('The loaded-source document binding is no longer current.');
  }
}
