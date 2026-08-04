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
}

/** Owns one fill command from renderer mutation through reversible history. */
export const createFillCommandController = (
  resolveDependencies: () => FillCommandDependencies
): FillCommandController => ({
  fill: (color, preserveTransparency = false) => {
    const dependencies = resolveDependencies();
    const before = dependencies.getDocument();
    const renderer = dependencies.getRenderer();
    if (!before || !renderer) return false;
    const result = executeFillOperation(
      before,
      renderer,
      dependencies.getChannel(),
      color,
      preserveTransparency
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
    dependencies.setStatus(
      `${result.targetLabel} filled with ${color.toUpperCase()}`
    );
    return true;
  }
});

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
