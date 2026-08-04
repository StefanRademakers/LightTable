import type {
  DocumentSessionId,
  DocumentSessionSnapshot,
  DocumentViewport
} from '../documents/documentSession';
import type { WorkspaceSession } from '../workspace/workspaceSession';
import type { LayerId, LayerNode } from '../../editor/document/documentTypes';
import type { LayerStyleId, LayerStyleKind } from '../../editor/styles/layerStyleTypes';
import { findDocumentLayer, walkLayerTree } from '../../editor/document/layerTree';
import { layerStyleStackIsActive } from '../../editor/styles/layerStyleDefaults';
import { queryLayerCommandCapabilities } from '../layers/layerCommandCapabilities';
import {
  LightTableArtifactRegistry,
  type LightTableArtifactKind,
  type LightTableArtifactMetadata
} from './lightTableArtifactRegistry';

export const LIGHTTABLE_COMMAND_PROTOCOL_VERSION = 1 as const;

export type LightTableCommandId =
  | 'view.setZoom'
  | 'layer.createRaster'
  | 'layer.rename'
  | 'layer.setVisibility'
  | 'layer.setFillOpacity'
  | 'layer.style.setEnabled'
  | 'layer.effect.setEnabled'
  | 'file.openArtifact'
  | 'file.exportNative'
  | 'file.exportPng'
  | 'history.undo'
  | 'history.redo';

export type LightTableCommandErrorCode =
  | 'invalid-request'
  | 'unsupported-protocol'
  | 'unknown-command'
  | 'document-required'
  | 'document-not-found'
  | 'document-not-ready'
  | 'stale-document-revision'
  | 'command-unavailable'
  | 'invalid-parameters'
  | 'execution-failed';

export interface LightTableCommandRequest {
  readonly protocolVersion: number;
  readonly requestId: string;
  readonly command: string;
  readonly documentId?: string;
  readonly parameters: unknown;
  readonly expectedDocumentRevision?: number;
}

export interface LightTableRevisionSet {
  readonly workspace: number;
  readonly document?: number;
  readonly historyState?: number;
}

export type LightTableCommandResult =
  | {
      readonly requestId: string;
      readonly status: 'completed';
      readonly value: unknown;
      readonly revisions: LightTableRevisionSet;
    }
  | {
      readonly requestId: string;
      readonly status: 'accepted';
      readonly taskId: string;
      readonly revisions: LightTableRevisionSet;
    }
  | {
      readonly requestId: string;
      readonly status: 'rejected';
      readonly code: LightTableCommandErrorCode;
      readonly message: string;
      readonly revisions: LightTableRevisionSet;
    };

export interface WorkspaceDocumentSummary {
  readonly id: DocumentSessionId;
  readonly title: string;
  readonly lifecycle: DocumentSessionSnapshot['lifecycle'];
  readonly dirty: boolean;
  readonly source: {
    readonly name: string;
    readonly mediaType: string;
    readonly byteLength?: number;
  };
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
    readonly canUndo: boolean;
    readonly canRedo: boolean;
    readonly busy: boolean;
    readonly undoDepth: number;
    readonly redoDepth: number;
    readonly currentStateId: number;
  };
  readonly tasks: {
    readonly activeCount: number;
  };
  readonly renderer: {
    readonly status: DocumentSessionSnapshot['renderer']['status'];
    readonly active: boolean;
    readonly estimatedGpuBytes: number;
  };
}

export interface LayerQuerySummary {
  readonly id: LayerId;
  readonly parentId: LayerId | null;
  readonly depth: number;
  readonly type: LayerNode['type'];
  readonly name: string;
  readonly visible: boolean;
  readonly opacity: number;
  readonly fillOpacity: number;
  readonly blendMode: LayerNode['blendMode'];
  readonly clipping: boolean;
  readonly hasMask: boolean;
  readonly hasActiveEffects: boolean;
  readonly transform: LayerNode['transform'];
  readonly rasterSurface: {
    readonly width: number;
    readonly height: number;
    readonly offsetX: number;
    readonly offsetY: number;
  } | null;
  readonly textLayout: {
    readonly sourceKind: 'flow' | 'positioned';
    readonly mode: 'point' | 'paragraph' | 'path' | 'positioned';
    readonly writingMode: 'horizontal-tb' | 'vertical-rl' | 'vertical-lr' | null;
  } | null;
}

export interface LayerEffectsQueryResult {
  readonly layerId: LayerId;
  readonly enabled: boolean;
  readonly revision: number;
  readonly effects: readonly {
    readonly id: LayerStyleId;
    readonly kind: LayerStyleKind;
    readonly name: string;
    readonly enabled: boolean;
    readonly opacity: number;
    readonly blendMode: LayerNode['blendMode'];
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

export interface LightTableGestureSample {
  readonly x: number;
  readonly y: number;
  readonly pressure?: number;
}

export interface LightTableGestureResult {
  readonly status: 'started' | 'updated' | 'completed' | 'canceled' | 'rejected';
  readonly gestureId?: string;
  readonly sampleCount?: number;
  readonly message?: string;
}

export interface LightTableWorkspaceCommandPorts {
  openArtifact(file: File): DocumentSessionId | Promise<DocumentSessionId>;
}

export interface LightTableCommandPorts {
  setZoom(documentId: DocumentSessionId, viewport: DocumentViewport): void | Promise<void>;
  createRasterLayer(documentId: DocumentSessionId): void | Promise<void>;
  renameLayer(documentId: DocumentSessionId, layerId: LayerId, name: string): void | Promise<void>;
  setLayerVisibility(
    documentId: DocumentSessionId,
    layerIds: readonly LayerId[],
    visible: boolean
  ): void | Promise<void>;
  setLayerFillOpacity(documentId: DocumentSessionId, layerId: LayerId, opacity: number): void | Promise<void>;
  setLayerStyleEnabled(documentId: DocumentSessionId, layerId: LayerId, enabled: boolean): void | Promise<void>;
  setLayerEffectEnabled(documentId: DocumentSessionId, layerId: LayerId, effectId: LayerStyleId, enabled: boolean): void | Promise<void>;
  exportNativeArtifact(documentId: DocumentSessionId): File | Promise<File>;
  exportPngArtifact(documentId: DocumentSessionId): File | Promise<File>;
  beginGesture(documentId: DocumentSessionId, kind: LightTableGestureKind, pointerId: number, parameters: Record<string, unknown>, sample: LightTableGestureSample): boolean | Promise<boolean>;
  updateGesture(documentId: DocumentSessionId, kind: LightTableGestureKind, pointerId: number, sample: LightTableGestureSample): boolean | Promise<boolean>;
  finishGesture(documentId: DocumentSessionId, kind: LightTableGestureKind, pointerId: number, commit: boolean): boolean | Promise<boolean>;
  undo(documentId: DocumentSessionId): boolean | Promise<boolean>;
  redo(documentId: DocumentSessionId): boolean | Promise<boolean>;
}

export interface DocumentLightTableCommandPorts {
  setZoom(viewport: DocumentViewport): void | Promise<void>;
  createRasterLayer(): void | Promise<void>;
  renameLayer(layerId: LayerId, name: string): void | Promise<void>;
  setLayerVisibility(layerIds: readonly LayerId[], visible: boolean): void | Promise<void>;
  setLayerFillOpacity(layerId: LayerId, opacity: number): void | Promise<void>;
  setLayerStyleEnabled(layerId: LayerId, enabled: boolean): void | Promise<void>;
  setLayerEffectEnabled(layerId: LayerId, effectId: LayerStyleId, enabled: boolean): void | Promise<void>;
  exportNativeArtifact(): File | Promise<File>;
  exportPngArtifact(): File | Promise<File>;
  beginGesture(kind: LightTableGestureKind, pointerId: number, parameters: Record<string, unknown>, sample: LightTableGestureSample): boolean | Promise<boolean>;
  updateGesture(kind: LightTableGestureKind, pointerId: number, sample: LightTableGestureSample): boolean | Promise<boolean>;
  finishGesture(kind: LightTableGestureKind, pointerId: number, commit: boolean): boolean | Promise<boolean>;
  undo(): boolean | Promise<boolean>;
  redo(): boolean | Promise<boolean>;
}

/**
 * Routes transport-neutral commands to the mounted controller for one document.
 *
 * The workspace owns this registry while each editor runtime registers its
 * existing application controllers. That keeps commands document-scoped and
 * prevents automation from introducing a second mutation implementation.
 */
export class LightTableCommandPortRegistry implements LightTableCommandPorts {
  private readonly documents = new Map<DocumentSessionId, DocumentLightTableCommandPorts>();

  register(
    documentId: DocumentSessionId,
    ports: DocumentLightTableCommandPorts
  ): () => void {
    this.documents.set(documentId, ports);
    return () => {
      if (this.documents.get(documentId) === ports) this.documents.delete(documentId);
    };
  }

  has(documentId: DocumentSessionId): boolean {
    return this.documents.has(documentId);
  }

  setZoom(documentId: DocumentSessionId, viewport: DocumentViewport) {
    return this.resolve(documentId).setZoom(viewport);
  }

  createRasterLayer(documentId: DocumentSessionId) {
    return this.resolve(documentId).createRasterLayer();
  }

  renameLayer(documentId: DocumentSessionId, layerId: LayerId, name: string) {
    return this.resolve(documentId).renameLayer(layerId, name);
  }

  setLayerVisibility(
    documentId: DocumentSessionId,
    layerIds: readonly LayerId[],
    visible: boolean
  ) {
    return this.resolve(documentId).setLayerVisibility(layerIds, visible);
  }

  setLayerFillOpacity(documentId: DocumentSessionId, layerId: LayerId, opacity: number) {
    return this.resolve(documentId).setLayerFillOpacity(layerId, opacity);
  }

  setLayerStyleEnabled(documentId: DocumentSessionId, layerId: LayerId, enabled: boolean) {
    return this.resolve(documentId).setLayerStyleEnabled(layerId, enabled);
  }

  setLayerEffectEnabled(
    documentId: DocumentSessionId,
    layerId: LayerId,
    effectId: LayerStyleId,
    enabled: boolean
  ) {
    return this.resolve(documentId).setLayerEffectEnabled(layerId, effectId, enabled);
  }

  exportNativeArtifact(documentId: DocumentSessionId) {
    return this.resolve(documentId).exportNativeArtifact();
  }

  exportPngArtifact(documentId: DocumentSessionId) {
    return this.resolve(documentId).exportPngArtifact();
  }

  beginGesture(documentId: DocumentSessionId, kind: LightTableGestureKind, pointerId: number, parameters: Record<string, unknown>, sample: LightTableGestureSample) {
    return this.resolve(documentId).beginGesture(kind, pointerId, parameters, sample);
  }

  updateGesture(documentId: DocumentSessionId, kind: LightTableGestureKind, pointerId: number, sample: LightTableGestureSample) {
    return this.resolve(documentId).updateGesture(kind, pointerId, sample);
  }

  finishGesture(documentId: DocumentSessionId, kind: LightTableGestureKind, pointerId: number, commit: boolean) {
    return this.resolve(documentId).finishGesture(kind, pointerId, commit);
  }

  undo(documentId: DocumentSessionId) {
    return this.resolve(documentId).undo();
  }

  redo(documentId: DocumentSessionId) {
    return this.resolve(documentId).redo();
  }

  private resolve(documentId: DocumentSessionId): DocumentLightTableCommandPorts {
    const ports = this.documents.get(documentId);
    if (!ports) throw new Error('The target document command controller is not mounted.');
    return ports;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

/**
 * Transport-neutral read/query and bounded command registry.
 *
 * It exposes serializable projections only. Existing application controllers
 * remain mutation authority through the injected ports; this service never
 * edits React state, document objects or GPU resources itself.
 */
export class LightTableCommandService {
  private workspaceRevision = 1;
  private readonly unsubscribe: () => void;
  private readonly taskArtifacts = new Map<string, LightTableArtifactMetadata>();
  private readonly gestures = new Map<string, {
    readonly documentId: DocumentSessionId;
    readonly kind: LightTableGestureKind;
    readonly pointerId: number;
    sampleCount: number;
  }>();
  private gestureSequence = 0;

  constructor(
    private readonly workspace: WorkspaceSession,
    private readonly ports: LightTableCommandPorts,
    private readonly workspacePorts?: LightTableWorkspaceCommandPorts,
    private readonly artifacts = new LightTableArtifactRegistry()
  ) {
    this.unsubscribe = workspace.subscribe(() => {
      this.workspaceRevision += 1;
    });
  }

  dispose(): void {
    this.unsubscribe();
    this.artifacts.clear();
    this.taskArtifacts.clear();
  }

  registerInputArtifact(file: File): LightTableArtifactMetadata {
    return this.artifacts.register(file, 'input');
  }

  queryArtifact(artifactId: string): LightTableArtifactMetadata | null {
    return this.artifacts.query(artifactId);
  }

  listArtifacts(): readonly LightTableArtifactMetadata[] {
    return this.artifacts.list();
  }

  releaseArtifact(artifactId: string): boolean {
    return this.artifacts.release(artifactId);
  }

  queryTask(documentId: DocumentSessionId, taskId: string): AutomationTaskQueryResult | null {
    const state = this.workspace.getDocument(documentId)?.tasks.getSnapshot().tasks[taskId];
    return state ? {
      id: state.id,
      status: state.status,
      progress: state.progress,
      error: state.error,
      artifact: this.taskArtifacts.get(taskId) ?? null
    } : null;
  }

  async beginGesture(request: unknown): Promise<LightTableGestureResult> {
    if (!isRecord(request) || typeof request.documentId !== 'string'
      || !this.isGestureKind(request.kind) || request.coordinateSpace !== 'document'
      || !isRecord(request.parameters) || !this.isGestureSample(request.sample)) {
      return { status: 'rejected', message: 'Gesture begin requires documentId, kind, document coordinates, parameters and a finite sample.' };
    }
    const documentId = request.documentId as DocumentSessionId;
    const snapshot = this.document(documentId);
    if (!snapshot?.document || snapshot.lifecycle !== 'ready') {
      return { status: 'rejected', message: 'The target document is not ready.' };
    }
    if ([...this.gestures.values()].some((gesture) => gesture.documentId === documentId)) {
      return { status: 'rejected', message: 'The document already owns an active automation gesture.' };
    }
    const pointerId = 1_000_000 + ++this.gestureSequence;
    const started = await this.ports.beginGesture(
      documentId, request.kind, pointerId, request.parameters, request.sample
    );
    if (!started) return { status: 'rejected', message: 'The editor rejected the gesture.' };
    const gestureId = `gesture-${Date.now()}-${this.gestureSequence}`;
    this.gestures.set(gestureId, { documentId, kind: request.kind, pointerId, sampleCount: 1 });
    return { status: 'started', gestureId, sampleCount: 1 };
  }

  async updateGesture(gestureId: string, samples: unknown): Promise<LightTableGestureResult> {
    const gesture = this.gestures.get(gestureId);
    if (!gesture) return { status: 'rejected', message: 'The gesture does not exist.' };
    if (!Array.isArray(samples) || samples.length < 1 || samples.length > 64
      || !samples.every((sample) => this.isGestureSample(sample))) {
      return { status: 'rejected', message: 'Gesture updates require 1-64 finite samples.' };
    }
    if (gesture.sampleCount + samples.length > 4096) {
      await this.finishGesture(gestureId, false);
      return { status: 'rejected', message: 'The gesture exceeded the 4096-sample limit and was canceled.' };
    }
    for (const sample of samples as LightTableGestureSample[]) {
      if (!await this.ports.updateGesture(
        gesture.documentId, gesture.kind, gesture.pointerId, sample
      )) {
        await this.finishGesture(gestureId, false);
        return { status: 'rejected', message: 'The editor rejected a gesture sample.' };
      }
    }
    gesture.sampleCount += samples.length;
    return { status: 'updated', gestureId, sampleCount: gesture.sampleCount };
  }

  async finishGesture(gestureId: string, commit: boolean): Promise<LightTableGestureResult> {
    const gesture = this.gestures.get(gestureId);
    if (!gesture) return { status: 'rejected', message: 'The gesture does not exist.' };
    this.gestures.delete(gestureId);
    const finished = await this.ports.finishGesture(
      gesture.documentId, gesture.kind, gesture.pointerId, commit
    );
    return finished
      ? { status: commit ? 'completed' : 'canceled', gestureId, sampleCount: gesture.sampleCount }
      : { status: 'rejected', message: 'The editor could not finish the gesture.' };
  }

  queryWorkspace(): WorkspaceQueryResult {
    const snapshot = this.workspace.getSnapshot();
    return {
      revision: this.workspaceRevision,
      activeDocumentId: snapshot.activeDocumentId,
      documents: snapshot.documentOrder.flatMap((id) => {
        const document = snapshot.documents[id];
        return document ? [{
          id,
          title: document.title,
          lifecycle: document.lifecycle,
          dirty: document.dirty,
          source: {
            name: document.source.name,
            mediaType: document.source.mediaType,
            ...(document.source.byteLength === undefined
              ? {}
              : { byteLength: document.source.byteLength })
          }
        }] : [];
      })
    };
  }

  queryDocument(documentId: DocumentSessionId): DocumentQueryResult | null {
    const document = this.document(documentId);
    if (!document) return null;
    const canonical = document.document;
    return {
      revision: this.workspaceRevision,
      id: document.id,
      title: document.title,
      lifecycle: document.lifecycle,
      dirty: document.dirty,
      canonicalRevision: document.documentRevision,
      savedRevision: document.savedRevision,
      canvas: canonical ? { width: canonical.width, height: canonical.height } : null,
      activeLayerId: canonical?.activeLayerId ?? null,
      layerCount: canonical ? walkLayerTree(canonical.layers).length : 0,
      viewport: { ...document.viewport },
      history: {
        canUndo: document.history.canUndo,
        canRedo: document.history.canRedo,
        busy: document.history.busy,
        undoDepth: document.history.undoDepth,
        redoDepth: document.history.redoDepth,
        currentStateId: document.history.currentStateId
      },
      tasks: { activeCount: document.tasks.activeTaskIds.length },
      renderer: {
        status: document.renderer.status,
        active: document.renderer.active,
        estimatedGpuBytes: document.renderer.estimatedGpuBytes
      }
    };
  }

  queryLayers(documentId: DocumentSessionId): readonly LayerQuerySummary[] | null {
    const canonical = this.document(documentId)?.document;
    if (!canonical) return null;
    return walkLayerTree(canonical.layers).map(({ node, parentId, path }) => ({
      id: node.id,
      parentId,
      depth: path.length - 1,
      type: node.type,
      name: node.name,
      visible: node.visible,
      opacity: node.opacity,
      fillOpacity: node.fillOpacity,
      blendMode: node.blendMode,
      clipping: node.clipping,
      hasMask: Boolean(node.mask),
      hasActiveEffects: layerStyleStackIsActive(node.styleStack),
      transform: { ...node.transform },
      rasterSurface: node.type === 'raster' ? {
        width: node.width,
        height: node.height,
        offsetX: node.offsetX,
        offsetY: node.offsetY
      } : null,
      textLayout: node.type === 'text' ? node.text.source.kind === 'flow' ? {
        sourceKind: 'flow' as const,
        mode: node.text.source.layout.mode,
        writingMode: node.text.source.layout.mode === 'path'
          ? null : node.text.source.layout.writingMode
      } : {
        sourceKind: 'positioned' as const,
        mode: 'positioned' as const,
        writingMode: null
      } : null
    }));
  }

  queryLayerEffects(documentId: DocumentSessionId, layerId: LayerId): LayerEffectsQueryResult | null {
    const canonical = this.document(documentId)?.document;
    const layer = canonical ? findDocumentLayer(canonical, layerId) : null;
    if (!layer) return null;
    return {
      layerId,
      enabled: layer.styleStack.enabled,
      revision: layer.styleStack.revision,
      effects: layer.styleStack.effects.map((effect) => ({
        id: effect.id,
        kind: effect.kind,
        name: effect.name,
        enabled: effect.enabled,
        opacity: effect.opacity,
        blendMode: effect.blendMode
      }))
    };
  }

  queryCapabilities(documentId: DocumentSessionId): readonly CommandCapabilitySummary[] | null {
    const snapshot = this.document(documentId);
    if (!snapshot?.document) return null;
    const ready = snapshot.lifecycle === 'ready';
    const layerCapabilities = queryLayerCommandCapabilities(snapshot.document);
    const availability = (
      command: LightTableCommandId,
      available: boolean,
      reason: string
    ): CommandCapabilitySummary => ({
      command,
      available: ready && available,
      reason: !ready ? 'The document is not ready.' : available ? null : reason
    });
    return [
      availability('view.setZoom', true, ''),
      availability('layer.createRaster', true, ''),
      availability(
        'layer.rename',
        Boolean(layerCapabilities.activeLayer),
        'Select an existing layer.'
      ),
      availability('layer.setVisibility', true, ''),
      availability('layer.setFillOpacity', true, ''),
      availability('layer.style.setEnabled', true, ''),
      availability('layer.effect.setEnabled', true, ''),
      availability('file.exportNative', true, ''),
      availability('file.exportPng', true, ''),
      availability('history.undo', snapshot.history.canUndo, 'There is nothing to undo.'),
      availability('history.redo', snapshot.history.canRedo, 'There is nothing to redo.')
    ];
  }

  async execute(requestValue: unknown): Promise<LightTableCommandResult> {
    const request = this.parseRequest(requestValue);
    if ('rejection' in request) return request.rejection;
    const { value } = request;
    if (value.command === 'file.openArtifact') {
      if (!isRecord(value.parameters) || typeof value.parameters.artifactId !== 'string') {
        return this.reject(value.requestId, 'invalid-parameters', 'Open requires an artifactId.');
      }
      const file = this.artifacts.resolve(value.parameters.artifactId);
      if (!file) return this.reject(value.requestId, 'command-unavailable', 'The input artifact does not exist.');
      if (!this.workspacePorts) return this.reject(value.requestId, 'command-unavailable', 'Artifact open is unavailable in this host.');
      try {
        const documentId = await this.workspacePorts.openArtifact(file);
        return {
          requestId: value.requestId,
          status: 'completed',
          value: { documentId },
          revisions: this.revisions()
        };
      } catch (reason) {
        return this.reject(value.requestId, 'execution-failed', reason instanceof Error ? reason.message : String(reason));
      }
    }
    if (!value.documentId) {
      return this.reject(value.requestId, 'document-required', 'This command requires a documentId.');
    }
    const documentRequest = value as DocumentParsedCommandRequest;
    const snapshot = this.document(documentRequest.documentId);
    if (!snapshot) {
      return this.reject(value.requestId, 'document-not-found', 'The target document is not open.');
    }
    if (snapshot.lifecycle !== 'ready' || !snapshot.document) {
      return this.reject(value.requestId, 'document-not-ready', 'The target document is not ready.');
    }
    if (
      value.expectedDocumentRevision !== undefined
      && value.expectedDocumentRevision !== snapshot.documentRevision
    ) {
      return this.reject(
        value.requestId,
        'stale-document-revision',
        `Expected document revision ${value.expectedDocumentRevision}, current revision is ${snapshot.documentRevision}.`,
        snapshot
      );
    }

    if (value.command === 'file.exportNative' || value.command === 'file.exportPng') {
      if (!isRecord(value.parameters) || Object.keys(value.parameters).length > 0) {
        return this.reject(value.requestId, 'invalid-parameters', 'Export parameters must be an empty object.', snapshot);
      }
      return this.startArtifactExport(documentRequest, snapshot);
    }

    try {
      const result = await this.executeParsed(documentRequest, snapshot);
      if ('code' in result) return this.reject(value.requestId, result.code, result.message, snapshot);
      return {
        requestId: value.requestId,
        status: 'completed',
        value: result.value,
        revisions: this.revisions(this.document(documentRequest.documentId) ?? snapshot)
      };
    } catch (reason) {
      return this.reject(
        value.requestId,
        'execution-failed',
        reason instanceof Error ? reason.message : 'The command failed.',
        snapshot
      );
    }
  }

  private startArtifactExport(
    request: DocumentParsedCommandRequest,
    snapshot: DocumentSessionSnapshot
  ): LightTableCommandResult {
    const session = this.workspace.getDocument(request.documentId);
    if (!session) return this.reject(request.requestId, 'document-not-found', 'The target document is not open.');
    const native = request.command === 'file.exportNative';
    const operation = native ? this.ports.exportNativeArtifact.bind(this.ports)
      : this.ports.exportPngArtifact.bind(this.ports);
    const kind: LightTableArtifactKind = native ? 'native-document' : 'png-export';
    const running = session.tasks.run('export', native ? 'Export native document' : 'Export PNG artifact', async (task) => {
      const file = await operation(request.documentId);
      task.throwIfCanceled();
      return this.artifacts.register(file, kind);
    });
    const taskId = session.tasks.getSnapshot().activeTaskIds.at(-1);
    if (!taskId) return this.reject(request.requestId, 'execution-failed', 'The export task did not start.', snapshot);
    void running.then((result) => {
      if (result.status === 'completed') this.taskArtifacts.set(taskId, result.value);
    });
    return {
      requestId: request.requestId,
      status: 'accepted',
      taskId,
      revisions: this.revisions(snapshot)
    };
  }

  private async executeParsed(
    request: DocumentParsedCommandRequest,
    snapshot: DocumentSessionSnapshot
  ): Promise<{ value: unknown } | { code: LightTableCommandErrorCode; message: string }> {
    const parameters = request.parameters;
    switch (request.command) {
      case 'view.setZoom': {
        if (!isRecord(parameters)) return this.invalidParameters('Zoom parameters must be an object.');
        const mode = parameters.mode;
        const percent = parameters.percent;
        if (mode !== 'fit' && mode !== '100' && mode !== 'custom') {
          return this.invalidParameters('Zoom mode must be fit, 100 or custom.');
        }
        if (mode === 'custom' && (typeof percent !== 'number' || !Number.isFinite(percent))) {
          return this.invalidParameters('Custom zoom requires a finite percent.');
        }
        const scale = mode === 'custom'
          ? Math.max(0.01, Math.min(256, Number(percent) / 100))
          : mode === '100' ? 1 : snapshot.viewport.scale;
        const viewport: DocumentViewport = { ...snapshot.viewport, zoomMode: mode, scale };
        await this.ports.setZoom(request.documentId, viewport);
        return { value: { viewport } };
      }
      case 'layer.createRaster':
        if (!isRecord(parameters) || Object.keys(parameters).length > 0) {
          return this.invalidParameters('Create raster parameters must be an empty object.');
        }
        await this.ports.createRasterLayer(request.documentId);
        return { value: { created: true } };
      case 'layer.rename': {
        if (!isRecord(parameters)) return this.invalidParameters('Rename parameters must be an object.');
        const layerId = typeof parameters.layerId === 'string'
          ? parameters.layerId as LayerId
          : null;
        const name = typeof parameters.name === 'string' ? parameters.name.trim() : '';
        if (!layerId || !name) return this.invalidParameters('Rename requires layerId and a non-empty name.');
        if (!findDocumentLayer(snapshot.document!, layerId)) {
          return { code: 'command-unavailable', message: 'The target layer does not exist.' };
        }
        await this.ports.renameLayer(request.documentId, layerId, name);
        return { value: { layerId, name } };
      }
      case 'layer.setVisibility': {
        if (!isRecord(parameters) || !Array.isArray(parameters.layerIds)
          || parameters.layerIds.length < 1 || parameters.layerIds.length > 256
          || typeof parameters.visible !== 'boolean') {
          return this.invalidParameters(
            'Visibility requires 1-256 layerIds and a boolean visible value.'
          );
        }
        const layerIds = parameters.layerIds;
        if (layerIds.some((id) => typeof id !== 'string')) {
          return this.invalidParameters('Every visibility layerId must be a string.');
        }
        const unique = [...new Set(layerIds)] as LayerId[];
        if (unique.some((id) => !findDocumentLayer(snapshot.document!, id))) {
          return { code: 'command-unavailable', message: 'One or more target layers do not exist.' };
        }
        await this.ports.setLayerVisibility(request.documentId, unique, parameters.visible);
        return { value: { layerIds: unique, visible: parameters.visible } };
      }
      case 'layer.style.setEnabled':
      case 'layer.effect.setEnabled': {
        if (!isRecord(parameters) || typeof parameters.layerId !== 'string'
          || typeof parameters.enabled !== 'boolean') {
          return this.invalidParameters('Style enable commands require layerId and enabled.');
        }
        const layerId = parameters.layerId as LayerId;
        const layer = findDocumentLayer(snapshot.document!, layerId);
        if (!layer) return { code: 'command-unavailable', message: 'The target layer does not exist.' };
        if (request.command === 'layer.style.setEnabled') {
          await this.ports.setLayerStyleEnabled(request.documentId, layerId, parameters.enabled);
          return { value: { layerId, enabled: parameters.enabled } };
        }
        if (typeof parameters.effectId !== 'string' || !parameters.effectId) {
          return this.invalidParameters('Effect enable requires a non-empty effectId.');
        }
        const effectId = parameters.effectId as LayerStyleId;
        if (!layer.styleStack.effects.some(({ id }) => id === effectId)) {
          return { code: 'command-unavailable', message: 'The target effect does not exist.' };
        }
        await this.ports.setLayerEffectEnabled(
          request.documentId, layerId, effectId, parameters.enabled
        );
        return { value: { layerId, effectId, enabled: parameters.enabled } };
      }
      case 'layer.setFillOpacity': {
        if (!isRecord(parameters) || typeof parameters.layerId !== 'string'
          || typeof parameters.opacity !== 'number' || !Number.isFinite(parameters.opacity)
          || parameters.opacity < 0 || parameters.opacity > 1) {
          return this.invalidParameters('Fill opacity requires layerId and an opacity from 0 to 1.');
        }
        const layerId = parameters.layerId as LayerId;
        if (!findDocumentLayer(snapshot.document!, layerId)) {
          return { code: 'command-unavailable', message: 'The target layer does not exist.' };
        }
        await this.ports.setLayerFillOpacity(request.documentId, layerId, parameters.opacity);
        return { value: { layerId, opacity: parameters.opacity } };
      }
      case 'history.undo':
      case 'history.redo': {
        if (!isRecord(parameters) || Object.keys(parameters).length > 0) {
          return this.invalidParameters('History parameters must be an empty object.');
        }
        const direction = request.command === 'history.undo' ? 'undo' : 'redo';
        const available = direction === 'undo' ? snapshot.history.canUndo : snapshot.history.canRedo;
        if (!available) {
          return {
            code: 'command-unavailable',
            message: direction === 'undo' ? 'There is nothing to undo.' : 'There is nothing to redo.'
          };
        }
        const changed = await this.ports[direction](request.documentId);
        if (!changed) return { code: 'execution-failed', message: `${direction} did not complete.` };
        return { value: { changed: true } };
      }
    }
    return { code: 'command-unavailable', message: 'The command is not available in this document scope.' };
  }

  private parseRequest(value: unknown):
    | { value: ParsedCommandRequest }
    | { rejection: LightTableCommandResult } {
    const requestId = isRecord(value) && typeof value.requestId === 'string'
      ? value.requestId
      : 'invalid-request';
    if (!isRecord(value)) {
      return { rejection: this.reject(requestId, 'invalid-request', 'The command request must be an object.') };
    }
    if (value.protocolVersion !== LIGHTTABLE_COMMAND_PROTOCOL_VERSION) {
      return { rejection: this.reject(requestId, 'unsupported-protocol', 'Unsupported command protocol version.') };
    }
    if (!requestId.trim() || typeof value.command !== 'string') {
      return { rejection: this.reject(requestId, 'invalid-request', 'requestId and command are required.') };
    }
    if (!this.isCommandId(value.command)) {
      return { rejection: this.reject(requestId, 'unknown-command', `Unknown command: ${value.command}.`) };
    }
    if (value.command !== 'file.openArtifact'
      && (typeof value.documentId !== 'string' || !value.documentId)) {
      return { rejection: this.reject(requestId, 'document-required', 'An explicit documentId is required.') };
    }
    if (
      value.expectedDocumentRevision !== undefined
      && (
        typeof value.expectedDocumentRevision !== 'number'
        || !Number.isInteger(value.expectedDocumentRevision)
        || value.expectedDocumentRevision < 0
      )
    ) {
      return { rejection: this.reject(requestId, 'invalid-request', 'expectedDocumentRevision must be a non-negative integer.') };
    }
    return { value: {
      protocolVersion: LIGHTTABLE_COMMAND_PROTOCOL_VERSION,
      requestId,
      command: value.command,
      documentId: typeof value.documentId === 'string'
        ? value.documentId as DocumentSessionId
        : undefined,
      parameters: value.parameters,
      expectedDocumentRevision: value.expectedDocumentRevision as number | undefined
    } };
  }

  private isCommandId(value: string): value is LightTableCommandId {
    return [
      'view.setZoom',
      'layer.createRaster',
      'layer.rename',
      'layer.setVisibility',
      'layer.setFillOpacity',
      'layer.style.setEnabled',
      'layer.effect.setEnabled',
      'file.openArtifact',
      'file.exportNative',
      'file.exportPng',
      'history.undo',
      'history.redo'
    ].includes(value);
  }

  private isGestureKind(value: unknown): value is LightTableGestureKind {
    return value === 'brush-stroke'
      || value === 'selection-rectangle'
      || value === 'layer-translate';
  }

  private isGestureSample(value: unknown): value is LightTableGestureSample {
    return isRecord(value)
      && typeof value.x === 'number' && Number.isFinite(value.x) && Math.abs(value.x) <= 10_000_000
      && typeof value.y === 'number' && Number.isFinite(value.y) && Math.abs(value.y) <= 10_000_000
      && (value.pressure === undefined || (
        typeof value.pressure === 'number' && Number.isFinite(value.pressure)
        && value.pressure >= 0 && value.pressure <= 1
      ));
  }

  private document(documentId: DocumentSessionId): DocumentSessionSnapshot | null {
    return this.workspace.getSnapshot().documents[documentId] ?? null;
  }

  private invalidParameters(message: string) {
    return { code: 'invalid-parameters' as const, message };
  }

  private revisions(snapshot?: DocumentSessionSnapshot): LightTableRevisionSet {
    return {
      workspace: this.workspaceRevision,
      ...(snapshot ? {
        document: snapshot.documentRevision,
        historyState: snapshot.history.currentStateId
      } : {})
    };
  }

  private reject(
    requestId: string,
    code: LightTableCommandErrorCode,
    message: string,
    snapshot?: DocumentSessionSnapshot
  ): LightTableCommandResult {
    return {
      requestId,
      status: 'rejected',
      code,
      message,
      revisions: this.revisions(snapshot)
    };
  }
}

interface ParsedCommandRequest {
  readonly protocolVersion: typeof LIGHTTABLE_COMMAND_PROTOCOL_VERSION;
  readonly requestId: string;
  readonly command: LightTableCommandId;
  readonly documentId?: DocumentSessionId;
  readonly parameters: unknown;
  readonly expectedDocumentRevision?: number;
}

type DocumentParsedCommandRequest = ParsedCommandRequest & {
  readonly documentId: DocumentSessionId;
};

export interface LightTableAutomationDriver {
  beginGesture(request: unknown): Promise<LightTableGestureResult>;
  updateGesture(gestureId: string, samples: unknown): Promise<LightTableGestureResult>;
  finishGesture(gestureId: string, commit: boolean): Promise<LightTableGestureResult>;
  registerInputArtifact(file: File): LightTableArtifactMetadata;
  queryArtifact(artifactId: string): LightTableArtifactMetadata | null;
  listArtifacts(): readonly LightTableArtifactMetadata[];
  releaseArtifact(artifactId: string): boolean;
  queryTask(documentId: DocumentSessionId, taskId: string): AutomationTaskQueryResult | null;
  queryWorkspace(): WorkspaceQueryResult;
  queryDocument(documentId: DocumentSessionId): DocumentQueryResult | null;
  queryLayers(documentId: DocumentSessionId): readonly LayerQuerySummary[] | null;
  queryLayerEffects(documentId: DocumentSessionId, layerId: LayerId): LayerEffectsQueryResult | null;
  queryCapabilities(documentId: DocumentSessionId): readonly CommandCapabilitySummary[] | null;
  execute(request: unknown): Promise<LightTableCommandResult>;
}
