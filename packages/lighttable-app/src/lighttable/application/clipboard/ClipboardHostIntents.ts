import type { LightTableClipboardImagePlacement, LightTableImageClipboard } from '../../../platform/LightTableImageClipboard';
import type { ImageDocument, Rect } from '../../editor/document/documentTypes';
import type { PaintChannel } from '../../editor/session/editorSession';
import { centerClipboardBounds, visibleDocumentBounds } from './pastePlacement';

/** Exact committed coverage, read from DocumentSelectionStateStore; never operation provenance. */
export interface ClipboardSelectionState {
  readonly active: boolean;
  readonly supportBounds: Rect | null;
  readonly revision: number;
}

export interface ClipboardHostContext {
  readonly document: ImageDocument;
  readonly selection: ClipboardSelectionState;
  readonly channel: PaintChannel;
  readonly viewportSize: { readonly width: number; readonly height: number };
  readonly imageRect: Rect;
}

export interface PreparedClipboardImage {
  readonly file: File;
  readonly width: number;
  readonly height: number;
  dispose(): void;
}

type ClipboardHostCommand = 'selection.copyPixels' | 'selection.cutPixels'
  | 'selection.pastePixels' | 'vector.importSvg' | 'layer.copyToNewLayer';
type ClipboardCommandResult = { readonly status: 'completed' | 'accepted' }
  | { readonly status: 'rejected'; readonly message: string };

export interface ClipboardHostDependencies {
  captureScope(): { isCurrent(): boolean };
  getContext(): ClipboardHostContext | null;
  settleInteraction(): Promise<void>;
  readonly clipboard: Pick<LightTableImageClipboard, 'readImage'>;
  prepareImage(blob: Blob): Promise<PreparedClipboardImage>;
  execute(command: ClipboardHostCommand, parameters: unknown): Promise<ClipboardCommandResult>;
  readonly artifacts: {
    matchingCopy(placement: LightTableClipboardImagePlacement): { readonly id: string } | null;
    register(file: File): { readonly id: string };
    release(id: string): unknown;
  };
  reportError(message: string): void;
}

/** Host intent only: semantic commands retain pixel, admission and history ownership. */
export class ClipboardHostIntents {
  constructor(private readonly resolve: () => ClipboardHostDependencies) {}

  copy(source: 'active-layer' | 'merged') {
    return this.dispatch('selection.copyPixels', { source });
  }

  cut() { return this.dispatch('selection.cutPixels', {}); }

  layerViaCopy() {
    const layerId = this.resolve().getContext()?.document.activeLayerId;
    return layerId ? this.dispatch('layer.copyToNewLayer', { layerId }) : Promise.resolve(false);
  }

  private async dispatch(command: ClipboardHostCommand, parameters: unknown): Promise<boolean> {
    const ports = this.resolve();
    const scope = ports.captureScope();
    try {
      if (!scope.isCurrent()) return false;
      const result = await ports.execute(command, parameters);
      if (result.status === 'rejected') throw new Error(result.message);
      if (result.status !== 'completed') throw new Error('The clipboard command unexpectedly continued as a background task.');
      return true;
    } catch (reason) {
      if (scope.isCurrent()) ports.reportError(reason instanceof Error ? reason.message : String(reason));
      return false;
    }
  }

  async paste(): Promise<boolean> {
    const ports = this.resolve();
    const scope = ports.captureScope();
    let prepared: PreparedClipboardImage | null = null;
    let ownedArtifact: string | null = null;
    try {
      await ports.settleInteraction();
      if (!scope.isCurrent()) return false;
      const target = ports.getContext();
      if (!target) return false;
      const targetIsCurrent = () => {
        if (!scope.isCurrent()) return false;
        const current = ports.getContext();
        if (current?.document !== target.document
          || current.selection.revision !== target.selection.revision || current.channel !== target.channel) {
          throw new Error('The paste target changed while reading the clipboard. Paste again into the intended target.');
        }
        return true;
      };
      const image = await ports.clipboard.readImage();
      if (!targetIsCurrent()) return false;
      if (!image) throw new Error('The system clipboard does not contain an image.');
      if (image.blob.type === 'image/svg+xml' && target.channel !== 'mask') {
        const svg = await image.blob.text();
        if (!targetIsCurrent()) return false;
        const result = await ports.execute('vector.importSvg', { svg, placement: 'document', layerName: 'Pasted SVG' });
        if (result.status === 'rejected') throw new Error(result.message);
        if (result.status !== 'completed') throw new Error('SVG paste unexpectedly continued as a background task.');
        return true;
      }
      if (target.selection.active && !target.selection.supportBounds) {
        throw new Error('The active selection has no pixels inside the canvas. Move or clear it before pasting.');
      }
      const targetBounds = target.selection.active
        ? target.selection.supportBounds!
        : visibleDocumentBounds(target.document, target.viewportSize, target.imageRect);
      prepared = await ports.prepareImage(image.blob);
      if (!targetIsCurrent()) return false;
      const bounds = centerClipboardBounds(prepared, targetBounds);
      const matched = image.placement ? ports.artifacts.matchingCopy(image.placement) : null;
      const artifact = matched ?? ports.artifacts.register(prepared.file);
      if (!matched) ownedArtifact = artifact.id;
      if (!targetIsCurrent()) return false;
      // Completed/accepted commands retain artifacts for Actions replay. A known
      // rejection returns our new artifact; uncertain dispatch keeps it retained.
      ownedArtifact = null;
      const result = await ports.execute('selection.pastePixels', {
        artifactId: artifact.id, name: 'Pasted Selection', bounds,
        target: target.channel === 'mask'
          ? { channel: 'mask', layerId: target.document.activeLayerId ?? undefined }
          : { channel: 'pixels' }
      });
      if (result.status === 'rejected') {
        if (!matched) ownedArtifact = artifact.id;
        throw new Error(result.message);
      }
      if (result.status !== 'completed') {
        throw new Error('Pixel paste unexpectedly continued as a background task; its input artifact was retained.');
      }
      return true;
    } catch (reason) {
      if (scope.isCurrent()) ports.reportError(reason instanceof Error ? reason.message : String(reason));
      return false;
    } finally {
      try { prepared?.dispose(); }
      finally { if (ownedArtifact) ports.artifacts.release(ownedArtifact); }
    }
  }
}
