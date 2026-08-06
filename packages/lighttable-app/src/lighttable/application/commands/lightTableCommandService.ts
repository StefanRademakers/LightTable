import type { DocumentSessionId, DocumentSessionSnapshot, DocumentViewport } from '../documents/documentSession';
import type { WorkspaceSession } from '../workspace/workspaceSession';
import type { LayerId, LayerNode } from '../../editor/document/documentTypes';
import type { LayerStyleId, LayerStyleInstance, LayerStyleKind } from '../../editor/styles/layerStyleTypes';
import type { RenderTelemetrySnapshot } from '../rendering/renderTelemetry';
import { findDocumentLayer, walkLayerTree } from '../../editor/document/layerTree';
import { queryLayerCommandCapabilities } from '../layers/layerCommandCapabilities';
import {
  LightTableArtifactRegistry,
  type LightTableArtifactKind,
  type LightTableArtifactMetadata
} from './lightTableArtifactRegistry';
import {
  projectLayerQuery,
  type LayerQuerySummary
} from './layerQueryProjection';
export type { LayerQuerySummary } from './layerQueryProjection';
import {
  LIGHTTABLE_COMMAND_PROTOCOL_VERSION,
  type AutomationTaskQueryResult, type CommandCapabilitySummary, type DocumentLightTableCommandPorts,
  type DocumentQueryResult, type LayerEffectsQueryResult, type LightTableArtifactPlacement,
  type LightTableCommandErrorCode, type LightTableCommandId, type LightTableCommandPorts,
  type LightTableCommandRequest, type LightTableCommandResult, type LightTableCreateDocumentOptions,
  type LightTableGestureKind, type LightTableGestureResult, type LightTableGestureSample,
  type LightTableRevisionSet, type LightTableWorkspaceCommandPorts, type WorkspaceQueryResult
} from './lightTableCommandContract';
export * from './lightTableCommandContract';

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

  placeArtifact(documentId: DocumentSessionId, file: File, placement: LightTableArtifactPlacement) {
    return this.resolve(documentId).placeArtifact(file, placement);
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

  exportPsdArtifact(documentId: DocumentSessionId) {
    return this.resolve(documentId).exportPsdArtifact();
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

  queryRenderTelemetry(documentId: DocumentSessionId) {
    return this.resolve(documentId).queryRenderTelemetry?.() ?? null;
  }

  resetRenderTelemetry(documentId: DocumentSessionId) {
    this.resolve(documentId).resetRenderTelemetry?.();
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

  /** Host-local binary access for the explicitly enabled automation bridge. */
  resolveArtifact(artifactId: string): File | null {
    return this.artifacts.resolve(artifactId);
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

  queryRenderTelemetry(documentId: DocumentSessionId): RenderTelemetrySnapshot | null {
    return this.document(documentId)?.lifecycle === 'ready'
      ? this.ports.queryRenderTelemetry?.(documentId) ?? null
      : null;
  }

  resetRenderTelemetry(documentId: DocumentSessionId): boolean {
    if (this.document(documentId)?.lifecycle !== 'ready' || !this.ports.resetRenderTelemetry) {
      return false;
    }
    this.ports.resetRenderTelemetry(documentId);
    return true;
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
    if (finished && commit) this.workspace.getDocument(gesture.documentId)?.markChanged();
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
        estimatedBytes: document.history.estimatedBytes,
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
    return walkLayerTree(canonical.layers).map(({ node, parentId, path }) =>
      projectLayerQuery(node, parentId, path.length - 1));
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
        blendMode: effect.blendMode,
        settings: structuredClone(effect)
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
      availability('document.create', Boolean(this.workspacePorts), 'Document creation is unavailable in this host.'),
      availability('view.setZoom', true, ''),
      availability('layer.createRaster', true, ''),
      availability('layer.placeArtifact', true, ''),
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
      availability('file.exportPsd', true, ''),
      availability('history.undo', snapshot.history.canUndo, 'There is nothing to undo.'),
      availability('history.redo', snapshot.history.canRedo, 'There is nothing to redo.')
    ];
  }

  async execute(requestValue: unknown): Promise<LightTableCommandResult> {
    const request = this.parseRequest(requestValue);
    if ('rejection' in request) return request.rejection;
    const { value } = request;
    if (value.expectedWorkspaceRevision !== undefined
      && value.expectedWorkspaceRevision !== this.workspaceRevision) {
      return this.reject(
        value.requestId,
        'stale-workspace-revision',
        `Expected workspace revision ${value.expectedWorkspaceRevision}, current revision is ${this.workspaceRevision}.`
      );
    }
    if (value.command === 'document.create') {
      const options = this.parseCreateDocumentOptions(value.parameters);
      if ('message' in options) return this.reject(value.requestId, 'invalid-parameters', options.message);
      if (!this.workspacePorts) {
        return this.reject(value.requestId, 'command-unavailable', 'Document creation is unavailable in this host.');
      }
      try {
        const documentId = await this.workspacePorts.createDocument(options);
        return { requestId: value.requestId, status: 'completed', value: { documentId }, revisions: this.revisions() };
      } catch (reason) {
        return this.reject(value.requestId, 'execution-failed', reason instanceof Error ? reason.message : String(reason));
      }
    }
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

    if (value.command === 'file.exportNative' || value.command === 'file.exportPng'
      || value.command === 'file.exportPsd') {
      if (!isRecord(value.parameters) || Object.keys(value.parameters).length > 0) {
        return this.reject(value.requestId, 'invalid-parameters', 'Export parameters must be an empty object.', snapshot);
      }
      return this.startArtifactExport(documentRequest, snapshot);
    }

    if (value.command === 'layer.placeArtifact') {
      if (!isRecord(value.parameters) || typeof value.parameters.artifactId !== 'string') {
        return this.reject(value.requestId, 'invalid-parameters', 'Place requires an artifactId.', snapshot);
      }
      const file = this.artifacts.resolve(value.parameters.artifactId);
      if (!file) return this.reject(value.requestId, 'command-unavailable', 'The input artifact does not exist.', snapshot);
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size < 1
        || file.size > 512 * 1024 * 1024) {
        return this.reject(value.requestId, 'invalid-parameters', 'Place supports PNG, JPEG and WebP artifacts up to 512 MiB.', snapshot);
      }
      const finiteOptional = (entry: unknown) => entry === undefined
        || (typeof entry === 'number' && Number.isFinite(entry) && Math.abs(entry) <= 10_000_000);
      if (!finiteOptional(value.parameters.x) || !finiteOptional(value.parameters.y)
        || (value.parameters.name !== undefined && (typeof value.parameters.name !== 'string'
          || !value.parameters.name.trim() || value.parameters.name.trim().length > 255))) {
        return this.reject(value.requestId, 'invalid-parameters', 'Placement name and coordinates are invalid.', snapshot);
      }
      const placement: LightTableArtifactPlacement = {
        ...(typeof value.parameters.name === 'string' ? { name: value.parameters.name } : {}),
        ...(typeof value.parameters.x === 'number' ? { x: value.parameters.x } : {}),
        ...(typeof value.parameters.y === 'number' ? { y: value.parameters.y } : {})
      };
      try {
        const placed = await this.ports.placeArtifact(documentRequest.documentId, file, placement);
        if (!placed) return this.reject(value.requestId, 'execution-failed', 'The image could not be placed.', snapshot);
        this.workspace.getDocument(documentRequest.documentId)?.markChanged();
        return { requestId: value.requestId, status: 'completed', value: placed,
          revisions: this.revisions(this.document(documentRequest.documentId) ?? snapshot) };
      } catch (reason) {
        return this.reject(value.requestId, 'execution-failed', reason instanceof Error ? reason.message : String(reason), snapshot);
      }
    }

    try {
      const result = await this.executeParsed(documentRequest, snapshot);
      if ('code' in result) return this.reject(value.requestId, result.code, result.message, snapshot);
      if (value.command !== 'view.setZoom') {
        this.workspace.getDocument(documentRequest.documentId)?.markChanged();
      }
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
    const psd = request.command === 'file.exportPsd';
    const operation = native ? this.ports.exportNativeArtifact.bind(this.ports)
      : psd ? this.ports.exportPsdArtifact.bind(this.ports)
        : this.ports.exportPngArtifact.bind(this.ports);
    const kind: LightTableArtifactKind = native ? 'native-document'
      : psd ? 'psd-export' : 'png-export';
    const running = session.tasks.run('export', native ? 'Export native document'
      : psd ? 'Export Photoshop artifact' : 'Export PNG artifact', async (task) => {
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
    if (value.command !== 'file.openArtifact' && value.command !== 'document.create'
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
    if (value.expectedWorkspaceRevision !== undefined && (
      typeof value.expectedWorkspaceRevision !== 'number'
      || !Number.isInteger(value.expectedWorkspaceRevision)
      || value.expectedWorkspaceRevision < 0
    )) {
      return { rejection: this.reject(requestId, 'invalid-request', 'expectedWorkspaceRevision must be a non-negative integer.') };
    }
    return { value: {
      protocolVersion: LIGHTTABLE_COMMAND_PROTOCOL_VERSION,
      requestId,
      command: value.command,
      documentId: typeof value.documentId === 'string'
        ? value.documentId as DocumentSessionId
        : undefined,
      parameters: value.parameters,
      expectedDocumentRevision: value.expectedDocumentRevision as number | undefined,
      expectedWorkspaceRevision: value.expectedWorkspaceRevision as number | undefined
    } };
  }

  private isCommandId(value: string): value is LightTableCommandId {
    return [
      'document.create',
      'view.setZoom',
      'layer.createRaster',
      'layer.placeArtifact',
      'layer.rename',
      'layer.setVisibility',
      'layer.setFillOpacity',
      'layer.style.setEnabled',
      'layer.effect.setEnabled',
      'file.openArtifact',
      'file.exportNative',
      'file.exportPng',
      'file.exportPsd',
      'history.undo',
      'history.redo'
    ].includes(value);
  }

  private isGestureKind(value: unknown): value is LightTableGestureKind {
    return value === 'brush-stroke'
      || value === 'selection-rectangle'
      || value === 'layer-translate';
  }

  private parseCreateDocumentOptions(value: unknown): LightTableCreateDocumentOptions | { message: string } {
    if (!isRecord(value)) return { message: 'Create document parameters must be an object.' };
    const { width, height, resolutionPpi, bitDepth, profile, background } = value;
    if (!Number.isInteger(width) || !Number.isInteger(height)
      || Number(width) < 1 || Number(height) < 1 || Number(width) > 32_768 || Number(height) > 32_768
      || Number(width) * Number(height) > 268_435_456) {
      return { message: 'Document dimensions must be 1-32768 px and at most 268435456 pixels.' };
    }
    if (typeof resolutionPpi !== 'number' || !Number.isFinite(resolutionPpi)
      || resolutionPpi < 1 || resolutionPpi > 2_400) {
      return { message: 'Document resolution must be between 1 and 2400 ppi.' };
    }
    if (bitDepth !== 8 && bitDepth !== 16) return { message: 'Document bitDepth must be 8 or 16.' };
    if (profile !== 'srgb' && profile !== 'adobe-rgb-1998') return { message: 'Document profile is unsupported.' };
    if (!isRecord(background) || (background.kind !== 'transparent' && background.kind !== 'solid')
      || (background.kind === 'solid' && (typeof background.color !== 'string'
        || !/^#[0-9a-f]{6}$/i.test(background.color)))) {
      return { message: 'Background must be transparent or a solid #RRGGBB color.' };
    }
    const name = typeof value.name === 'string' && value.name.trim() ? value.name.trim() : 'Untitled';
    if (name.length > 255) return { message: 'Document name must not exceed 255 characters.' };
    return { name, width: Number(width), height: Number(height), resolutionPpi,
      bitDepth, profile, background: background as LightTableCreateDocumentOptions['background'] };
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
  readonly expectedWorkspaceRevision?: number;
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
  resolveArtifact(artifactId: string): File | null;
  listArtifacts(): readonly LightTableArtifactMetadata[];
  releaseArtifact(artifactId: string): boolean;
  queryTask(documentId: DocumentSessionId, taskId: string): AutomationTaskQueryResult | null;
  queryWorkspace(): WorkspaceQueryResult;
  queryDocument(documentId: DocumentSessionId): DocumentQueryResult | null;
  queryLayers(documentId: DocumentSessionId): readonly LayerQuerySummary[] | null;
  queryLayerEffects(documentId: DocumentSessionId, layerId: LayerId): LayerEffectsQueryResult | null;
  queryCapabilities(documentId: DocumentSessionId): readonly CommandCapabilitySummary[] | null;
  queryRenderTelemetry?(documentId: DocumentSessionId): RenderTelemetrySnapshot | null;
  resetRenderTelemetry?(documentId: DocumentSessionId): boolean;
  execute(request: unknown): Promise<LightTableCommandResult>;
}
