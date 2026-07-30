import { applyGroupVisibility, type GroupVisibility } from '../adjustments/groupVisibility';
import type { ReferenceDifferenceMetrics } from '../rendering/rendererTypes';
import {
  materializeBasicAdjustments,
  type AdjustmentStack
} from '../../processing/adjustmentStack';
import { cloneAdjustments, type BasicAdjustments } from '../../types';
import type { LoadedDocumentSource } from './loadDocumentSource';

export interface DocumentHydrationRenderer {
  setAdjustmentStack(stack: AdjustmentStack): void;
  setAdjustments(adjustments: BasicAdjustments): void;
  measureReferenceDifference(): Promise<ReferenceDifferenceMetrics>;
}

export interface HydratedDocumentSource {
  readonly adjustments: BasicAdjustments;
  readonly psdDifferenceMetrics: ReferenceDifferenceMetrics | null;
  readonly status: string | null;
  readonly differenceError: unknown | null;
}

export interface HydrateDocumentSourceRequest {
  readonly renderer: DocumentHydrationRenderer;
  readonly loaded: LoadedDocumentSource;
  readonly initialAdjustments: BasicAdjustments;
  readonly groupVisibility: GroupVisibility;
  readonly isCanceled?: () => boolean;
}

/**
 * Applies the renderer-facing part of a loaded document as one application
 * transaction. React presentation state deliberately stays outside this
 * service, so web, Electron and future batch hosts share identical hydration.
 */
export const hydrateDocumentSource = async (
  request: HydrateDocumentSourceRequest
): Promise<HydratedDocumentSource | null> => {
  const isCanceled = request.isCanceled ?? (() => false);
  const { loaded, renderer } = request;
  const adjustments = cloneAdjustments(
    loaded.layeredAdjustmentStack
      ? materializeBasicAdjustments(loaded.layeredAdjustmentStack)
      : request.initialAdjustments
  );

  if (loaded.layeredAdjustmentStack) {
    renderer.setAdjustmentStack(loaded.layeredAdjustmentStack);
  }
  renderer.setAdjustments(applyGroupVisibility(
    adjustments,
    request.groupVisibility
  ));

  if (!loaded.psdImport) {
    return {
      adjustments,
      psdDifferenceMetrics: null,
      status: null,
      differenceError: null
    };
  }

  const inventory = loaded.psdImport.inventory;
  try {
    const metrics = await renderer.measureReferenceDifference();
    if (isCanceled()) return null;
    return {
      adjustments,
      psdDifferenceMetrics: metrics,
      status:
        `PSD reconstruction loaded · ${inventory.layers} layers · `
        + `${metrics.differingPixelPercentage.toFixed(2)}% differs`,
      differenceError: null
    };
  } catch (differenceError) {
    if (isCanceled()) return null;
    return {
      adjustments,
      psdDifferenceMetrics: null,
      status:
        `PSD reconstruction loaded · ${inventory.layers} layers · `
        + `${inventory.layerStyles} styled · ${inventory.adjustments} adjustments`,
      differenceError
    };
  }
};
