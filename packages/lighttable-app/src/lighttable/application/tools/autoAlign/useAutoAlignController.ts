import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ImageDocument,
  LayerId
} from '../../../editor/document/documentTypes';
import {
  findRasterLayer,
  walkRasterLayers
} from '../../../editor/document/layerTree';
import { applyTranslationAlignment } from '../../../editor/document/documentCommands';
import type {
  TranslationAlignmentOptions,
  TranslationAlignmentResult
} from '../../../editor/autoAlign/alignmentTypes';

export interface AutoAlignRendererPort {
  alignLayersTranslation(
    referenceLayerId: LayerId,
    targetLayerId: LayerId,
    options?: Partial<TranslationAlignmentOptions>,
    signal?: AbortSignal
  ): Promise<TranslationAlignmentResult>;
  previewTranslationAlignment(result: TranslationAlignmentResult): boolean;
  clearTranslationAlignmentPreview(targetLayerId?: LayerId): boolean;
}

export interface AutoAlignControllerDependencies {
  getDocument(): ImageDocument | null;
  getRenderer(): AutoAlignRendererPort | null;
  applyDocumentSnapshot(document: ImageDocument): void;
  pushDocumentHistory(before: ImageDocument, after: ImageDocument): void;
  setStatus(status: string | null): void;
  setError(error: string | null): void;
}

export interface AutoAlignController {
  preview: TranslationAlignmentResult | null;
  begin(): Promise<void>;
  apply(): void;
  cancel(): void;
}

export const formatAutoAlignPreviewStatus = (
  result: TranslationAlignmentResult
): string => {
  const model = result.model === 'similarity' ? 'scale / rotate / move' : 'move';
  const estimate = result.diagnostics;
  const scale = estimate.estimatedScale != null
    ? ` · ${(100 / estimate.estimatedScale).toFixed(1)}% correction`
    : '';
  const rotation = estimate.estimatedRotationDegrees != null
    && Math.abs(estimate.estimatedRotationDegrees) >= 0.05
    ? ` · ${(-estimate.estimatedRotationDegrees).toFixed(2)}° correction`
    : '';
  const evidence = estimate.inlierCount != null && estimate.mutualMatches != null
    ? ` · ${estimate.inlierCount}/${estimate.mutualMatches} inliers`
    : ` · ${Math.round(result.confidence * 100)}% confidence`;
  const coverage = estimate.coverageCells != null
    ? ` · ${estimate.coverageCells}/16 regions`
    : '';
  const residual = estimate.medianResidual != null
    ? ` · ${estimate.medianResidual.toFixed(2)} px residual`
    : '';
  return `Auto Align ${model} preview${evidence}${coverage}${residual}${scale}${rotation}`;
};

/**
 * Owns the complete preview transaction for Auto Align.
 *
 * The renderer preview is deliberately separate from the document snapshot:
 * apply commits one geometry command before clearing the preview, while cancel
 * removes only the transient renderer state. Every dependency is resolved at
 * call time so switching the active document cannot mutate a stale session.
 */
export const useAutoAlignController = (
  dependencies: AutoAlignControllerDependencies
): AutoAlignController => {
  const dependenciesRef = useRef(dependencies);
  dependenciesRef.current = dependencies;
  const abortRef = useRef<AbortController | null>(null);
  const previewRef = useRef<TranslationAlignmentResult | null>(null);
  const [preview, setPreviewState] = useState<TranslationAlignmentResult | null>(null);

  const setPreview = useCallback((next: TranslationAlignmentResult | null) => {
    previewRef.current = next;
    setPreviewState(next);
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    const currentPreview = previewRef.current;
    if (currentPreview) {
      dependenciesRef.current
        .getRenderer()
        ?.clearTranslationAlignmentPreview(currentPreview.targetLayerId);
    }
    setPreview(null);
    dependenciesRef.current.setStatus(null);
  }, [setPreview]);

  const apply = useCallback(() => {
    const currentPreview = previewRef.current;
    const before = dependenciesRef.current.getDocument();
    if (!before || !currentPreview) return;
    const after = applyTranslationAlignment(before, currentPreview);
    setPreview(null);
    if (after === before) {
      dependenciesRef.current
        .getRenderer()
        ?.clearTranslationAlignmentPreview(currentPreview.targetLayerId);
      dependenciesRef.current.setStatus('Auto Align found no geometry change to apply.');
      return;
    }

    // Commit before clearing the compositor preview so no intermediate frame
    // renders the old geometry.
    dependenciesRef.current.applyDocumentSnapshot(after);
    dependenciesRef.current
      .getRenderer()
      ?.clearTranslationAlignmentPreview(currentPreview.targetLayerId);
    dependenciesRef.current.pushDocumentHistory(before, after);
    const { inlierCount, mutualMatches } = currentPreview.diagnostics;
    dependenciesRef.current.setStatus(
      inlierCount != null && mutualMatches != null
        ? `Auto Align applied to layer · ${inlierCount}/${mutualMatches} geometric inliers`
        : `Auto Align applied to layer · ${Math.round(currentPreview.confidence * 100)}% confidence`
    );
  }, [setPreview]);

  const begin = useCallback(async () => {
    const document = dependenciesRef.current.getDocument();
    const renderer = dependenciesRef.current.getRenderer();
    const target = document ? findRasterLayer(document, document.activeLayerId) : null;
    const references = document
      ? walkRasterLayers(document.layers)
        .map(({ layer }) => layer)
        .filter((layer) => layer.id !== target?.id && layer.visible && layer.locks.all)
      : [];
    if (!document || !renderer || !target || references.length !== 1) {
      dependenciesRef.current.setError(
        'Auto Align needs one active target layer and exactly one other visible locked reference layer.'
      );
      return;
    }

    abortRef.current?.abort();
    const currentPreview = previewRef.current;
    if (currentPreview) {
      renderer.clearTranslationAlignmentPreview(currentPreview.targetLayerId);
    }
    setPreview(null);
    const controller = new AbortController();
    abortRef.current = controller;
    dependenciesRef.current.setStatus('Analyzing layer alignment...');
    dependenciesRef.current.setError(null);
    try {
      const result = await renderer.alignLayersTranslation(
        references[0].id,
        target.id,
        {},
        controller.signal
      );
      if (controller.signal.aborted || abortRef.current !== controller) return;
      if (!renderer.previewTranslationAlignment(result)) {
        throw new Error('The Auto Align preview could not be displayed.');
      }
      setPreview(result);
      dependenciesRef.current.setStatus(formatAutoAlignPreviewStatus(result));
    } catch (reason) {
      if (!controller.signal.aborted) {
        dependenciesRef.current.setStatus(null);
        dependenciesRef.current.setError(
          reason instanceof Error ? reason.message : 'Auto Align failed.'
        );
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [setPreview]);

  useEffect(() => () => {
    abortRef.current?.abort();
    const currentPreview = previewRef.current;
    if (currentPreview) {
      dependenciesRef.current
        .getRenderer()
        ?.clearTranslationAlignmentPreview(currentPreview.targetLayerId);
    }
  }, []);

  return { preview, begin, apply, cancel };
};
