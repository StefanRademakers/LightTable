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
  private gesture: { pointerId: number; start: Vec2; current: Vec2 } | null = null;

  constructor(private readonly resolve: () => RasterGradientDependencies) {}

  private applyCommand(command: SemanticRasterGradientCommand): RasterGradientCommandResult | null {
    const dependencies = this.resolve();
    const before = dependencies.getDocument();
    const renderer = dependencies.getRenderer();
    if (!before || !renderer) return null;
    const result = executeGradientOperation(before, renderer, command.channel, command.paint,
      command.opacity, command.blendMode, command.layerId);
    if (!result.ok) {
      dependencies.setError(result.message);
      return null;
    }
    dependencies.applyDocumentSnapshot(result.document);
    dependencies.pushHistoryEntry({
      label: result.channel === 'mask' ? 'Gradient on Layer Mask' : 'Gradient Tool',
      type: result.channel === 'mask' ? 'raster.mask.gradient' : 'raster.gradient',
      byteSize: result.pixelEdit.byteSize,
      layerIds: [result.layerId],
      undo: () => {
        const latest = this.resolve();
        if (!latest.getRenderer()?.applyPixelHistory(result.pixelEdit, 'undo')) {
          throw new Error('Pixel-gradient undo is no longer available.');
        }
        latest.applyDocumentSnapshot(before);
      },
      redo: () => {
        const latest = this.resolve();
        if (!latest.getRenderer()?.applyPixelHistory(result.pixelEdit, 'redo')) {
          throw new Error('Pixel-gradient redo is no longer available.');
        }
        latest.applyDocumentSnapshot(result.document);
      },
      dispose: result.pixelEdit.destroy
    });
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
    this.gesture = { pointerId, start: { ...start }, current: { ...start } };
    return true;
  }

  move(pointerId: number, current: Vec2) {
    if (!this.owns(pointerId) || !this.gesture) return false;
    this.gesture.current = { ...current };
    return true;
  }

  finish(pointerId: number, end: Vec2, constrain: boolean) {
    if (!this.owns(pointerId) || !this.gesture) return false;
    const start = this.gesture.start;
    this.gesture = null;
    if (Math.hypot(end.x - start.x, end.y - start.y) < 1e-4) return false;
    const dependencies = this.resolve();
    const before = dependencies.getDocument();
    if (!before) return false;
    const settings = dependencies.getSettings();
    const constrainedEnd = constrainedGradientEnd(start, end, constrain);
    const paint = gradientPaintFromDrag(settings.paint, start, constrainedEnd, settings.transparency);
    if (!before.activeLayerId) return false;
    const command: SemanticRasterGradientCommand = {
      layerId: before.activeLayerId,
      channel: dependencies.getChannel(),
      paint,
      opacity: settings.opacity,
      blendMode: settings.blendMode
    };
    const result = this.applyCommand(command);
    if (result) dependencies.onGradientCommitted?.(command, result);
    return Boolean(result);
  }

  cancel(pointerId?: number) {
    if (!this.gesture || (pointerId !== undefined && !this.owns(pointerId))) return false;
    this.gesture = null;
    return true;
  }
}
