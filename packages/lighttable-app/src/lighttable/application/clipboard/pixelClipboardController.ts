import type { ImageDocument, LayerId, Rect } from '../../editor/document/documentTypes';
import { findRasterLayer } from '../../editor/document/layerTree';
import type { SelectionOperation } from '../../editor/selection/selectionTypes';
import type { LightTableImageClipboard } from '../../../platform/LightTableImageClipboard';
import type { LightTableSelectionReadLease } from '../tools/selection/DocumentSelectionStateStore';
import type {
  PixelClipboardCapture,
} from './pixelClipboardTypes';

export interface PixelClipboardRendererPort {
  copySelectedLayerContent(document: ImageDocument, layerId: LayerId): boolean;
  exportSelectionClipboard(bounds: Rect): Promise<Blob>;
  exportMergedSelection(bounds: Rect): Promise<Blob>;
  hasSelectionClipboard(): boolean;
}

export interface PixelClipboardDependencies {
  getDocument(): ImageDocument | null;
  getRenderer(): PixelClipboardRendererPort | null;
  getImageClipboard(): LightTableImageClipboard;
  getDocumentId(): string;
  getSelectionLease(): LightTableSelectionReadLease | null;
  setSelectionClipboardAvailable(available: boolean): void;
  setStatus(message: string | null): void;
  setError(message: string | null): void;
}

export interface PixelClipboardController {
  copySelected(selection: readonly SelectionOperation[]): Promise<PixelClipboardCapture | null>;
  copyMerged(selection: readonly SelectionOperation[]): Promise<PixelClipboardCapture | null>;
  canUseFastPaste(token?: string): boolean;
  readCommittedSelection(document: ImageDocument): {
    readonly active: boolean;
    readonly bounds: Rect | null;
  } | null;
  invalidateRendererScratch(): void;
}

const documentBounds = (document: ImageDocument): Rect => ({
  x: 0, y: 0, width: document.width, height: document.height
});

export const createPixelClipboardController = (
  resolve: () => PixelClipboardDependencies
): PixelClipboardController => {
  let generation = 0;
  let fastPasteToken: string | null = null;
  let clipboardTail: Promise<void> = Promise.resolve();

  const claimClipboardTurn = () => {
    const previous = clipboardTail;
    let release: () => void = () => undefined;
    clipboardTail = new Promise<void>((resolveTurn) => { release = resolveTurn; });
    return { previous, release };
  };

  const acquireSelectionLease = () => {
    try {
      return { ok: true as const, lease: resolve().getSelectionLease() };
    } catch (reason) {
      resolve().setError(reason instanceof Error
        ? reason.message : 'The committed selection is unavailable.');
      return { ok: false as const, lease: null };
    }
  };

  const selectionBounds = (
    document: ImageDocument,
    lease: LightTableSelectionReadLease
  ) => {
    const committed = lease.selection;
    if (String(committed.documentSessionId) !== resolve().getDocumentId()
      || committed.canvas.width !== document.width
      || committed.canvas.height !== document.height
      || !committed.active) return null;
    return committed.supportBounds ? { ...committed.supportBounds } : null;
  };

  const leaseIsCurrent = (lease: LightTableSelectionReadLease | null) => {
    if (!lease) return false;
    try {
      const current = resolve().getSelectionLease();
      return current?.selection.revision === lease.selection.revision
        && current.document.revision === lease.document.revision;
    } catch {
      return false;
    }
  };

  const write = (blob: Blob, sourceDocumentId: string, bounds: Rect) =>
    resolve().getImageClipboard().writeImage(blob, { sourceDocumentId, ...bounds });

  const bindingIsCurrent = (
    sourceDocumentId: string,
    renderer: PixelClipboardRendererPort
  ) => resolve().getDocumentId() === sourceDocumentId
    && resolve().getRenderer() === renderer
    && Boolean(resolve().getDocument());

  const copySelected: PixelClipboardController['copySelected'] = async (_operations) => {
    const dependencies = resolve();
    const document = dependencies.getDocument();
    const renderer = dependencies.getRenderer();
    const sourceDocumentId = dependencies.getDocumentId();
    const activeLayer = document ? findRasterLayer(document, document.activeLayerId) : null;
    const acquired = acquireSelectionLease();
    if (!acquired.ok) return null;
    const lease = acquired.lease;
    if (!document || !renderer || !activeLayer || !lease) return null;
    const copyGeneration = ++generation;
    fastPasteToken = null;
    const bounds = selectionBounds(document, lease);
    if (!bounds || !leaseIsCurrent(lease)) return null;
    const turn = claimClipboardTurn();
    await turn.previous;
    try {
      if (copyGeneration !== generation
        || !bindingIsCurrent(sourceDocumentId, renderer)
        || !leaseIsCurrent(lease)) return null;
      if (!renderer.copySelectedLayerContent(document, activeLayer.id)) {
        throw new Error('The selected pixels could not be copied from the active layer.');
      }
      const blob = await renderer.exportSelectionClipboard(bounds);
      if (copyGeneration !== generation
        || !bindingIsCurrent(sourceDocumentId, renderer) || !leaseIsCurrent(lease)) {
        throw new Error('The selection changed while its pixels were being copied.');
      }
      await write(blob, sourceDocumentId, bounds);
      if (copyGeneration !== generation
        || !bindingIsCurrent(sourceDocumentId, renderer) || !leaseIsCurrent(lease)) return null;
      const token = `${sourceDocumentId}:${copyGeneration}`;
      fastPasteToken = token;
      dependencies.setSelectionClipboardAvailable(true);
      dependencies.setStatus('Selected pixels copied to the system clipboard');
      dependencies.setError(null);
      return {
        file: new File([blob], 'Selected pixels.png', { type: blob.type || 'image/png' }),
        bounds,
        ...(token ? { fastPasteToken: token } : {})
      };
    } catch (reason) {
      if (copyGeneration === generation && bindingIsCurrent(sourceDocumentId, renderer)) {
        dependencies.setError(reason instanceof Error
          ? reason.message : 'The selected pixels could not be written to the system clipboard.');
      }
      return null;
    } finally {
      turn.release();
    }
  };

  const copyMerged: PixelClipboardController['copyMerged'] = async (_operations) => {
    const dependencies = resolve();
    const document = dependencies.getDocument();
    const renderer = dependencies.getRenderer();
    const sourceDocumentId = dependencies.getDocumentId();
    const acquired = acquireSelectionLease();
    if (!acquired.ok) return null;
    const lease = acquired.lease;
    if (!document || !renderer || !lease) return null;
    const copyGeneration = ++generation;
    fastPasteToken = null;
    const bounds = selectionBounds(document, lease);
    if (!bounds || !leaseIsCurrent(lease)) return null;
    const turn = claimClipboardTurn();
    await turn.previous;
    try {
      if (copyGeneration !== generation
        || !bindingIsCurrent(sourceDocumentId, renderer)
        || !leaseIsCurrent(lease)) return null;
      const blob = await renderer.exportMergedSelection(bounds);
      if (copyGeneration !== generation
        || !bindingIsCurrent(sourceDocumentId, renderer) || !leaseIsCurrent(lease)) {
        throw new Error('The selection changed while merged pixels were being copied.');
      }
      await write(blob, sourceDocumentId, bounds);
      if (copyGeneration !== generation
        || !bindingIsCurrent(sourceDocumentId, renderer) || !leaseIsCurrent(lease)) return null;
      dependencies.setSelectionClipboardAvailable(true);
      dependencies.setStatus('Merged selection copied to the system clipboard');
      dependencies.setError(null);
      return {
        file: new File([blob], 'Merged pixels.png', { type: blob.type || 'image/png' }),
        bounds
      };
    } catch (reason) {
      if (copyGeneration === generation && bindingIsCurrent(sourceDocumentId, renderer)) {
        dependencies.setError(reason instanceof Error
          ? reason.message : 'The merged selection could not be copied.');
      }
      return null;
    } finally {
      turn.release();
    }
  };

  return {
    copySelected,
    copyMerged,
    canUseFastPaste: (token) => Boolean(token)
      && token === fastPasteToken
      && (resolve().getRenderer()?.hasSelectionClipboard() ?? false),
    readCommittedSelection: (document) => {
      const acquired = acquireSelectionLease();
      if (!acquired.ok || !acquired.lease) return null;
      const committed = acquired.lease.selection;
      if (String(committed.documentSessionId) !== resolve().getDocumentId()
        || committed.canvas.width !== document.width
        || committed.canvas.height !== document.height
        || !leaseIsCurrent(acquired.lease)) {
        resolve().setError('The committed selection does not belong to the active document.');
        return null;
      }
      return {
        active: committed.active,
        bounds: committed.active && committed.supportBounds
          ? { ...committed.supportBounds }
          : null
      };
    },
    invalidateRendererScratch: () => {
      generation += 1;
      fastPasteToken = null;
    }
  };
};
