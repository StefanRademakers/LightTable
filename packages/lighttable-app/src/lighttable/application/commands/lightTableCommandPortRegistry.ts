import type { DocumentSessionId, DocumentViewport } from '../documents/documentSession';
import type { LayerId } from '../../editor/document/documentTypes';
import type { LayerStyleId } from '../../editor/styles/layerStyleTypes';
import type { BasicAdjustmentTarget } from './semanticBasicAdjustmentCommandContract';
import type { AdjustmentQueryTarget } from '../adjustments/adjustmentQuery';
import type { SemanticBasicAdjustmentCommand } from './semanticBasicAdjustmentCommandContract';
import type { SemanticDetailAdjustmentCommand } from './semanticDetailAdjustmentCommandContract';
import type { SemanticFaceWarpCommand } from './semanticFaceWarpCommandContract';
import type { SemanticFillCommand } from './semanticFillCommandContract';
import type { SemanticLayerCommand } from './semanticLayerCommandContract';
import type { SemanticLayerStyleCommand } from './semanticLayerStyleCommandContract';
import type { SemanticRasterGradientCommand } from './semanticRasterGradientCommandContract';
import type { SemanticSelectionCommand } from './semanticSelectionCommandContract';
import type { SemanticSubjectSelectionCommand } from './semanticSubjectSelectionCommandContract';
import type { SemanticTextCommand } from './semanticTextCommandContract';
import type { SemanticVectorCommand } from './semanticVectorCommandContract';
import type { SemanticSvgImportCommand } from '../vectors/svgDocumentCodec';
import type { SemanticWarpStrokeCommand } from './semanticWarpCommandContract';
import type {
  SemanticCopyPixelsCommand, SemanticPastePixelsCommand
} from './semanticPixelClipboardCommandContract';
import type { AtomicCommandBatch } from './atomicCommandBatchContract';
import type {
  DocumentLightTableCommandPorts,
  LightTableArtifactPlacement,
  LightTableCommandPorts,
  LightTableGestureKind,
  LightTableGestureSample
} from './lightTableCommandContract';

/** Resolves transport-neutral commands to the mounted owner of one document. */
export class LightTableCommandPortRegistry implements LightTableCommandPorts {
  private readonly documents = new Map<DocumentSessionId, DocumentLightTableCommandPorts>();

  constructor(
    private readonly resolveCanonical?: (
      documentId: DocumentSessionId
    ) => DocumentLightTableCommandPorts | null
  ) {}

  register(documentId: DocumentSessionId, ports: DocumentLightTableCommandPorts): () => void {
    this.documents.set(documentId, ports);
    return () => {
      if (this.documents.get(documentId) === ports) this.documents.delete(documentId);
    };
  }

  has(documentId: DocumentSessionId): boolean { return this.documents.has(documentId); }
  setZoom(documentId: DocumentSessionId, viewport: DocumentViewport) {
    return this.resolve(documentId).setZoom(viewport);
  }
  resizeImage(documentId: DocumentSessionId, request: Parameters<NonNullable<DocumentLightTableCommandPorts['resizeImage']>>[0]) {
    const execute = this.resolve(documentId).resizeImage;
    if (!execute) throw new Error('Image Size is unavailable in the target document.');
    return execute(request);
  }
  applyDocumentGeometry(documentId: DocumentSessionId, request: Parameters<NonNullable<DocumentLightTableCommandPorts['applyDocumentGeometry']>>[0]) {
    const execute = this.resolve(documentId).applyDocumentGeometry;
    if (!execute) throw new Error('Document geometry is unavailable in the target document.');
    return execute(request);
  }
  assignDocumentProfile(documentId: DocumentSessionId,
    command: Parameters<NonNullable<DocumentLightTableCommandPorts['assignDocumentProfile']>>[0]) {
    const execute = this.resolve(documentId).assignDocumentProfile;
    if (!execute) throw new Error('Assign Profile is unavailable in the target document.');
    return execute(command);
  }
  createRasterLayer(documentId: DocumentSessionId) {
    return this.resolve(documentId).createRasterLayer();
  }
  copyPixels(documentId: DocumentSessionId, command: SemanticCopyPixelsCommand) {
    const execute = this.resolve(documentId).copyPixels;
    if (!execute) throw new Error('Pixel copy is unavailable in the target document.');
    return execute(command.source);
  }
  pastePixels(documentId: DocumentSessionId, file: File, command: SemanticPastePixelsCommand,
    fastPasteToken?: string) {
    const execute = this.resolve(documentId).pastePixels;
    if (!execute) throw new Error('Pixel paste is unavailable in the target document.');
    return execute(file, command, fastPasteToken);
  }
  copyGrade(documentId: DocumentSessionId) {
    const execute = this.resolve(documentId).copyGrade;
    if (!execute) throw new Error('Copy Grade is unavailable in the target document.');
    return execute();
  }
  pasteGrade(documentId: DocumentSessionId,
    capture: Parameters<NonNullable<DocumentLightTableCommandPorts['pasteGrade']>>[0]) {
    const execute = this.resolve(documentId).pasteGrade;
    if (!execute) throw new Error('Paste Grade is unavailable in the target document.');
    return execute(capture);
  }
  placeArtifact(documentId: DocumentSessionId, file: File, placement: LightTableArtifactPlacement) {
    return this.resolve(documentId).placeArtifact(file, placement);
  }
  executeTextCommand(documentId: DocumentSessionId, command: SemanticTextCommand) {
    return this.resolve(documentId).executeTextCommand(command);
  }
  executeVectorCommand(documentId: DocumentSessionId, command: SemanticVectorCommand) {
    return this.resolve(documentId).executeVectorCommand(command);
  }
  executeSvgImport(documentId: DocumentSessionId, command: SemanticSvgImportCommand) {
    const execute = this.resolve(documentId).executeSvgImport;
    if (!execute) throw new Error('SVG import is unavailable in the target document.');
    return execute(command);
  }
  executeWarpStrokeCommand(documentId: DocumentSessionId, command: SemanticWarpStrokeCommand) {
    const execute = this.resolve(documentId).executeWarpStrokeCommand;
    if (!execute) throw new Error('Warp stroke commands are unavailable in the target document.');
    return execute(command);
  }
  executeFillCommand(documentId: DocumentSessionId, command: SemanticFillCommand) {
    const execute = this.resolve(documentId).executeFillCommand;
    if (!execute) throw new Error('Fill commands are unavailable in the target document.');
    return execute(command);
  }
  executeRasterGradientCommand(documentId: DocumentSessionId, command: SemanticRasterGradientCommand) {
    const execute = this.resolve(documentId).executeRasterGradientCommand;
    if (!execute) throw new Error('Raster-gradient commands are unavailable in the target document.');
    return execute(command);
  }
  executeLayerStyleCommand(documentId: DocumentSessionId, command: SemanticLayerStyleCommand) {
    return this.resolve(documentId).executeLayerStyleCommand(command);
  }
  executeFaceWarpCommand(documentId: DocumentSessionId, command: SemanticFaceWarpCommand) {
    const execute = this.resolve(documentId).executeFaceWarpCommand;
    if (!execute) throw new Error('Face Warp commands are unavailable in the target document.');
    return execute(command);
  }
  executeLayerCommand(documentId: DocumentSessionId, command: SemanticLayerCommand) {
    return this.resolve(documentId).executeLayerCommand(command);
  }
  executeSelectionCommand(documentId: DocumentSessionId, command: SemanticSelectionCommand) {
    const execute = this.resolve(documentId).executeSelectionCommand;
    if (!execute) throw new Error('Selection commands are unavailable in the target document.');
    return execute(command);
  }
  executeSubjectSelection(documentId: DocumentSessionId, command: SemanticSubjectSelectionCommand,
    signal: AbortSignal, report: (progress: number, message: string) => void) {
    const execute = this.resolve(documentId).executeSubjectSelection;
    if (!execute) throw new Error('Select Subject is unavailable in the target document.');
    return execute(command, signal, report);
  }
  executeBasicAdjustmentCommand(documentId: DocumentSessionId, command: SemanticBasicAdjustmentCommand) {
    const execute = this.resolve(documentId).executeBasicAdjustmentCommand;
    if (!execute) throw new Error('Basic Grade commands are unavailable in the target document.');
    return execute(command);
  }
  executeDetailAdjustmentCommand(documentId: DocumentSessionId, command: SemanticDetailAdjustmentCommand) {
    const execute = this.resolve(documentId).executeDetailAdjustmentCommand;
    if (!execute) throw new Error('Detail commands are unavailable in the target document.');
    return execute(command);
  }
  executeFixedTransform(documentId: DocumentSessionId,
    command: Parameters<NonNullable<DocumentLightTableCommandPorts['executeFixedTransform']>>[0]) {
    const execute = this.resolve(documentId).executeFixedTransform;
    if (!execute) throw new Error('Fixed transform commands are unavailable in the target document.');
    return execute(command);
  }
  executeAdjustmentCreation(documentId: DocumentSessionId,
    command: Parameters<NonNullable<DocumentLightTableCommandPorts['executeAdjustmentCreation']>>[0]) {
    const execute = this.resolve(documentId).executeAdjustmentCreation;
    if (!execute) throw new Error('Adjustment creation is unavailable in the target document.');
    return execute(command);
  }
  executeRasterInvert(documentId: DocumentSessionId,
    command: Parameters<NonNullable<DocumentLightTableCommandPorts['executeRasterInvert']>>[0]) {
    const execute = this.resolve(documentId).executeRasterInvert;
    if (!execute) throw new Error('Raster invert is unavailable in the target document.');
    return execute(command);
  }
  executeTextToShape(documentId: DocumentSessionId,
    command: Parameters<NonNullable<DocumentLightTableCommandPorts['executeTextToShape']>>[0]) {
    const execute = this.resolve(documentId).executeTextToShape;
    if (!execute) throw new Error('Text-to-shape conversion is unavailable in the target document.');
    return execute(command);
  }
  executeTextRasterize(documentId: DocumentSessionId,
    command: Parameters<NonNullable<DocumentLightTableCommandPorts['executeTextRasterize']>>[0]) {
    const execute = this.resolve(documentId).executeTextRasterize;
    if (!execute) throw new Error('Text rasterization is unavailable in the target document.');
    return execute(command);
  }
  executeLayerMerge(documentId: DocumentSessionId,
    command: Parameters<NonNullable<DocumentLightTableCommandPorts['executeLayerMerge']>>[0]) {
    const execute = this.resolve(documentId).executeLayerMerge;
    if (!execute) throw new Error('Layer merge is unavailable in the target document.');
    return execute(command);
  }
  executeFlattenGroup(documentId: DocumentSessionId,
    command: Parameters<NonNullable<DocumentLightTableCommandPorts['executeFlattenGroup']>>[0]) {
    const execute = this.resolve(documentId).executeFlattenGroup;
    if (!execute) throw new Error('Group flatten is unavailable in the target document.');
    return execute(command);
  }
  executeFlattenImage(documentId: DocumentSessionId) {
    const execute = this.resolve(documentId).executeFlattenImage;
    if (!execute) throw new Error('Image flatten is unavailable in the target document.');
    return execute();
  }
  executeBackgroundRemoval(documentId: DocumentSessionId, command: Parameters<NonNullable<
    DocumentLightTableCommandPorts['executeBackgroundRemoval']>>[0], signal: AbortSignal,
    report: (progress: number, message: string) => void) {
    const execute = this.resolve(documentId).executeBackgroundRemoval;
    if (!execute) throw new Error('Remove Background is unavailable in the target document.');
    return execute(command, signal, report);
  }
  executeAutoAlign(documentId: DocumentSessionId, command: Parameters<NonNullable<
    DocumentLightTableCommandPorts['executeAutoAlign']>>[0], signal: AbortSignal) {
    const execute = this.resolve(documentId).executeAutoAlign;
    if (!execute) throw new Error('Auto Align is unavailable in the target document.');
    return execute(command, signal);
  }
  queryBasicAdjustments(documentId: DocumentSessionId, target: BasicAdjustmentTarget) {
    return this.resolve(documentId).queryBasicAdjustments?.(target) ?? null;
  }
  queryAdjustments(documentId: DocumentSessionId, target: AdjustmentQueryTarget) {
    return this.resolve(documentId).queryAdjustments?.(target) ?? null;
  }
  executeAtomicBatch(documentId: DocumentSessionId, batch: AtomicCommandBatch, signal: AbortSignal,
    report: (completed: number, operationId: string) => void) {
    return this.resolve(documentId).executeAtomicBatch(batch, signal, report);
  }
  renameLayer(documentId: DocumentSessionId, layerId: LayerId, name: string) {
    return this.resolve(documentId).renameLayer(layerId, name);
  }
  setLayerVisibility(documentId: DocumentSessionId, layerIds: readonly LayerId[], visible: boolean) {
    return this.resolve(documentId).setLayerVisibility(layerIds, visible);
  }
  setLayerFillOpacity(documentId: DocumentSessionId, layerId: LayerId, opacity: number) {
    return this.resolve(documentId).setLayerFillOpacity(layerId, opacity);
  }
  setLayerStyleEnabled(documentId: DocumentSessionId, layerId: LayerId, enabled: boolean) {
    return this.resolve(documentId).setLayerStyleEnabled(layerId, enabled);
  }
  setLayerEffectEnabled(documentId: DocumentSessionId, layerId: LayerId,
    effectId: LayerStyleId, enabled: boolean) {
    return this.resolve(documentId).setLayerEffectEnabled(layerId, effectId, enabled);
  }
  exportNativeArtifact(documentId: DocumentSessionId) {
    return this.resolve(documentId).exportNativeArtifact();
  }
  exportPngArtifact(documentId: DocumentSessionId) {
    return this.resolve(documentId).exportPngArtifact();
  }
  exportBitmapArtifact(documentId: DocumentSessionId,
    format: Parameters<DocumentLightTableCommandPorts['exportBitmapArtifact']>[0]) {
    return this.resolve(documentId).exportBitmapArtifact(format);
  }
  exportPreviewArtifact(documentId: DocumentSessionId, maxEdge: number,
    encoding: Parameters<DocumentLightTableCommandPorts['exportPreviewArtifact']>[1],
    region?: Parameters<DocumentLightTableCommandPorts['exportPreviewArtifact']>[2]) {
    return this.resolve(documentId).exportPreviewArtifact(maxEdge, encoding, region);
  }
  getDocumentPalette(documentId: DocumentSessionId, colorCount: number) {
    const extract = this.resolve(documentId).getDocumentPalette;
    if (!extract) throw new Error('Document palette extraction is unavailable in the target document.');
    return extract(colorCount);
  }
  getLayerPalette(documentId: DocumentSessionId, layerId: LayerId, colorCount: number) {
    const extract = this.resolve(documentId).getLayerPalette;
    if (!extract) throw new Error('Layer palette extraction is unavailable in the target document.');
    return extract(layerId, colorCount);
  }
  exportLayerPreviewArtifact(documentId: DocumentSessionId, layerId: LayerId,
    channel: 'pixels' | 'mask', maxEdge: number,
    encoding: Parameters<DocumentLightTableCommandPorts['exportLayerPreviewArtifact']>[3]) {
    return this.resolve(documentId).exportLayerPreviewArtifact(layerId, channel, maxEdge, encoding);
  }
  exportPsdArtifact(documentId: DocumentSessionId) {
    return this.resolve(documentId).exportPsdArtifact();
  }
  exportSvgArtifact(documentId: DocumentSessionId) {
    const execute = this.resolve(documentId).exportSvgArtifact;
    if (!execute) throw new Error('SVG export is unavailable in the target document.');
    return execute();
  }
  beginGesture(documentId: DocumentSessionId, kind: LightTableGestureKind, pointerId: number,
    parameters: Record<string, unknown>, sample: LightTableGestureSample) {
    return this.resolve(documentId).beginGesture(kind, pointerId, parameters, sample);
  }
  updateGesture(documentId: DocumentSessionId, kind: LightTableGestureKind, pointerId: number,
    sample: LightTableGestureSample) {
    return this.resolve(documentId).updateGesture(kind, pointerId, sample);
  }
  finishGesture(documentId: DocumentSessionId, kind: LightTableGestureKind, pointerId: number,
    commit: boolean) {
    return this.resolve(documentId).finishGesture(kind, pointerId, commit);
  }
  undo(documentId: DocumentSessionId) { return this.resolve(documentId).undo(); }
  redo(documentId: DocumentSessionId) { return this.resolve(documentId).redo(); }
  queryRenderTelemetry(documentId: DocumentSessionId) {
    return this.resolve(documentId).queryRenderTelemetry?.() ?? null;
  }
  resetRenderTelemetry(documentId: DocumentSessionId) {
    this.resolve(documentId).resetRenderTelemetry?.();
  }

  private resolve(documentId: DocumentSessionId): DocumentLightTableCommandPorts {
    const mounted = this.documents.get(documentId);
    const canonical = this.resolveCanonical?.(documentId) ?? null;
    const ports = mounted && canonical
      ? new Proxy(canonical, {
          get: (target, property, receiver) => (
            Reflect.get(mounted, property, mounted)
            ?? Reflect.get(target, property, receiver)
          )
        })
      : mounted ?? canonical;
    if (!ports) throw new Error('The target document command controller is not mounted.');
    return ports;
  }
}
