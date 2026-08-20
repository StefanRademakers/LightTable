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
import type { TranslationAlignmentResult } from '../../../editor/autoAlign/alignmentTypes';
import type { SemanticAutoAlignCommand } from '../../commands/semanticAutoAlignCommandContract';
import { executeAutoAlignOperation, reuseAutoAlignPreview,
  type AutoAlignRendererPort } from './executeAutoAlignOperation';

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
  execute(command: SemanticAutoAlignCommand, signal: AbortSignal): Promise<unknown>;
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
  const previewSourceRef = useRef<{ readonly documentId: string; readonly revision: number } | null>(null);
  const [preview, setPreviewState] = useState<TranslationAlignmentResult | null>(null);

  const setPreview = useCallback((next: TranslationAlignmentResult | null,
    source: { readonly documentId: string; readonly revision: number } | null = null) => {
    previewRef.current = next;
    previewSourceRef.current = source;
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

  const commit = useCallback((currentPreview: TranslationAlignmentResult, previewReused: boolean) => {
    const before = dependenciesRef.current.getDocument();
    if (!before) throw new Error('The Auto Align document is no longer available.');
    const after = applyTranslationAlignment(before, currentPreview);
    setPreview(null);
    if (after === before) {
      dependenciesRef.current
        .getRenderer()
        ?.clearTranslationAlignmentPreview(currentPreview.targetLayerId);
      dependenciesRef.current.setStatus('Auto Align found no geometry change to apply.');
      return { changed: false, previewReused, referenceLayerId: currentPreview.referenceLayerId,
        targetLayerId: currentPreview.targetLayerId, model: currentPreview.model,
        confidence: currentPreview.confidence, correctionMatrix: currentPreview.correctionMatrix };
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
    return { changed: true, previewReused, referenceLayerId: currentPreview.referenceLayerId,
      targetLayerId: currentPreview.targetLayerId, model: currentPreview.model,
      confidence: currentPreview.confidence, correctionMatrix: currentPreview.correctionMatrix };
  }, [setPreview]);

  const apply = useCallback(() => {
    const currentPreview = previewRef.current;
    if (currentPreview) commit(currentPreview, true);
  }, [commit]);

  const execute = useCallback(async (command: SemanticAutoAlignCommand, signal: AbortSignal) => {
    const document = dependenciesRef.current.getDocument();
    const renderer = dependenciesRef.current.getRenderer();
    if (!document || !renderer) throw new Error('LightTable Auto Align is not initialized.');
    const currentPreview = previewRef.current;
    const previewSource = previewSourceRef.current;
    if (signal.aborted) throw new DOMException('Auto Align was canceled.', 'AbortError');
    const reused = reuseAutoAlignPreview(currentPreview, previewSource, document, command,
      (result) => commit(result, true));
    if (reused.reused) return reused.value;
    abortRef.current?.abort();
    if (currentPreview) renderer.clearTranslationAlignmentPreview(currentPreview.targetLayerId);
    setPreview(null);
    dependenciesRef.current.setStatus('Analyzing layer alignment...');
    dependenciesRef.current.setError(null);
    try {
      return await executeAutoAlignOperation({ document, renderer, command, signal,
        getDocument: dependenciesRef.current.getDocument,
        commit: (result) => commit(result, false) });
    } catch (reason) {
      const canceled = signal.aborted || (reason instanceof DOMException && reason.name === 'AbortError');
      dependenciesRef.current.setStatus(null);
      if (!canceled) dependenciesRef.current.setError(
        reason instanceof Error ? reason.message : 'Auto Align failed.'
      );
      throw canceled && !(reason instanceof DOMException)
        ? new DOMException('Auto Align was canceled.', 'AbortError') : reason;
    }
  }, [commit, setPreview]);

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
      const source = { documentId: document.id, revision: document.revision };
      const result = await renderer.alignLayersTranslation(
        references[0].id,
        target.id,
        {},
        controller.signal
      );
      if (controller.signal.aborted || abortRef.current !== controller) return;
      const current = dependenciesRef.current.getDocument();
      if (!current || current.id !== source.documentId || current.revision !== source.revision) {
        throw new Error('Auto Align preview was discarded because the document changed.');
      }
      if (!renderer.previewTranslationAlignment(result)) {
        throw new Error('The Auto Align preview could not be displayed.');
      }
      setPreview(result, source);
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

  return { preview, begin, apply, cancel, execute };
};
