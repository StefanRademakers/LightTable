import {
  markLayerMaskPixelsChanged,
  markLayerPixelsChanged
} from '../../../editor/document/documentCommands';
import type {
  ImageDocument,
  LayerId,
  LayerNode,
  Rect
} from '../../../editor/document/documentTypes';
import {
  findDocumentLayer,
  findRasterLayer
} from '../../../editor/document/layerTree';
import type { PaintChannel } from '../../../editor/session/editorSession';
import type { ReversiblePixelEdit } from '../../../editor/history/ReversiblePixelEdit';

export interface FillRendererPort {
  beginBrushStroke(layer: LayerNode, channel: PaintChannel): void;
  fillLayerColor(
    layerId: LayerId,
    channel: PaintChannel,
    color: readonly [number, number, number],
    preserveTransparency: boolean,
    opacity?: number
  ): boolean;
  finishPixelEdit(): ReversiblePixelEdit | null;
  cancelPixelEdit(): void;
}

export type FillFailureCode =
  | 'no-active-layer'
  | 'invalid-color'
  | 'invalid-target'
  | 'gpu-target-unavailable'
  | 'undo-snapshot-unavailable'
  | 'renderer-error';

export type FillOperationResult =
  | {
    readonly ok: true;
    readonly document: ImageDocument;
    readonly layerId: LayerId;
    readonly targetLabel: string;
    readonly channel: PaintChannel;
    readonly pixelEdit: ReversiblePixelEdit;
  }
  | {
    readonly ok: false;
    readonly code: FillFailureCode;
    readonly message: string;
  };

export type PreparedFillOperation = {
  readonly document: ImageDocument;
  readonly layer: LayerNode;
  readonly layerId: LayerId;
  readonly targetLabel: string;
  readonly channel: PaintChannel;
  readonly linearColor: readonly [number, number, number];
  readonly preserveTransparency: boolean;
  readonly opacity: number;
};

export type FillPreparationResult =
  | { readonly ok: true; readonly plan: PreparedFillOperation }
  | Extract<FillOperationResult, { readonly ok: false }>;

const fullDocumentBounds = (document: ImageDocument): Rect => ({
  x: 0,
  y: 0,
  width: document.width,
  height: document.height
});

export const srgbHexToLinearRgb = (
  color: string
): [number, number, number] | null => {
  if (!/^#[0-9a-f]{6}$/i.test(color)) return null;
  const channel = (offset: number) => {
    const encoded = Number.parseInt(color.slice(offset, offset + 2), 16) / 255;
    return encoded <= 0.04045
      ? encoded / 12.92
      : ((encoded + 0.055) / 1.055) ** 2.4;
  };
  return [channel(1), channel(3), channel(5)];
};

/**
 * Executes one atomic fill against a document-owned pixel or mask target.
 *
 * Document publication and history ownership stay with the caller. A failed
 * renderer transaction is always cancelled and never returns a partial
 * document revision.
 */
export const prepareFillOperation = (
  document: ImageDocument,
  channel: PaintChannel,
  color: string,
  options: {
    readonly layerId?: LayerId;
    readonly preserveTransparency?: boolean;
    readonly opacity?: number;
  } = {}
): FillPreparationResult => {
  const targetLayerId = options.layerId ?? document.activeLayerId;
  if (!targetLayerId) {
    return {
      ok: false,
      code: 'no-active-layer',
      message: 'Select a layer before filling.'
    };
  }
  const linearColor = srgbHexToLinearRgb(color);
  if (!linearColor) {
    return {
      ok: false,
      code: 'invalid-color',
      message: 'The fill color must be a six-digit hexadecimal color.'
    };
  }
  const layer = channel === 'mask'
    ? findDocumentLayer(document, targetLayerId)
    : findRasterLayer(document, targetLayerId);
  if (!layer || (channel === 'mask' && !('mask' in layer && layer.mask))) {
    return {
      ok: false,
      code: 'invalid-target',
      message: channel === 'mask'
        ? 'Select a layer with an editable mask before filling.'
        : 'Select a raster layer before filling.'
    };
  }
  const opacity = Math.max(0, Math.min(1, options.opacity ?? 1));
  if (layer.locks.all || (channel === 'pixels' && (layer.locks.pixels
    || (opacity === 0 && layer.locks.transparency)))) {
    return {
      ok: false,
      code: 'invalid-target',
      message: channel === 'mask'
        ? 'Unlock the layer before clearing its mask.'
        : 'Unlock pixels and transparency before clearing selected pixels.'
    };
  }

  const preserveTransparency = channel === 'pixels'
    && layer.type === 'raster'
    && (layer.locks.transparency || options.preserveTransparency === true);
  const dirtyBounds = fullDocumentBounds(document);
  return {
    ok: true,
    plan: {
      document: channel === 'mask'
        ? markLayerMaskPixelsChanged(document, layer.id, dirtyBounds)
        : markLayerPixelsChanged(document, layer.id, dirtyBounds),
      layer,
      layerId: layer.id,
      targetLabel: channel === 'mask' ? 'Mask' : layer.name,
      channel,
      linearColor,
      preserveTransparency,
      opacity
    }
  };
};

export const executePreparedFillOperation = (
  renderer: FillRendererPort,
  plan: PreparedFillOperation
): FillOperationResult => {
  let transactionOpen = false;
  try {
    renderer.beginBrushStroke(plan.layer, plan.channel);
    transactionOpen = true;
    if (!renderer.fillLayerColor(
      plan.layerId,
      plan.channel,
      plan.linearColor,
      plan.preserveTransparency,
      plan.opacity
    )) {
      renderer.cancelPixelEdit();
      transactionOpen = false;
      return {
        ok: false,
        code: 'gpu-target-unavailable',
        message: 'The active fill target is not available on the GPU.'
      };
    }
    const pixelEdit = renderer.finishPixelEdit();
    if (!pixelEdit) {
      renderer.cancelPixelEdit();
      transactionOpen = false;
      return {
        ok: false,
        code: 'undo-snapshot-unavailable',
        message: 'The fill operation could not create an undo snapshot.'
      };
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
      code: 'renderer-error',
      message: reason instanceof Error
        ? reason.message
        : 'The active target could not be filled.'
    };
  }
};

export const executeFillOperation = (
  document: ImageDocument,
  renderer: FillRendererPort,
  channel: PaintChannel,
  color: string,
  options: {
    readonly layerId?: LayerId;
    readonly preserveTransparency?: boolean;
    readonly opacity?: number;
  } = {}
): FillOperationResult => {
  const prepared = prepareFillOperation(document, channel, color, options);
  return prepared.ok ? executePreparedFillOperation(renderer, prepared.plan) : prepared;
};
