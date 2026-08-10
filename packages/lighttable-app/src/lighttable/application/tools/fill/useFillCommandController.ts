import { useMemo, useRef } from 'react';
import type { ImageDocument, LayerId } from '../../../editor/document/documentTypes';
import type { ReversiblePixelEdit } from '../../../editor/history/ReversiblePixelEdit';
import type { PaintChannel } from '../../../editor/session/editorSession';
import {
  executeFillOperation,
  type FillRendererPort
} from './fillOperation';

export interface FillHistoryEntry {
  byteSize: number;
  layerIds: readonly LayerId[];
  undo(): void;
  redo(): void;
  dispose(): void;
}

export interface FillCommandDependencies {
  getDocument(): ImageDocument | null;
  getRenderer(): (FillRendererPort & {
    applyPixelHistory(
      edit: ReversiblePixelEdit,
      direction: 'undo' | 'redo'
    ): boolean;
  }) | null;
  getChannel(): PaintChannel;
  applyDocumentSnapshot(document: ImageDocument): void;
  pushHistoryEntry(entry: FillHistoryEntry): void;
  setStatus(message: string | null): void;
  setError(message: string | null): void;
}

export interface FillCommandController {
  fill(color: string, preserveTransparency?: boolean): boolean;
  clearSelection(): boolean;
}

/** Owns one fill command from renderer mutation through reversible history. */
export const createFillCommandController = (
  resolveDependencies: () => FillCommandDependencies
): FillCommandController => {
  const execute = (
    color: string,
    options: { readonly preserveTransparency?: boolean; readonly opacity?: number },
    status: (targetLabel: string) => string
  ) => {
    const dependencies = resolveDependencies();
    const before = dependencies.getDocument();
    const renderer = dependencies.getRenderer();
    if (!before || !renderer) return false;
    const result = executeFillOperation(
      before,
      renderer,
      dependencies.getChannel(),
      color,
      options
    );
    if (!result.ok) {
      dependencies.setError(result.message);
      return false;
    }

    dependencies.applyDocumentSnapshot(result.document);
    dependencies.pushHistoryEntry({
      byteSize: result.pixelEdit.byteSize,
      layerIds: [result.layerId],
      undo: () => {
        const latest = resolveDependencies();
        if (!latest.getRenderer()?.applyPixelHistory(result.pixelEdit, 'undo')) {
          throw new Error('Fill undo is no longer available.');
        }
        latest.applyDocumentSnapshot(before);
      },
      redo: () => {
        const latest = resolveDependencies();
        if (!latest.getRenderer()?.applyPixelHistory(result.pixelEdit, 'redo')) {
          throw new Error('Fill redo is no longer available.');
        }
        latest.applyDocumentSnapshot(result.document);
      },
      dispose: result.pixelEdit.destroy
    });
    dependencies.setError(null);
    dependencies.setStatus(status(result.targetLabel));
    return true;
  };
  return {
    fill: (color, preserveTransparency = false) => execute(
      color,
      { preserveTransparency },
      (targetLabel) => `${targetLabel} filled with ${color.toUpperCase()}`
    ),
    clearSelection: () => execute(
      '#000000',
      { opacity: 0 },
      (targetLabel) => `${targetLabel} selection cleared`
    )
  };
};

export const useFillCommandController = (
  dependencies: FillCommandDependencies
): FillCommandController => {
  const dependenciesRef = useRef(dependencies);
  dependenciesRef.current = dependencies;
  return useMemo(
    () => createFillCommandController(() => dependenciesRef.current),
    []
  );
};
