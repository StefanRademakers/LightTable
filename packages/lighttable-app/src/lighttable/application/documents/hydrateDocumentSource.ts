import type { GroupVisibility } from '../adjustments/groupVisibility';
import type { ReferenceDifferenceMetrics } from '../rendering/rendererTypes';
import type { AdjustmentStack } from '../../processing/adjustmentStack';
import { createDefaultAdjustments, type BasicAdjustments } from '../../types';
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
  // Creative processing is owned by visible document layers. Flat-import
  // recipes have already been attached to their raster by loadDocumentSource;
  // replaying them here would apply the grade a second time. Keep the legacy
  // document-final renderer neutral until that technical route is removed.
  const adjustments = createDefaultAdjustments();
  renderer.setAdjustments(adjustments);

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
