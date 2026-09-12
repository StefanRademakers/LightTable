import type { ImageDocument, LayerId } from '../../../editor/document/documentTypes';
import { findDocumentLayer } from '../../../editor/document/layerTree';
import { pickCurrentTransformLayer, type TransformLayerAlphaPicker } from './transformLayerPicker';
import { resolveTransformCanvasLayerSelection } from './transformCanvasLayerSelection';

export interface TransformCanvasPickPorts {
  read(): { readonly document: ImageDocument | null; readonly selectedLayerIds: readonly LayerId[];
    readonly autoSelect: boolean; readonly historyBusy: boolean; readonly tool: string };
  getPicker(): TransformLayerAlphaPicker | null;
  captureScope(): { isCurrent(): boolean };
  commitTransform(): Promise<unknown>;
  publishSelection(layerIds: readonly LayerId[]): void;
  /** The existing selection owner must check this admission before its post-preparation write. */
  selectLayer(layerId: LayerId, isCurrent: () => boolean, onSelected: () => void): Promise<boolean>;
  activateTransform(): void;
  reportError(message: string): void;
}

/** Owns one click's hit -> transform terminal -> selection -> activation, never the underlying edits. */
export class TransformCanvasPickIntent {
  private revision = 0;
  constructor(private readonly getPorts: () => TransformCanvasPickPorts) {}
  cancel = () => { ++this.revision; };

  request = async (point: { x: number; y: number }, extend = false): Promise<boolean> => {
    const ports = this.getPorts(); const opening = ports.read(); const picker = ports.getPicker();
    if (!opening.document || !picker || opening.historyBusy || !opening.autoSelect) return false;
    const scope = ports.captureScope(); const revision = ++this.revision;
    const isCurrent = () => revision === this.revision && scope.isCurrent()
      && ports.getPicker() === picker && ports.read().tool === opening.tool;
    if (!isCurrent()) return false;
    try {
      const pick = await pickCurrentTransformLayer({ initialDocument: opening.document,
        point: { ...point }, picker, isCurrent, getCurrentDocument: () => ports.read().document });
      if (!pick || !isCurrent()) return false;
      // The hit was resolved against the preview; its owning terminal publishes before layer selection.
      await ports.commitTransform();
      if (!isCurrent()) return false;
      const current = ports.read(); const document = current.document;
      if (!document || document.id !== opening.document.id || !findDocumentLayer(document, pick.layerId)) return false;
      const next = resolveTransformCanvasLayerSelection(current.selectedLayerIds,
        document.activeLayerId, pick.layerId, extend);
      if (!await ports.selectLayer(next.activeLayerId, isCurrent, () => {
        if (isCurrent()) ports.publishSelection(next.selectedLayerIds);
      }) || !isCurrent()) return false;
      const selected = ports.read().document;
      if (selected?.id !== opening.document.id || selected.activeLayerId !== next.activeLayerId
        || !findDocumentLayer(selected, next.activeLayerId)) return false;
      ports.activateTransform();
      return true;
    } catch (reason) {
      if (isCurrent()) ports.reportError(reason instanceof Error ? reason.message : 'The layer could not be selected.');
      return false;
    }
  };
}
