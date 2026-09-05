import type { Vec2 } from '@lighttable/vector-core';
import type { EditorSession, PaintChannel } from '../../../editor/session/editorSession';
import type { ImageDocument, LayerId } from '../../../editor/document/documentTypes';
import type { ReversiblePixelEdit } from '../../../editor/history/ReversiblePixelEdit';
import {
  constrainedGradientEnd,
  gradientPaintFromDrag
} from '../../vectors/GradientToolController';
import {
  executeGradientOperation,
  type GradientRendererPort
} from './gradientOperation';
import type { SemanticRasterGradientCommand } from '../../commands/semanticRasterGradientCommandContract';
import { commitAppliedPixelMutation } from '../../commands/pixelMutationTransaction';
import type {
  DocumentMutationController,
  DocumentMutationTransaction
} from '../../documents/useDocumentMutationController';

interface GradientHistoryEntry {
  label: string;
  type: string;
  byteSize: number;
  layerIds: readonly LayerId[];
  undo(): void;
  redo(): void;
  dispose(): void;
}

export interface RasterGradientDependencies {
  getDocument(): ImageDocument | null;
  getRenderer(): (GradientRendererPort & {
    applyPixelHistory(edit: ReversiblePixelEdit, direction: 'undo' | 'redo'): boolean;
  }) | null;
  documentMutations: Pick<DocumentMutationController, 'begin'>;
  getChannel(): PaintChannel;
  getSettings(): EditorSession['gradient'];
  applyDocumentSnapshot(document: ImageDocument): void;
  pushHistoryEntry(entry: GradientHistoryEntry): void;
  setStatus(message: string | null): void;
  setError(message: string | null): void;
  onGradientCommitted?(command: SemanticRasterGradientCommand, result: RasterGradientCommandResult): void;
}

export interface RasterGradientCommandResult {
  readonly layerId: LayerId;
  readonly channel: PaintChannel;
}

export class RasterGradientCommandController {
  private gesture: {
    pointerId: number;
    start: Vec2;
    current: Vec2;
    transaction: DocumentMutationTransaction;
  } | null = null;

  constructor(private readonly resolve: () => RasterGradientDependencies) {}

  private applyCommand(
    command: SemanticRasterGradientCommand,
    ownedTransaction?: DocumentMutationTransaction
  ): RasterGradientCommandResult | null {
    const dependencies = this.resolve();
    const renderer = dependencies.getRenderer();
    if (!renderer) {
      ownedTransaction?.cancel();
      return null;
    }
    const transaction = ownedTransaction ?? dependencies.documentMutations.begin(
      'tool.raster-gradient',
      {
        label: command.channel === 'mask' ? 'Gradient on Layer Mask' : 'Gradient Tool',
        type: command.channel === 'mask' ? 'raster.mask.gradient' : 'raster.gradient',
        layerIds: [command.layerId]
      },
      undefined,
      'cancel'
    );
    if (!transaction) return null;
    const before = transaction.before;
    const result = executeGradientOperation(before, renderer, command.channel, command.paint,
      command.opacity, command.blendMode, command.layerId);
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
        commitAppliedPixelMutation(() => this.resolve(), {
          operation: 'Gradient Tool',
          label: result.channel === 'mask' ? 'Gradient on Layer Mask' : 'Gradient Tool',
          type: result.channel === 'mask' ? 'raster.mask.gradient' : 'raster.gradient',
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
        dependencies.setError('The pixel gradient was canceled because the document changed.');
        return null;
      }
    } catch (reason) {
      transaction.cancel();
      dependencies.setError(
        reason instanceof Error ? reason.message : 'The pixel gradient did not complete.'
      );
      return null;
    }
    dependencies.setError(null);
    dependencies.setStatus(`${result.targetLabel} filled with a pixel gradient`);
    return { layerId: result.layerId, channel: result.channel };
  }

  apply(command: SemanticRasterGradientCommand) { return this.applyCommand(command); }

  owns(pointerId: number) { return this.gesture?.pointerId === pointerId; }

  begin(pointerId: number, start: Vec2) {
    if (this.gesture) return false;
    const dependencies = this.resolve();
    if (!dependencies.getDocument() || !dependencies.getRenderer()) return false;
    const transaction = dependencies.documentMutations.begin(
      'tool.raster-gradient',
      undefined,
      (reason) => {
        if (reason !== 'commit' && this.gesture?.transaction === transaction) {
          this.gesture = null;
        }
      },
      'cancel'
    );
    if (!transaction) return false;
    this.gesture = { pointerId, start: { ...start }, current: { ...start }, transaction };
    return true;
  }

  move(pointerId: number, current: Vec2) {
    if (!this.owns(pointerId) || !this.gesture) return false;
    this.gesture.current = { ...current };
    return true;
  }

  finish(pointerId: number, end: Vec2, constrain: boolean) {
    if (!this.owns(pointerId) || !this.gesture) return false;
    const { start, transaction } = this.gesture;
    this.gesture = null;
    if (Math.hypot(end.x - start.x, end.y - start.y) < 1e-4) {
      transaction.cancel();
      return false;
    }
    const dependencies = this.resolve();
    const before = dependencies.getDocument();
    if (!before) {
      transaction.cancel();
      return false;
    }
    const settings = dependencies.getSettings();
    const constrainedEnd = constrainedGradientEnd(start, end, constrain);
    const paint = gradientPaintFromDrag(settings.paint, start, constrainedEnd, settings.transparency);
    if (!before.activeLayerId) {
      transaction.cancel();
      return false;
    }
    const command: SemanticRasterGradientCommand = {
      layerId: before.activeLayerId,
      channel: dependencies.getChannel(),
      paint,
      opacity: settings.opacity,
      blendMode: settings.blendMode
    };
    const result = this.applyCommand(command, transaction);
    if (result) dependencies.onGradientCommitted?.(command, result);
    return Boolean(result);
  }

  cancel(pointerId?: number) {
    if (!this.gesture || (pointerId !== undefined && !this.owns(pointerId))) return false;
    this.gesture.transaction.cancel();
    this.gesture = null;
    return true;
  }
}
