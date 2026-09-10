import { cloneGradientPaint } from '@lighttable/paint-core';
import type { Vec2 } from '@lighttable/vector-core';
import type { EditorSession, GradientToolSettings, PaintChannel } from '../../../editor/session/editorSession';
import type { ImageDocument, LayerId } from '../../../editor/document/documentTypes';
import type { ReversiblePixelEdit } from '../../../editor/history/ReversiblePixelEdit';
import {
  constrainedGradientEnd,
  gradientPaintFromDrag
} from '../../vectors/GradientToolController';
import {
  executePreparedGradientOperation,
  prepareGradientOperation,
  type GradientRendererPort
} from './gradientOperation';
import type { SemanticRasterGradientCommand } from '../../commands/semanticRasterGradientCommandContract';
import { reserveAppliedPixelMutation } from '../../commands/pixelMutationTransaction';
import type { DocumentHistoryReservation } from '../../commands/documentCommandHistory';
import type {
  DocumentMutationController,
  DocumentMutationTransaction
} from '../../documents/useDocumentMutationController';

export interface GradientHistoryEntry {
  label: string;
  type: string;
  byteSize: number;
  layerIds: readonly LayerId[];
  undo(): void;
  redo(): void;
  dispose(): void;
}

type RasterGradientRenderer = GradientRendererPort & {
  applyPixelHistory(edit: ReversiblePixelEdit, direction: 'undo' | 'redo'): boolean;
};

export interface RasterGradientDependencies {
  getDocument(): ImageDocument | null;
  getRenderer(): RasterGradientRenderer | null;
  documentMutations: Pick<DocumentMutationController, 'begin'>;
  getChannel(): PaintChannel;
  getSettings(): EditorSession['gradient'];
  getSelectionRevision(): number;
  applyDocumentSnapshot(document: ImageDocument): void;
  reserveHistoryEntry(entry: GradientHistoryEntry): DocumentHistoryReservation;
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
    renderer: RasterGradientRenderer;
    documentId: ImageDocument['id'];
    layerId: LayerId;
    channel: PaintChannel;
    settings: GradientToolSettings;
    selectionRevision: number | null;
  } | null = null;

  constructor(private readonly resolve: () => RasterGradientDependencies) {}

  private applyCommand(
    command: SemanticRasterGradientCommand,
    ownedTransaction?: DocumentMutationTransaction,
    openingRenderer?: RasterGradientRenderer
  ): RasterGradientCommandResult | null {
    const dependencies = this.resolve();
    const currentRenderer = dependencies.getRenderer();
    const renderer = openingRenderer ?? currentRenderer;
    if (openingRenderer && currentRenderer !== openingRenderer) {
      ownedTransaction?.cancel();
      dependencies.setError('The document renderer changed during the pixel gradient; the gesture was cancelled.');
      return null;
    }
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
    const prepared = prepareGradientOperation(before, command.channel, command.paint,
      command.opacity, command.blendMode, command.layerId);
    if (!prepared.ok) {
      transaction.cancel();
      dependencies.setError(prepared.message);
      return null;
    }
    try {
      const staged = transaction.stage(() => prepared.plan.document);
      const committed = staged && transaction.commitWith((ownedBefore, ownedAfter) => {
        const label = prepared.plan.channel === 'mask'
          ? 'Gradient on Layer Mask' : 'Gradient Tool';
        const type = prepared.plan.channel === 'mask'
          ? 'raster.mask.gradient' : 'raster.gradient';
        const publication = reserveAppliedPixelMutation(() => this.resolve(), {
          label, type, layerIds: [prepared.plan.layerId]
        });
        const result = executePreparedGradientOperation(renderer, prepared.plan);
        if (!result.ok) {
          publication.cancel();
          throw new Error(result.message);
        }
        publication.commit({
          operation: 'Gradient Tool',
          label,
          type,
          layerIds: [result.layerId],
          before: ownedBefore,
          after: ownedAfter,
          edits: [result.pixelEdit]
        });
        return true;
      });
      if (!committed) {
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
    dependencies.setStatus(`${prepared.plan.targetLabel} filled with a pixel gradient`);
    return { layerId: prepared.plan.layerId, channel: prepared.plan.channel };
  }

  apply(command: SemanticRasterGradientCommand) { return this.applyCommand(command); }

  owns(pointerId: number) { return this.gesture?.pointerId === pointerId; }

  begin(pointerId: number, start: Vec2) {
    if (this.gesture) return false;
    const dependencies = this.resolve();
    const document = dependencies.getDocument();
    const renderer = dependencies.getRenderer();
    const layerId = document?.activeLayerId;
    if (!document || !renderer || !layerId) return false;
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
    const settings = dependencies.getSettings();
    this.gesture = {
      pointerId,
      start: { ...start },
      current: { ...start },
      transaction,
      renderer,
      documentId: document.id,
      layerId,
      channel: dependencies.getChannel(),
      settings: { ...settings, paint: cloneGradientPaint(settings.paint) },
      selectionRevision: dependencies.getSelectionRevision()
    };
    return true;
  }

  move(pointerId: number, current: Vec2) {
    if (!this.owns(pointerId) || !this.gesture) return false;
    this.gesture.current = { ...current };
    return true;
  }

  finish(pointerId: number, end: Vec2, constrain: boolean) {
    if (!this.owns(pointerId) || !this.gesture) return false;
    const {
      start, transaction, renderer, documentId, layerId, channel, settings, selectionRevision
    } = this.gesture;
    this.gesture = null;
    if (Math.hypot(end.x - start.x, end.y - start.y) < 1e-4) {
      transaction.cancel();
      return false;
    }
    const dependencies = this.resolve();
    const currentDocument = dependencies.getDocument();
    if (!currentDocument || currentDocument.id !== documentId
      || dependencies.getRenderer() !== renderer
      || (selectionRevision !== null
        && dependencies.getSelectionRevision() !== selectionRevision)) {
      transaction.cancel();
      if (selectionRevision !== null
        && dependencies.getSelectionRevision() !== selectionRevision) {
        dependencies.setError('The selection changed during the pixel gradient; the gesture was cancelled.');
      }
      return false;
    }
    const constrainedEnd = constrainedGradientEnd(start, end, constrain);
    const paint = gradientPaintFromDrag(settings.paint, start, constrainedEnd, settings.transparency);
    const command: SemanticRasterGradientCommand = {
      layerId,
      channel,
      paint,
      opacity: settings.opacity,
      blendMode: settings.blendMode
    };
    const result = this.applyCommand(command, transaction, renderer);
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
