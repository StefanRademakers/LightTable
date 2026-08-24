import { useCallback, useRef } from 'react';
import type { ImageDocument, LayerId } from '../../editor/document/documentTypes';
import { findDocumentLayer } from '../../editor/document/layerTree';
import {
  setGaussianBlurLayerEnabled,
  setGaussianBlurLayerRadius
} from '../../editor/document/documentCommands';
import {
  DEFAULT_GAUSSIAN_BLUR_RADIUS,
  gaussianBlurModule,
  gaussianBlurSettings
} from '../../processing/gaussianBlurFilter';

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
  readonly getDocument: () => ImageDocument | null;
  readonly applyDocument: (document: ImageDocument) => void;
  readonly recordHistory: (before: ImageDocument, after: ImageDocument) => void;
}

/**
 * Bridges the context-sensitive Properties panel to canonical filter data.
 * Preview updates are live, while one pointer gesture produces one undo item.
 */
export const useGaussianBlurFilterController = ({
  document,
  getDocument,
  applyDocument,
  recordHistory
}: Dependencies): {
  readonly model: GaussianBlurFilterPresentation | null;
  readonly commands: GaussianBlurFilterCommands;
} => {
  const transaction = useRef<{
    readonly before: ImageDocument;
    lastApplied: ImageDocument;
  } | null>(null);
  const active = document
    ? findDocumentLayer(document, document.activeLayerId)
    : null;
  const settings = active?.type === 'adjustment' && active.adjustmentKind === 'gaussian-blur'
    ? gaussianBlurSettings(active.adjustmentStack)
    : null;
  const module = active?.type === 'adjustment' && active.adjustmentKind === 'gaussian-blur'
    ? gaussianBlurModule(active.adjustmentStack)
    : null;

  const beginAdjustment = useCallback(() => {
    const current = getDocument();
    if (current) transaction.current ??= { before: current, lastApplied: current };
  }, [getDocument]);

  const updateRadius = useCallback((radius: number) => {
    const current = getDocument();
    if (!current?.activeLayerId) return;
    transaction.current ??= { before: current, lastApplied: current };
    const next = setGaussianBlurLayerRadius(current, current.activeLayerId, radius);
    if (next !== current) {
      transaction.current.lastApplied = next;
      applyDocument(next);
    }
  }, [applyDocument, getDocument]);

  const endAdjustment = useCallback(() => {
    const completed = transaction.current;
    transaction.current = null;
    if (completed && completed.before !== completed.lastApplied) {
      recordHistory(completed.before, completed.lastApplied);
    }
  }, [recordHistory]);

  const commitAtomic = useCallback((
    mutate: (source: ImageDocument, id: LayerId) => ImageDocument
  ) => {
    const current = getDocument();
    if (!current?.activeLayerId) return;
    const next = mutate(current, current.activeLayerId);
    if (next === current) return;
    applyDocument(next);
    recordHistory(current, next);
  }, [applyDocument, getDocument, recordHistory]);

  return {
    model: settings && module ? { radius: settings.radius, enabled: module.enabled } : null,
    commands: {
      beginAdjustment,
      endAdjustment,
      updateRadius,
      reset: () => commitAtomic((source, id) =>
        setGaussianBlurLayerRadius(source, id, DEFAULT_GAUSSIAN_BLUR_RADIUS)),
      toggleEnabled: () => commitAtomic((source, id) =>
        setGaussianBlurLayerEnabled(source, id, !module?.enabled))
    }
  };
};
