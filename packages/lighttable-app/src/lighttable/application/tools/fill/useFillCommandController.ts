import { useMemo, useRef } from 'react';
import type { ImageDocument, LayerId } from '../../../editor/document/documentTypes';
import type { ReversiblePixelEdit } from '../../../editor/history/ReversiblePixelEdit';
import type { PaintChannel } from '../../../editor/session/editorSession';
import type { SemanticFillCommand } from '../../commands/semanticFillCommandContract';
import { runEditorOperationTransaction } from '../../commands/editorOperationTransaction';
import {
  executeFillOperation,
  type FillRendererPort
} from './fillOperation';

export interface FillHistoryEntry {
  readonly label: string;
  readonly type: string;
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
  onFillCommitted?(command: SemanticFillCommand, result: FillCommandResult): void;
}

export interface FillCommandResult {
  readonly layerId: LayerId;
  readonly channel: PaintChannel;
}

export interface FillCommandController {
  fill(color: string, preserveTransparency?: boolean): boolean;
  clearSelection(): boolean;
  apply(command: SemanticFillCommand, history?: {
    readonly label: string;
    readonly type: string;
  }): FillCommandResult | null;
}

/** Owns one fill command from renderer mutation through reversible history. */
export const createFillCommandController = (
  resolveDependencies: () => FillCommandDependencies
): FillCommandController => {
  const applyHistoryDirection = (
    pixelEdit: ReversiblePixelEdit,
    direction: 'undo' | 'redo',
    document: ImageDocument,
    rollbackDocument: ImageDocument
  ) => {
    const dependencies = resolveDependencies();
    const renderer = dependencies.getRenderer();
    if (!renderer) throw new Error(`Fill ${direction} is no longer available.`);
    let gpuChanged = false;
    runEditorOperationTransaction({ operation: `Fill ${direction}` }, (transaction) => {
      transaction.step('GPU pixel state', () => {
        gpuChanged = renderer.applyPixelHistory(pixelEdit, direction);
        if (!gpuChanged) throw new Error(`Fill ${direction} is no longer available.`);
      }, () => {
        if (!gpuChanged) return;
        const compensation = direction === 'undo' ? 'redo' : 'undo';
        if (!renderer.applyPixelHistory(pixelEdit, compensation)) {
          throw new Error(`Fill ${direction} GPU compensation failed.`);
        }
      });
      transaction.step(
        'canonical document state',
        () => dependencies.applyDocumentSnapshot(document),
        () => dependencies.applyDocumentSnapshot(rollbackDocument)
      );
    });
  };

  const execute = (
    layerId: LayerId | undefined,
    channel: PaintChannel,
    color: string,
    options: { readonly preserveTransparency?: boolean; readonly opacity?: number },
    status: (targetLabel: string) => string,
    history?: { readonly label: string; readonly type: string }
  ) => {
    const dependencies = resolveDependencies();
    const before = dependencies.getDocument();
    const renderer = dependencies.getRenderer();
    if (!before || !renderer) return null;
    const result = executeFillOperation(
      before,
      renderer,
      channel,
      color,
      { ...options, layerId }
    );
    if (!result.ok) {
      dependencies.setError(result.message);
      return null;
    }

    const historyEntry: FillHistoryEntry = {
      label: history?.label
        ?? (result.channel === 'mask' ? 'Fill Layer Mask' : options.opacity === 0 ? 'Clear' : 'Fill'),
      type: history?.type ?? (result.channel === 'mask' ? 'raster.mask.fill' : 'raster.fill'),
      byteSize: result.pixelEdit.byteSize,
      layerIds: [result.layerId],
      undo: () => applyHistoryDirection(result.pixelEdit, 'undo', before, result.document),
      redo: () => applyHistoryDirection(result.pixelEdit, 'redo', result.document, before),
      dispose: result.pixelEdit.destroy
    };
    try {
      runEditorOperationTransaction({ operation: 'Fill commit' }, (transaction) => {
        transaction.adopt('GPU pixel state', () => {
          if (!renderer.applyPixelHistory(result.pixelEdit, 'undo')) {
            throw new Error('Fill GPU rollback is no longer available.');
          }
          result.pixelEdit.destroy();
        });
        transaction.step(
          'canonical document state',
          () => dependencies.applyDocumentSnapshot(result.document),
          () => dependencies.applyDocumentSnapshot(before)
        );
        // This is deliberately last. DocumentCommandHistory guarantees that
        // observer and cleanup failures do not escape after a command is owned.
        dependencies.pushHistoryEntry(historyEntry);
      });
    } catch (reason) {
      dependencies.setError(
        reason instanceof Error ? reason.message : 'Fill did not complete.'
      );
      return null;
    }
    dependencies.setError(null);
    dependencies.setStatus(status(result.targetLabel));
    return { layerId: result.layerId, channel: result.channel };
  };
  const executeUi = (color: string, preserveTransparency: boolean, opacity = 1) => {
    const dependencies = resolveDependencies();
    const document = dependencies.getDocument();
    const layerId = document?.activeLayerId ?? undefined;
    const channel = dependencies.getChannel();
    const result = execute(layerId, channel, color, { preserveTransparency, opacity },
      (targetLabel) => opacity === 0
        ? `${targetLabel} selection cleared`
        : `${targetLabel} filled with ${color.toUpperCase()}`);
    if (result && layerId) dependencies.onFillCommitted?.({
      layerId, channel, color, preserveTransparency, opacity
    }, result);
    return Boolean(result);
  };
  return {
    fill: (color, preserveTransparency = false) => executeUi(color, preserveTransparency),
    clearSelection: () => executeUi('#000000', false, 0),
    apply: (command, history) => execute(command.layerId, command.channel, command.color, {
      preserveTransparency: command.preserveTransparency,
      opacity: command.opacity
    }, (targetLabel) => `${targetLabel} filled through command`, history)
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
