import type { GradientPaintInstance } from '@lighttable/paint-core';
import {
  markLayerMaskPixelsChanged,
  markLayerPixelsChanged
} from '../../../editor/document/documentCommands';
import type { BlendMode } from '../../../editor/document/blendModes';
import type { ImageDocument, LayerId, LayerNode, Rect } from '../../../editor/document/documentTypes';
import { findDocumentLayer, findRasterLayer } from '../../../editor/document/layerTree';
import type { ReversiblePixelEdit } from '../../../editor/history/ReversiblePixelEdit';
import type { PaintChannel } from '../../../editor/session/editorSession';
import type { FillRendererPort } from '../fill/fillOperation';

export interface GradientRendererPort extends FillRendererPort {
  fillLayerGradient(
    layerId: LayerId,
    channel: PaintChannel,
    paint: GradientPaintInstance,
    opacity: number,
    blendMode: BlendMode,
    preserveTransparency: boolean
  ): boolean;
}

export type GradientOperationResult = {
  readonly ok: true;
  readonly document: ImageDocument;
  readonly layerId: LayerId;
  readonly targetLabel: string;
  readonly channel: PaintChannel;
  readonly pixelEdit: ReversiblePixelEdit;
} | {
  readonly ok: false;
  readonly message: string;
};

const bounds = (document: ImageDocument): Rect => ({
  x: 0, y: 0, width: document.width, height: document.height
});

export const executeGradientOperation = (
  document: ImageDocument,
  renderer: GradientRendererPort,
  channel: PaintChannel,
  paint: GradientPaintInstance,
  opacity: number,
  blendMode: BlendMode,
  targetLayerId: LayerId | null = document.activeLayerId
): GradientOperationResult => {
  if (!targetLayerId) return { ok: false, message: 'Select a layer before drawing a pixel gradient.' };
  const layer: LayerNode | null = channel === 'mask'
    ? findDocumentLayer(document, targetLayerId)
    : findRasterLayer(document, targetLayerId);
  if (!layer || (channel === 'mask' && !('mask' in layer && layer.mask))) {
    return {
      ok: false,
      message: channel === 'mask'
        ? 'Select a layer with an editable mask before drawing a gradient.'
        : 'Select a raster layer or choose Gradient Fill mode.'
    };
  }
  if (layer.locks.all || (channel === 'pixels' && layer.locks.pixels)) {
    return { ok: false, message: 'Unlock the gradient target before editing it.' };
  }

  let transactionOpen = false;
  try {
    renderer.beginBrushStroke(layer, channel);
    transactionOpen = true;
    const preserveTransparency = channel === 'pixels'
      && layer.type === 'raster'
      && layer.locks.transparency;
    if (!renderer.fillLayerGradient(
      layer.id,
      channel,
      paint,
      opacity,
      blendMode,
      preserveTransparency
    )) {
      renderer.cancelPixelEdit();
      transactionOpen = false;
      return { ok: false, message: 'The active gradient target is not available on the GPU.' };
    }
    const pixelEdit = renderer.finishPixelEdit();
    if (!pixelEdit) {
      renderer.cancelPixelEdit();
      transactionOpen = false;
      return { ok: false, message: 'The gradient could not create an undo snapshot.' };
    }
    transactionOpen = false;
    return {
      ok: true,
      document: channel === 'mask'
        ? markLayerMaskPixelsChanged(document, layer.id, bounds(document))
        : markLayerPixelsChanged(document, layer.id, bounds(document)),
      layerId: layer.id,
      targetLabel: channel === 'mask' ? 'Mask' : layer.name,
      channel,
      pixelEdit
    };
  } catch (reason) {
    if (transactionOpen) renderer.cancelPixelEdit();
    return {
      ok: false,
      message: reason instanceof Error ? reason.message : 'The pixel gradient failed.'
    };
  }
};
