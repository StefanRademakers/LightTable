import type { DocumentSessionId, DocumentSessionSnapshot, DocumentViewport } from '../documents/documentSession';
import type { LayerId, LayerNode } from '../../editor/document/documentTypes';
import type { LayerStyleId, LayerStyleInstance, LayerStyleKind } from '../../editor/styles/layerStyleTypes';
import type { RenderTelemetrySnapshot } from '../rendering/renderTelemetry';
import type { LightTableArtifactMetadata } from './lightTableArtifactRegistry';

export const LIGHTTABLE_COMMAND_PROTOCOL_VERSION = 1 as const;

export type LightTableCommandId =
  | 'document.create' | 'view.setZoom' | 'layer.createRaster' | 'layer.placeArtifact'
  | 'layer.rename' | 'layer.setVisibility' | 'layer.setFillOpacity'
  | 'layer.style.setEnabled' | 'layer.effect.setEnabled' | 'file.openArtifact'
  | 'file.exportNative' | 'file.exportPng' | 'file.exportPsd' | 'history.undo' | 'history.redo';

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
}

export interface LightTableCommandPorts {
  setZoom(documentId: DocumentSessionId, viewport: DocumentViewport): void | Promise<void>;
  createRasterLayer(documentId: DocumentSessionId): void | Promise<void>;
  placeArtifact(documentId: DocumentSessionId, file: File, placement: LightTableArtifactPlacement): unknown | Promise<unknown>;
  renameLayer(documentId: DocumentSessionId, layerId: LayerId, name: string): void | Promise<void>;
  setLayerVisibility(documentId: DocumentSessionId, layerIds: readonly LayerId[], visible: boolean): void | Promise<void>;
  setLayerFillOpacity(documentId: DocumentSessionId, layerId: LayerId, opacity: number): void | Promise<void>;
  setLayerStyleEnabled(documentId: DocumentSessionId, layerId: LayerId, enabled: boolean): void | Promise<void>;
  setLayerEffectEnabled(documentId: DocumentSessionId, layerId: LayerId, effectId: LayerStyleId, enabled: boolean): void | Promise<void>;
  exportNativeArtifact(documentId: DocumentSessionId): File | Promise<File>;
  exportPngArtifact(documentId: DocumentSessionId): File | Promise<File>;
  exportPsdArtifact(documentId: DocumentSessionId): File | Promise<File>;
  beginGesture(documentId: DocumentSessionId, kind: LightTableGestureKind, pointerId: number, parameters: Record<string, unknown>, sample: LightTableGestureSample): boolean | Promise<boolean>;
  updateGesture(documentId: DocumentSessionId, kind: LightTableGestureKind, pointerId: number, sample: LightTableGestureSample): boolean | Promise<boolean>;
  finishGesture(documentId: DocumentSessionId, kind: LightTableGestureKind, pointerId: number, commit: boolean): boolean | Promise<boolean>;
  undo(documentId: DocumentSessionId): boolean | Promise<boolean>;
  redo(documentId: DocumentSessionId): boolean | Promise<boolean>;
  queryRenderTelemetry?(documentId: DocumentSessionId): RenderTelemetrySnapshot | null;
  resetRenderTelemetry?(documentId: DocumentSessionId): void;
}

export interface DocumentLightTableCommandPorts {
  setZoom(viewport: DocumentViewport): void | Promise<void>;
  createRasterLayer(): void | Promise<void>;
  placeArtifact(file: File, placement: LightTableArtifactPlacement): unknown | Promise<unknown>;
  renameLayer(layerId: LayerId, name: string): void | Promise<void>;
  setLayerVisibility(layerIds: readonly LayerId[], visible: boolean): void | Promise<void>;
  setLayerFillOpacity(layerId: LayerId, opacity: number): void | Promise<void>;
  setLayerStyleEnabled(layerId: LayerId, enabled: boolean): void | Promise<void>;
  setLayerEffectEnabled(layerId: LayerId, effectId: LayerStyleId, enabled: boolean): void | Promise<void>;
  exportNativeArtifact(): File | Promise<File>; exportPngArtifact(): File | Promise<File>; exportPsdArtifact(): File | Promise<File>;
  beginGesture(kind: LightTableGestureKind, pointerId: number, parameters: Record<string, unknown>, sample: LightTableGestureSample): boolean | Promise<boolean>;
  updateGesture(kind: LightTableGestureKind, pointerId: number, sample: LightTableGestureSample): boolean | Promise<boolean>;
  finishGesture(kind: LightTableGestureKind, pointerId: number, commit: boolean): boolean | Promise<boolean>;
  undo(): boolean | Promise<boolean>; redo(): boolean | Promise<boolean>;
  queryRenderTelemetry?(): RenderTelemetrySnapshot | null; resetRenderTelemetry?(): void;
}
