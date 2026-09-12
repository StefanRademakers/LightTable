import type { ImageDocument } from '../../editor/document/documentTypes';
import type { FillCommandController } from '../tools/fill/useFillCommandController';
import type { PixelClipboardCapture } from './pixelClipboardTypes';
import type { ClipboardSelectionState } from './ClipboardHostIntents';

export interface CutPixelsDependencies {
  captureScope(): { isCurrent(): boolean };
  settleInteraction(): Promise<void>;
  getDocument(): ImageDocument | null;
  getSelection(): ClipboardSelectionState;
  copySelected(): Promise<PixelClipboardCapture | null>;
  readonly fill: Pick<FillCommandController, 'apply'>;
  reportStatus(message: string): void;
}

/** The mounted Cut command composes existing copy/fill owners; it owns no pixels or history. */
export class CutPixelsCommand {
  constructor(private readonly resolve: () => CutPixelsDependencies) {}

  async execute(): Promise<PixelClipboardCapture | null> {
    const ports = this.resolve();
    const scope = ports.captureScope();
    await ports.settleInteraction();
    if (!scope.isCurrent()) throw new Error('The cut target document renderer was retired.');
    const document = ports.getDocument();
    const layerId = document?.activeLayerId;
    const selection = ports.getSelection();
    if (!document || !layerId || !selection.active) return null;
    if (!selection.supportBounds) {
      throw new Error('The active selection has no pixels inside the canvas to cut.');
    }
    const selectionRevision = selection.revision;
    const capture = await ports.copySelected();
    if (!capture) return null;
    // Copy may wait for GPU readback and the OS clipboard. Never clear a newer
    // document/selection after that wait, even if its active layer ID is equal.
    if (!scope.isCurrent() || ports.getDocument() !== document
      || ports.getSelection().revision !== selectionRevision) {
      throw new Error('The cut target changed while copying. Pixels were copied but not removed.');
    }
    const cleared = ports.fill.apply({
      layerId, channel: 'pixels', color: '#000000', preserveTransparency: false, opacity: 0
    }, { label: 'Cut', type: 'raster.cut' });
    if (!cleared) return null;
    ports.reportStatus('Selected pixels cut to the system clipboard');
    return capture;
  }
}
