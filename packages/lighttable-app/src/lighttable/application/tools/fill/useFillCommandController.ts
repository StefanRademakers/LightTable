import { useMemo, useRef } from 'react';
import type { ImageDocument, LayerId } from '../../../editor/document/documentTypes';
import type { ReversiblePixelEdit } from '../../../editor/history/ReversiblePixelEdit';
import type { PaintChannel } from '../../../editor/session/editorSession';
import type { SemanticFillCommand } from '../../commands/semanticFillCommandContract';
import { commitAppliedPixelMutation } from '../../commands/pixelMutationTransaction';
import type { DocumentMutationController } from '../../documents/useDocumentMutationController';
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
  documentMutations: Pick<DocumentMutationController, 'begin'>;
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
  const execute = (
    layerId: LayerId | undefined,
    channel: PaintChannel,
    color: string,
    options: { readonly preserveTransparency?: boolean; readonly opacity?: number },
    status: (targetLabel: string) => string,
    history?: { readonly label: string; readonly type: string }
  ) => {
    const dependencies = resolveDependencies();
    const renderer = dependencies.getRenderer();
    if (!renderer) return null;
    const transaction = dependencies.documentMutations.begin(
      'tool.fill',
      {
        label: history?.label ?? (channel === 'mask' ? 'Fill Layer Mask' : options.opacity === 0 ? 'Clear' : 'Fill'),
        type: history?.type ?? (channel === 'mask' ? 'raster.mask.fill' : 'raster.fill'),
        ...(layerId ? { layerIds: [layerId] } : {})
      },
      undefined,
      'cancel'
    );
    if (!transaction) return null;
    const before = transaction.before;
    const result = executeFillOperation(
      before,
      renderer,
      channel,
      color,
      { ...options, layerId }
    );
    if (!result.ok) {
      transaction.cancel();
      dependencies.setError(result.message);
      return null;
    }

    let historyOwnsPixelEdit = false;
    try {
      const staged = transaction.stage(() => result.document);
      const committed = staged && transaction.commitWith((ownedBefore, ownedAfter) => {
        historyOwnsPixelEdit = true;
        commitAppliedPixelMutation(() => resolveDependencies(), {
          operation: 'Fill',
          label: history?.label
            ?? (result.channel === 'mask' ? 'Fill Layer Mask' : options.opacity === 0 ? 'Clear' : 'Fill'),
          type: history?.type ?? (result.channel === 'mask' ? 'raster.mask.fill' : 'raster.fill'),
          layerIds: [result.layerId],
          before: ownedBefore,
          after: ownedAfter,
          edits: [result.pixelEdit]
        });
        return true;
      });
      if (!committed) {
        if (!historyOwnsPixelEdit) {
          renderer.applyPixelHistory(result.pixelEdit, 'undo');
          result.pixelEdit.destroy();
        }
        dependencies.setError('Fill was canceled because the document changed.');
        return null;
      }
    } catch (reason) {
      transaction.cancel();
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
