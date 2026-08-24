import { useCallback, useRef } from 'react';
import type { ImageDocument, LayerId } from '../../editor/document/documentTypes';
import { findDocumentLayer } from '../../editor/document/layerTree';
import {
  setRasterLayerAttachedAdjustmentEnabled,
  setRasterLayerAttachedAdjustmentStack,
  setGaussianBlurLayerEnabled,
  setGaussianBlurLayerRadius
} from '../../editor/document/documentCommands';
import {
  DEFAULT_GAUSSIAN_BLUR_RADIUS,
  gaussianBlurModule,
  gaussianBlurSettings,
  setGaussianBlurRadius
} from '../../processing/gaussianBlurFilter';
import type { PropertiesInspectorTarget } from '../properties/propertiesInspectorTarget';

export interface GaussianBlurFilterPresentation {
  readonly radius: number;
  readonly enabled: boolean;
}

export interface GaussianBlurFilterCommands {
  readonly beginAdjustment: () => void;
  readonly endAdjustment: () => void;
  readonly updateRadius: (radius: number) => void;
  readonly reset: () => void;
  readonly toggleEnabled: () => void;
}

interface Dependencies {
  readonly document: ImageDocument | null;
  readonly target: PropertiesInspectorTarget;
  readonly getDocument: () => ImageDocument | null;
  readonly applyDocument: (document: ImageDocument) => void;
  readonly recordHistory: (before: ImageDocument, after: ImageDocument) => void;
}

type GaussianBlurTarget =
  | { readonly placement: 'adjustment-layer'; readonly layerId: LayerId }
  | { readonly placement: 'attached'; readonly layerId: LayerId; readonly adjustmentId: string };

const resolveGaussianBlurTarget = (
  document: ImageDocument | null,
  inspectorTarget: PropertiesInspectorTarget
): { readonly target: GaussianBlurTarget; readonly radius: number; readonly enabled: boolean } | null => {
  if (!document) return null;
  if (inspectorTarget.kind === 'attached-processing') {
    const layer = findDocumentLayer(document, inspectorTarget.layerId);
    const adjustment = layer?.type === 'raster'
      ? (layer.attachedAdjustments ?? []).find(({ id }) => id === inspectorTarget.adjustmentId)
      : null;
    const module = adjustment?.adjustmentKind === 'gaussian-blur'
      ? gaussianBlurModule(adjustment.adjustmentStack)
      : null;
    const settings = adjustment ? gaussianBlurSettings(adjustment.adjustmentStack) : null;
    return adjustment && module && settings
      ? {
          target: { placement: 'attached', layerId: layer!.id, adjustmentId: adjustment.id },
          radius: settings.radius,
          enabled: adjustment.enabled
        }
      : null;
  }
  const layer = findDocumentLayer(document, document.activeLayerId);
  const module = layer?.type === 'adjustment' && layer.adjustmentKind === 'gaussian-blur'
    ? gaussianBlurModule(layer.adjustmentStack)
    : null;
  const settings = layer?.type === 'adjustment' && layer.adjustmentKind === 'gaussian-blur'
    ? gaussianBlurSettings(layer.adjustmentStack)
    : null;
  return layer?.type === 'adjustment' && module && settings
    ? {
        target: { placement: 'adjustment-layer', layerId: layer.id },
        radius: settings.radius,
        enabled: module.enabled
      }
    : null;
};

const targetKey = (target: GaussianBlurTarget): string => target.placement === 'attached'
  ? `${target.layerId}::${target.adjustmentId}`
  : target.layerId;

const setTargetRadius = (document: ImageDocument, target: GaussianBlurTarget, radius: number) => {
  if (target.placement === 'adjustment-layer') {
    return setGaussianBlurLayerRadius(document, target.layerId, radius);
  }
  const layer = findDocumentLayer(document, target.layerId);
  const adjustment = layer?.type === 'raster'
    ? (layer.attachedAdjustments ?? []).find(({ id }) => id === target.adjustmentId)
    : null;
  if (!adjustment || adjustment.adjustmentKind !== 'gaussian-blur') return document;
  const adjustmentStack = setGaussianBlurRadius(adjustment.adjustmentStack, radius);
  return adjustmentStack === adjustment.adjustmentStack
    ? document
    : setRasterLayerAttachedAdjustmentStack(
        document, target.layerId, target.adjustmentId, adjustmentStack
      );
};

const setTargetEnabled = (document: ImageDocument, target: GaussianBlurTarget, enabled: boolean) =>
  target.placement === 'adjustment-layer'
    ? setGaussianBlurLayerEnabled(document, target.layerId, enabled)
    : setRasterLayerAttachedAdjustmentEnabled(
        document, target.layerId, target.adjustmentId, enabled
      );

/**
 * Bridges the context-sensitive Properties panel to canonical filter data.
 * Preview updates are live, while one pointer gesture produces one undo item.
 */
export const useGaussianBlurFilterController = ({
  document,
  target,
  getDocument,
  applyDocument,
  recordHistory
}: Dependencies): {
  readonly model: GaussianBlurFilterPresentation | null;
  readonly commands: GaussianBlurFilterCommands;
} => {
  const transaction = useRef<{
    readonly before: ImageDocument;
    readonly target: GaussianBlurTarget;
    lastApplied: ImageDocument;
  } | null>(null);
  const resolved = resolveGaussianBlurTarget(document, target);

  const finishTransaction = useCallback(() => {
    const completed = transaction.current;
    transaction.current = null;
    if (completed && completed.before !== completed.lastApplied) {
      recordHistory(completed.before, completed.lastApplied);
    }
  }, [recordHistory]);

  const beginAdjustment = useCallback(() => {
    const current = getDocument();
    if (!current || !resolved) return;
    if (transaction.current
      && targetKey(transaction.current.target) !== targetKey(resolved.target)) {
      finishTransaction();
    }
    transaction.current ??= { before: current, target: resolved.target, lastApplied: current };
  }, [finishTransaction, getDocument, resolved]);

  const updateRadius = useCallback((radius: number) => {
    const current = getDocument();
    if (!current || !resolved) return;
    if (transaction.current
      && targetKey(transaction.current.target) !== targetKey(resolved.target)) {
      finishTransaction();
    }
    transaction.current ??= { before: current, target: resolved.target, lastApplied: current };
    const next = setTargetRadius(current, resolved.target, radius);
    if (next !== current) {
      transaction.current.lastApplied = next;
      applyDocument(next);
    }
  }, [applyDocument, finishTransaction, getDocument, resolved]);

  const endAdjustment = useCallback(() => {
    finishTransaction();
  }, [finishTransaction]);

  const commitAtomic = useCallback((
    mutate: (source: ImageDocument, target: GaussianBlurTarget) => ImageDocument
  ) => {
    const current = getDocument();
    if (!current || !resolved) return;
    finishTransaction();
    const next = mutate(current, resolved.target);
    if (next === current) return;
    applyDocument(next);
    recordHistory(current, next);
  }, [applyDocument, finishTransaction, getDocument, recordHistory, resolved]);

  return {
    model: resolved ? { radius: resolved.radius, enabled: resolved.enabled } : null,
    commands: {
      beginAdjustment,
      endAdjustment,
      updateRadius,
      reset: () => commitAtomic((source, target) =>
        setTargetRadius(source, target, DEFAULT_GAUSSIAN_BLUR_RADIUS)),
      toggleEnabled: () => commitAtomic((source, target) =>
        setTargetEnabled(source, target, !resolved?.enabled))
    }
  };
};
