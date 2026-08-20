import type { DocumentSessionId, DocumentSessionSnapshot, DocumentViewport } from '../documents/documentSession';
import type { LayerId, LayerNode } from '../../editor/document/documentTypes';
import type { LayerStyleId, LayerStyleInstance, LayerStyleKind } from '../../editor/styles/layerStyleTypes';
import type { RenderTelemetrySnapshot } from '../rendering/renderTelemetry';
import type { LightTableArtifactMetadata } from './lightTableArtifactRegistry';
import type { DocumentPreviewResult } from './documentPreviewArtifacts';
import type { ExportedPsdDocument } from '../documents/PsdExportClient';
import type { SemanticTextCommand } from './semanticTextCommandContract';
import type { SemanticVectorCommand } from './semanticVectorCommandContract';
import type { SemanticLayerStyleCommand } from './semanticLayerStyleCommandContract';
import type { VectorElement } from '@lighttable/vector-core';
import type { AtomicCommandBatch } from './atomicCommandBatchContract';
import type { AutomationTaskEvent } from './automationTaskEventStore';
import type { AutomationPublicationEventQueryResult } from './automationPublicationEventStore';
import type { ImageSizeRequest } from '../imageSize/imageSizeModel';
import type { DocumentGeometryRequest } from '../documentGeometry/documentGeometryModel';
import type { SemanticFaceWarpCommand } from './semanticFaceWarpCommandContract';
import type { SemanticLayerCommand } from './semanticLayerCommandContract';
import type { SemanticSelectionCommand } from './semanticSelectionCommandContract';
import type { SemanticBasicAdjustmentCommand } from './semanticBasicAdjustmentCommandContract';
import type { BasicAdjustmentTarget } from './semanticBasicAdjustmentCommandContract';
import type { BasicGradeQueryResult } from '../adjustments/basicAdjustmentQuery';
import type { SemanticWarpStrokeCommand } from './semanticWarpCommandContract';
import type { SemanticFillCommand } from './semanticFillCommandContract';
import type { SemanticRasterGradientCommand } from './semanticRasterGradientCommandContract';
import type { SemanticFixedTransformCommand } from './semanticFixedTransformCommandContract';
import type { SemanticAdjustmentCreationCommand } from './semanticAdjustmentCreationCommandContract';
import type { SemanticRasterInvertCommand } from './semanticRasterInvertCommandContract';
import type { SemanticTextFinalizationCommand } from './semanticTextFinalizationCommandContract';
import {
  LIGHTTABLE_COMMAND_PROTOCOL_VERSION,
  type LightTableCommandId
} from '@lighttable/command-contract';

export { LIGHTTABLE_COMMAND_PROTOCOL_VERSION };
export type { LightTableCommandId };

export type LightTableCommandErrorCode =
  | 'invalid-request' | 'unsupported-protocol' | 'unknown-command' | 'document-required'
  | 'document-not-found' | 'document-not-ready' | 'stale-workspace-revision'
  | 'stale-document-revision' | 'command-unavailable' | 'invalid-parameters' | 'execution-failed';

export interface LightTableCommandRequest {
  readonly protocolVersion: number;
  readonly requestId: string;
  readonly command: string;
  readonly documentId?: string;
  readonly parameters: unknown;
  readonly expectedDocumentRevision?: number;
  readonly expectedWorkspaceRevision?: number;
}

/** Trusted call-site metadata; never accepted from command parameters or remote payloads. */
export type LightTableCommandOrigin = 'ui' | 'actions-playback' | 'mcp' | 'internal';
export interface LightTableCommandExecutionContext {
  readonly origin: LightTableCommandOrigin;
  readonly recording: 'record' | 'ignore';
}

export interface LightTableRevisionSet {
  readonly workspace: number;
  readonly document?: number;
  readonly historyState?: number;
}

export type LightTableCommandResult =
  | { readonly requestId: string; readonly status: 'completed'; readonly value: unknown; readonly revisions: LightTableRevisionSet }
  | { readonly requestId: string; readonly status: 'accepted'; readonly taskId: string; readonly revisions: LightTableRevisionSet }
  | { readonly requestId: string; readonly status: 'rejected'; readonly code: LightTableCommandErrorCode; readonly message: string; readonly revisions: LightTableRevisionSet };

export interface WorkspaceDocumentSummary {
  readonly id: DocumentSessionId;
  readonly title: string;
  readonly lifecycle: DocumentSessionSnapshot['lifecycle'];
  readonly dirty: boolean;
  readonly source: { readonly name: string; readonly mediaType: string; readonly byteLength?: number };
}

export interface WorkspaceQueryResult {
  readonly revision: number;
  readonly activeDocumentId: DocumentSessionId | null;
  readonly documents: readonly WorkspaceDocumentSummary[];
}

export interface DocumentQueryResult {
  readonly revision: number;
  readonly id: DocumentSessionId;
  readonly title: string;
  readonly lifecycle: DocumentSessionSnapshot['lifecycle'];
  readonly dirty: boolean;
  readonly canonicalRevision: number;
  readonly savedRevision: number;
  readonly canvas: { readonly width: number; readonly height: number } | null;
  readonly activeLayerId: LayerId | null;
  readonly layerCount: number;
  readonly viewport: DocumentViewport;
  readonly history: {
    readonly canUndo: boolean; readonly canRedo: boolean; readonly busy: boolean;
    readonly undoDepth: number; readonly redoDepth: number; readonly estimatedBytes: number;
    readonly currentStateId: number;
  };
  readonly tasks: { readonly activeCount: number };
  readonly renderer: {
    readonly status: DocumentSessionSnapshot['renderer']['status'];
    readonly active: boolean;
    readonly estimatedGpuBytes: number;
  };
}

export interface LayerEffectsQueryResult {
  readonly layerId: LayerId;
  readonly enabled: boolean;
  readonly revision: number;
  readonly effects: readonly {
    readonly id: LayerStyleId; readonly kind: LayerStyleKind; readonly name: string;
    readonly enabled: boolean; readonly opacity: number; readonly blendMode: LayerNode['blendMode'];
    /** Complete transport-safe canonical settings for parity/automation. */
    readonly settings: LayerStyleInstance;
  }[];
}

export interface EditableTextQueryResult {
  readonly layerId: LayerId;
  readonly sourceKind: 'flow' | 'positioned';
  readonly editable: boolean;
  readonly revision: number;
  readonly transform: { readonly a: number; readonly b: number; readonly c: number; readonly d: number; readonly tx: number; readonly ty: number };
  readonly content: { readonly text: string; readonly totalLength: number; readonly truncated: boolean };
  readonly layout: unknown;
  readonly styleRuns: readonly {
    readonly start: number; readonly end: number; readonly fontSize: number;
    readonly font: { readonly families: readonly string[]; readonly postScriptName?: string;
      readonly assetId?: string; readonly available: boolean; readonly substituted: boolean };
    readonly fill: unknown; readonly stroke: unknown; readonly tracking: number;
    readonly syntheticBold: boolean; readonly syntheticItalic: boolean;
    readonly underline: boolean;
  }[];
  readonly paragraphRuns: readonly unknown[];
  readonly runsTruncated: boolean;
}

export interface EditableVectorQueryResult {
  readonly layerId: LayerId;
  readonly revision: number;
  readonly totalElements: number;
  readonly truncated: boolean;
  readonly elements: readonly VectorElement[];
}

export interface CommandCapabilitySummary {
  readonly command: LightTableCommandId;
  readonly available: boolean;
  readonly reason: string | null;
}

export interface AutomationTaskQueryResult {
  readonly id: string;
  readonly status: 'running' | 'completed' | 'canceled' | 'failed';
  readonly progress: number | null;
  readonly error: string | null;
  readonly artifact: LightTableArtifactMetadata | null;
}

export interface AutomationEventQueryResult {
  readonly cursor: number;
  readonly events: readonly AutomationTaskEvent[];
}
export type { AutomationPublicationEventQueryResult };

export type LightTableGestureKind = 'brush-stroke' | 'selection-rectangle' | 'layer-translate';
export interface LightTableGestureSample { readonly x: number; readonly y: number; readonly pressure?: number }
export interface LightTableGestureResult {
  readonly status: 'started' | 'updated' | 'completed' | 'canceled' | 'rejected';
  readonly gestureId?: string; readonly sampleCount?: number; readonly message?: string;
}

export interface LightTableCreateDocumentOptions {
  readonly name: string; readonly width: number; readonly height: number;
  readonly resolutionPpi: number; readonly bitDepth: 8 | 16;
  readonly profile: 'srgb' | 'adobe-rgb-1998';
  readonly background: { readonly kind: 'transparent' } | { readonly kind: 'solid'; readonly color: string };
}

export interface LightTableArtifactPlacement { readonly name?: string; readonly x?: number; readonly y?: number }

export interface LightTableWorkspaceCommandPorts {
  openArtifact(file: File): DocumentSessionId | Promise<DocumentSessionId>;
  createDocument(options: LightTableCreateDocumentOptions): DocumentSessionId | Promise<DocumentSessionId>;
  duplicateDocument(documentId: DocumentSessionId, name: string): DocumentSessionId | Promise<DocumentSessionId>;
}

export interface LightTableCommandPorts {
  resizeImage?(documentId: DocumentSessionId, request: ImageSizeRequest): void | Promise<void>;
  applyDocumentGeometry?(documentId: DocumentSessionId, request: DocumentGeometryRequest): void | Promise<void>;
  setZoom(documentId: DocumentSessionId, viewport: DocumentViewport): void | Promise<void>;
  createRasterLayer(documentId: DocumentSessionId): void | Promise<void>;
  placeArtifact(documentId: DocumentSessionId, file: File, placement: LightTableArtifactPlacement): unknown | Promise<unknown>;
  renameLayer(documentId: DocumentSessionId, layerId: LayerId, name: string): void | Promise<void>;
  setLayerVisibility(documentId: DocumentSessionId, layerIds: readonly LayerId[], visible: boolean): void | Promise<void>;
  setLayerFillOpacity(documentId: DocumentSessionId, layerId: LayerId, opacity: number): void | Promise<void>;
  setLayerStyleEnabled(documentId: DocumentSessionId, layerId: LayerId, enabled: boolean): void | Promise<void>;
  setLayerEffectEnabled(documentId: DocumentSessionId, layerId: LayerId, effectId: LayerStyleId, enabled: boolean): unknown | Promise<unknown>;
  executeTextCommand(documentId: DocumentSessionId, command: SemanticTextCommand): unknown | Promise<unknown>;
  executeVectorCommand(documentId: DocumentSessionId, command: SemanticVectorCommand): unknown | Promise<unknown>;
  executeWarpStrokeCommand?(documentId: DocumentSessionId, command: SemanticWarpStrokeCommand): unknown | Promise<unknown>;
  executeFillCommand?(documentId: DocumentSessionId, command: SemanticFillCommand): unknown | Promise<unknown>;
  executeRasterGradientCommand?(documentId: DocumentSessionId, command: SemanticRasterGradientCommand): unknown | Promise<unknown>;
  executeLayerStyleCommand(documentId: DocumentSessionId, command: SemanticLayerStyleCommand): unknown | Promise<unknown>;
  executeFaceWarpCommand?(documentId: DocumentSessionId, command: SemanticFaceWarpCommand): unknown | Promise<unknown>;
  executeLayerCommand(documentId: DocumentSessionId, command: SemanticLayerCommand): unknown | Promise<unknown>;
  executeSelectionCommand?(documentId: DocumentSessionId, command: SemanticSelectionCommand): unknown | Promise<unknown>;
  executeBasicAdjustmentCommand?(documentId: DocumentSessionId, command: SemanticBasicAdjustmentCommand): unknown | Promise<unknown>;
  executeFixedTransform?(documentId: DocumentSessionId, command: SemanticFixedTransformCommand): unknown | Promise<unknown>;
  executeAdjustmentCreation?(documentId: DocumentSessionId, command: SemanticAdjustmentCreationCommand): unknown | Promise<unknown>;
  executeRasterInvert?(documentId: DocumentSessionId, command: SemanticRasterInvertCommand): unknown | Promise<unknown>;
  executeTextToShape?(documentId: DocumentSessionId, command: SemanticTextFinalizationCommand): unknown | Promise<unknown>;
  executeTextRasterize?(documentId: DocumentSessionId, command: SemanticTextFinalizationCommand): unknown | Promise<unknown>;
  queryBasicAdjustments?(documentId: DocumentSessionId, target: BasicAdjustmentTarget): BasicGradeQueryResult | null;
  executeAtomicBatch(documentId: DocumentSessionId, batch: AtomicCommandBatch, signal: AbortSignal,
    report: (completed: number, operationId: string) => void): unknown | Promise<unknown>;
  exportNativeArtifact(documentId: DocumentSessionId): File | Promise<File>;
  exportPngArtifact(documentId: DocumentSessionId): File | Promise<File>;
  exportPreviewArtifact(documentId: DocumentSessionId, maxEdge: number): File | Promise<File>;
  exportPsdArtifact(documentId: DocumentSessionId): File | ExportedPsdDocument | Promise<File | ExportedPsdDocument>;
  beginGesture(documentId: DocumentSessionId, kind: LightTableGestureKind, pointerId: number, parameters: Record<string, unknown>, sample: LightTableGestureSample): boolean | Promise<boolean>;
  updateGesture(documentId: DocumentSessionId, kind: LightTableGestureKind, pointerId: number, sample: LightTableGestureSample): boolean | Promise<boolean>;
  finishGesture(documentId: DocumentSessionId, kind: LightTableGestureKind, pointerId: number, commit: boolean): boolean | Promise<boolean>;
  undo(documentId: DocumentSessionId): boolean | Promise<boolean>;
  redo(documentId: DocumentSessionId): boolean | Promise<boolean>;
  queryRenderTelemetry?(documentId: DocumentSessionId): RenderTelemetrySnapshot | null;
  resetRenderTelemetry?(documentId: DocumentSessionId): void;
}

export interface DocumentLightTableCommandPorts {
  resizeImage?(request: ImageSizeRequest): void | Promise<void>;
  applyDocumentGeometry?(request: DocumentGeometryRequest): void | Promise<void>;
  setZoom(viewport: DocumentViewport): void | Promise<void>;
  createRasterLayer(): void | Promise<void>;
  placeArtifact(file: File, placement: LightTableArtifactPlacement): unknown | Promise<unknown>;
  renameLayer(layerId: LayerId, name: string): void | Promise<void>;
  setLayerVisibility(layerIds: readonly LayerId[], visible: boolean): void | Promise<void>;
  setLayerFillOpacity(layerId: LayerId, opacity: number): void | Promise<void>;
  setLayerStyleEnabled(layerId: LayerId, enabled: boolean): void | Promise<void>;
  setLayerEffectEnabled(layerId: LayerId, effectId: LayerStyleId, enabled: boolean): unknown | Promise<unknown>;
  executeTextCommand(command: SemanticTextCommand): unknown | Promise<unknown>;
  executeVectorCommand(command: SemanticVectorCommand): unknown | Promise<unknown>;
  executeWarpStrokeCommand?(command: SemanticWarpStrokeCommand): unknown | Promise<unknown>;
  executeFillCommand?(command: SemanticFillCommand): unknown | Promise<unknown>;
  executeRasterGradientCommand?(command: SemanticRasterGradientCommand): unknown | Promise<unknown>;
  executeLayerStyleCommand(command: SemanticLayerStyleCommand): unknown | Promise<unknown>;
  executeFaceWarpCommand?(command: SemanticFaceWarpCommand): unknown | Promise<unknown>;
  executeLayerCommand(command: SemanticLayerCommand): unknown | Promise<unknown>;
  executeSelectionCommand?(command: SemanticSelectionCommand): unknown | Promise<unknown>;
  executeBasicAdjustmentCommand?(command: SemanticBasicAdjustmentCommand): unknown | Promise<unknown>;
  executeFixedTransform?(command: SemanticFixedTransformCommand): unknown | Promise<unknown>;
  executeAdjustmentCreation?(command: SemanticAdjustmentCreationCommand): unknown | Promise<unknown>;
  executeRasterInvert?(command: SemanticRasterInvertCommand): unknown | Promise<unknown>;
  executeTextToShape?(command: SemanticTextFinalizationCommand): unknown | Promise<unknown>;
  executeTextRasterize?(command: SemanticTextFinalizationCommand): unknown | Promise<unknown>;
  queryBasicAdjustments?(target: BasicAdjustmentTarget): BasicGradeQueryResult | null;
  executeAtomicBatch(batch: AtomicCommandBatch, signal: AbortSignal,
    report: (completed: number, operationId: string) => void): unknown | Promise<unknown>;
  exportNativeArtifact(): File | Promise<File>; exportPngArtifact(): File | Promise<File>;
  exportPreviewArtifact(maxEdge: number): File | Promise<File>;
  exportPsdArtifact(): File | ExportedPsdDocument | Promise<File | ExportedPsdDocument>;
  beginGesture(kind: LightTableGestureKind, pointerId: number, parameters: Record<string, unknown>, sample: LightTableGestureSample): boolean | Promise<boolean>;
  updateGesture(kind: LightTableGestureKind, pointerId: number, sample: LightTableGestureSample): boolean | Promise<boolean>;
  finishGesture(kind: LightTableGestureKind, pointerId: number, commit: boolean): boolean | Promise<boolean>;
  undo(): boolean | Promise<boolean>; redo(): boolean | Promise<boolean>;
  queryRenderTelemetry?(): RenderTelemetrySnapshot | null; resetRenderTelemetry?(): void;
}
