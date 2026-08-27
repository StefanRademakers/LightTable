import { useMemo, useRef } from 'react';
import type { ImageDocument, LayerId } from '../../../editor/document/documentTypes';
import type { ReversiblePixelEdit } from '../../../editor/history/ReversiblePixelEdit';
import type { PaintChannel } from '../../../editor/session/editorSession';
import type { SemanticFillCommand } from '../../commands/semanticFillCommandContract';
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

    dependencies.applyDocumentSnapshot(result.document);
    dependencies.pushHistoryEntry({
      label: history?.label
        ?? (result.channel === 'mask' ? 'Fill Layer Mask' : options.opacity === 0 ? 'Clear' : 'Fill'),
      type: history?.type ?? (result.channel === 'mask' ? 'raster.mask.fill' : 'raster.fill'),
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
