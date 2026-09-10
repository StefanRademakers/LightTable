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

export type PreparedGradientOperation = {
  readonly document: ImageDocument;
  readonly layer: LayerNode;
  readonly layerId: LayerId;
  readonly targetLabel: string;
  readonly channel: PaintChannel;
  readonly paint: GradientPaintInstance;
  readonly opacity: number;
  readonly blendMode: BlendMode;
  readonly preserveTransparency: boolean;
};

export type GradientPreparationResult =
  | { readonly ok: true; readonly plan: PreparedGradientOperation }
  | Extract<GradientOperationResult, { readonly ok: false }>;

const bounds = (document: ImageDocument): Rect => ({
  x: 0, y: 0, width: document.width, height: document.height
});

export const prepareGradientOperation = (
  document: ImageDocument,
  channel: PaintChannel,
  paint: GradientPaintInstance,
  opacity: number,
  blendMode: BlendMode,
  targetLayerId: LayerId | null = document.activeLayerId
): GradientPreparationResult => {
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

  return {
    ok: true,
    plan: {
      document: channel === 'mask'
        ? markLayerMaskPixelsChanged(document, layer.id, bounds(document))
        : markLayerPixelsChanged(document, layer.id, bounds(document)),
      layer,
      layerId: layer.id,
      targetLabel: channel === 'mask' ? 'Mask' : layer.name,
      channel,
      paint,
      opacity,
      blendMode,
      preserveTransparency: channel === 'pixels'
        && layer.type === 'raster'
        && layer.locks.transparency
    }
  };
};

export const executePreparedGradientOperation = (
  renderer: GradientRendererPort,
  plan: PreparedGradientOperation
): GradientOperationResult => {
  let transactionOpen = false;
  try {
    renderer.beginBrushStroke(plan.layer, plan.channel);
    transactionOpen = true;
    if (!renderer.fillLayerGradient(
      plan.layerId,
      plan.channel,
      plan.paint,
      plan.opacity,
      plan.blendMode,
      plan.preserveTransparency
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
      document: plan.document,
      layerId: plan.layerId,
      targetLabel: plan.targetLabel,
      channel: plan.channel,
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

export const executeGradientOperation = (
  document: ImageDocument,
  renderer: GradientRendererPort,
  channel: PaintChannel,
  paint: GradientPaintInstance,
  opacity: number,
  blendMode: BlendMode,
  targetLayerId: LayerId | null = document.activeLayerId
): GradientOperationResult => {
  const prepared = prepareGradientOperation(
    document, channel, paint, opacity, blendMode, targetLayerId
  );
  return prepared.ok ? executePreparedGradientOperation(renderer, prepared.plan) : prepared;
};
