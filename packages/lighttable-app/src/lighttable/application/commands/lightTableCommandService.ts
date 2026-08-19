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
  type AutomationEventQueryResult, type AutomationTaskQueryResult, type CommandCapabilitySummary, type DocumentLightTableCommandPorts,
  type DocumentQueryResult, type EditableTextQueryResult, type EditableVectorQueryResult, type LayerEffectsQueryResult, type LightTableArtifactPlacement,
  type LightTableCommandErrorCode, type LightTableCommandId, type LightTableCommandPorts,
  type LightTableCommandRequest, type LightTableCommandResult, type LightTableCreateDocumentOptions,
  type LightTableGestureKind, type LightTableGestureResult, type LightTableGestureSample,
  type LightTableRevisionSet, type LightTableWorkspaceCommandPorts, type WorkspaceQueryResult
} from './lightTableCommandContract';
import { parseSemanticTextCommand, type SemanticTextCommand } from './semanticTextCommandContract';
import { parseSemanticVectorCommand, type SemanticVectorCommand } from './semanticVectorCommandContract';
import { parseSemanticLayerStyleCommand, type SemanticLayerStyleCommand } from './semanticLayerStyleCommandContract';
import { projectEditableVectorQuery } from './vectorQueryProjection';
import { parseAtomicCommandBatch, type AtomicCommandBatch } from './atomicCommandBatchContract';
import { AutomationTaskEventStore } from './automationTaskEventStore';
import { startAtomicCommandBatchTask } from './atomicCommandBatchTask';
import { isLightTableCommandId, isLightTableGestureKind, isLightTableGestureSample,
  parseCreateDocumentOptions } from './lightTableCommandValidation';
import { parseImageSizeRequest } from '../imageSize/imageSizeModel';
import { parseDocumentGeometryRequest } from '../documentGeometry/documentGeometryModel';
import { parseSemanticFaceWarpCommand, type SemanticFaceWarpCommand } from './semanticFaceWarpCommandContract';
import {
  SemanticActionRecorder,
  type ActionRecordingSnapshot
} from '../actions/semanticActionRecorder';
import {
  SemanticActionPlaybackController,
  type ActionPlaybackSnapshot
} from '../actions/semanticActionPlayback';
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

  resizeImage(documentId: DocumentSessionId, request: Parameters<NonNullable<DocumentLightTableCommandPorts['resizeImage']>>[0]) {
    const resize = this.resolve(documentId).resizeImage;
    if (!resize) throw new Error('Image Size is unavailable in the target document.');
    return resize(request);
  }

  applyDocumentGeometry(documentId: DocumentSessionId, request: Parameters<NonNullable<DocumentLightTableCommandPorts['applyDocumentGeometry']>>[0]) {
    const apply = this.resolve(documentId).applyDocumentGeometry;
    if (!apply) throw new Error('Document geometry is unavailable in the target document.');
    return apply(request);
  }

  createRasterLayer(documentId: DocumentSessionId) {
    return this.resolve(documentId).createRasterLayer();
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

  executeLayerStyleCommand(documentId: DocumentSessionId, command: SemanticLayerStyleCommand) {
    return this.resolve(documentId).executeLayerStyleCommand(command);
  }

  executeFaceWarpCommand(documentId: DocumentSessionId, command: SemanticFaceWarpCommand) {
    const execute = this.resolve(documentId).executeFaceWarpCommand;
    if (!execute) throw new Error('Face Warp commands are unavailable in the target document.');
    return execute(command);
  }

  executeAtomicBatch(documentId: DocumentSessionId, batch: AtomicCommandBatch, signal: AbortSignal,
    report: (completed: number, operationId: string) => void) {
    return this.resolve(documentId).executeAtomicBatch(batch, signal, report);
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
  private readonly taskEvents = new AutomationTaskEventStore();
  private readonly actionRecorder = new SemanticActionRecorder();
  private readonly actionPlayback = new SemanticActionPlaybackController((request) => this.execute(request));

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

  queryTaskEvents(afterCursor = 0, limit = 100): AutomationEventQueryResult {
    return this.taskEvents.query(afterCursor, limit);
  }

  subscribeTaskEvents = (listener: () => void): (() => void) => this.taskEvents.subscribe(listener);
  taskEventRevision = (): number => this.taskEvents.snapshot();
  actionRecordingSnapshot = (): ActionRecordingSnapshot => this.actionRecorder.snapshot();
  subscribeActionRecording = (listener: () => void): (() => void) => this.actionRecorder.subscribe(listener);
  startActionRecording = (name?: string): ActionRecordingSnapshot => {
    this.actionPlayback.clear();
    return this.actionRecorder.start(name);
  };
  stopActionRecording = (): ActionRecordingSnapshot => this.actionRecorder.stop();
  clearActionRecording = (): ActionRecordingSnapshot => {
    this.actionPlayback.clear();
    return this.actionRecorder.clear();
  };
  actionPlaybackSnapshot = (): ActionPlaybackSnapshot => this.actionPlayback.snapshot();
  subscribeActionPlayback = (listener: () => void): (() => void) => this.actionPlayback.subscribe(listener);
  playActionRecording = (): Promise<ActionPlaybackSnapshot> => this.actionPlayback.play(this.actionRecorder.snapshot());
  playActionStep = (sequence: number): Promise<ActionPlaybackSnapshot> => (
    this.actionPlayback.playStep(this.actionRecorder.snapshot(), sequence)
  );
  stopActionPlayback = (): void => this.actionPlayback.stop();

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
      || !isLightTableGestureKind(request.kind) || request.coordinateSpace !== 'document'
      || !isRecord(request.parameters) || !isLightTableGestureSample(request.sample)) {
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
      || !samples.every(isLightTableGestureSample)) {
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

  queryText(documentId: DocumentSessionId, layerId: LayerId): EditableTextQueryResult | null {
    const document = this.document(documentId)?.document; const layer = document ? findDocumentLayer(document, layerId) : null;
    if (!document || layer?.type !== 'text') return null;
    const source = layer.text.source;
    const text = source.kind === 'flow' ? source.text : source.extractedText ?? '';
    const availableAssets = new Set(document.assets.fonts.map(({ assetId }) => assetId));
    const styleRuns = source.kind === 'flow' ? source.styleRuns.slice(0, 128).map((run) => {
      const assetId = run.requestedFont.replacement?.replacementAsset.assetId
        ?? run.requestedFont.preferredAsset?.assetId;
      return { start: run.start, end: run.end, fontSize: run.fontSize,
        font: { families: [...run.requestedFont.families],
          ...(run.requestedFont.postScriptName ? { postScriptName: run.requestedFont.postScriptName } : {}),
          ...(assetId ? { assetId } : {}), available: Boolean(assetId && availableAssets.has(assetId)),
          substituted: Boolean(run.requestedFont.replacement) },
        fill: structuredClone(run.fill ?? null), stroke: structuredClone(run.stroke ?? null), tracking: run.tracking };
    }) : [];
    return { layerId, sourceKind: source.kind, editable: source.kind === 'flow', revision: layer.revision,
      transform: { ...layer.transform }, content: { text: text.slice(0, 4096), totalLength: text.length,
        truncated: text.length > 4096 }, layout: source.kind === 'flow' ? structuredClone(source.layout) : null,
      styleRuns, paragraphRuns: source.kind === 'flow'
        ? structuredClone(source.paragraphRuns.slice(0, 128)) : [],
      runsTruncated: source.kind === 'flow'
        && (source.styleRuns.length > 128 || source.paragraphRuns.length > 128) };
  }

  queryVector(documentId: DocumentSessionId, layerId: LayerId): EditableVectorQueryResult | null {
    const document = this.document(documentId)?.document; const layer = document ? findDocumentLayer(document, layerId) : null;
    if (layer?.type !== 'vector') return null;
    return projectEditableVectorQuery(layer, layerId);
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
      availability('document.duplicate', Boolean(this.workspacePorts), 'Document duplication is unavailable in this host.'),
      availability('document.resizeImage', Boolean(this.ports.resizeImage), 'Image Size is unavailable in this host.'),
      availability('document.applyGeometry', Boolean(this.ports.applyDocumentGeometry), 'Document geometry is unavailable in this host.'),
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
      availability('file.openArtifact', Boolean(this.workspacePorts), 'Artifact open is unavailable in this host.'),
      availability('text.create', true, ''),
      availability('text.replaceRange', true, ''),
      availability('text.format', true, ''),
      availability('text.setLayout', true, ''),
      availability('vector.create', true, ''),
      availability('vector.update', true, ''),
      availability('vector.remove', true, ''),
      availability('faceWarp.applyOperation', Boolean(this.ports.executeFaceWarpCommand),
        'Face Warp commands are unavailable in this host.'),
      availability('layer.effect.add', true, ''),
      availability('layer.effect.update', true, ''),
      availability('layer.effect.remove', true, ''),
      availability('layer.effect.move', true, ''),
      availability('command.batch', true, ''),
      availability('task.cancel', snapshot.tasks.activeTaskIds.length > 0, 'There is no running task.'),
      availability('file.exportNative', true, ''),
      availability('file.exportPng', true, ''),
      availability('file.exportPsd', true, ''),
      availability('history.undo', snapshot.history.canUndo, 'There is nothing to undo.'),
      availability('history.redo', snapshot.history.canRedo, 'There is nothing to redo.')
    ];
  }

  async execute(requestValue: unknown): Promise<LightTableCommandResult> {
    const startedAt = Date.now();
    const recordingId = this.actionRecorder.snapshot().status === 'recording'
      ? this.actionRecorder.snapshot().id
      : null;
    const parsed = this.parseRequest(requestValue);
    const result = await this.executeCommand(requestValue);
    if (!('rejection' in parsed)) this.actionRecorder.record(parsed.value, result, startedAt, recordingId);
    return result;
  }

  private async executeCommand(requestValue: unknown): Promise<LightTableCommandResult> {
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
      const options = parseCreateDocumentOptions(value.parameters);
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
    if (value.command === 'document.duplicate') {
      if (!value.documentId) {
        return this.reject(value.requestId, 'document-required', 'Duplicate requires a documentId.');
      }
      const source = this.document(value.documentId);
      if (!source) return this.reject(value.requestId, 'document-not-found', 'The source document is not open.');
      if (source.lifecycle !== 'ready' || !source.document) {
        return this.reject(value.requestId, 'document-not-ready', 'The source document is not ready.', source);
      }
      if (!this.workspacePorts) {
        return this.reject(value.requestId, 'command-unavailable', 'Document duplication is unavailable in this host.', source);
      }
      if (!isRecord(value.parameters) || typeof value.parameters.name !== 'string'
        || !value.parameters.name.trim() || value.parameters.name.trim().length > 255
        || /[\u0000-\u001f\u007f]/.test(value.parameters.name)) {
        return this.reject(value.requestId, 'invalid-parameters', 'Duplicate requires a valid document name.', source);
      }
      try {
        const documentId = await this.workspacePorts.duplicateDocument(value.documentId, value.parameters.name.trim());
        return { requestId: value.requestId, status: 'completed', value: { documentId }, revisions: this.revisions() };
      } catch (reason) {
        return this.reject(value.requestId, 'execution-failed', reason instanceof Error ? reason.message : String(reason), source);
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

    if (value.command === 'task.cancel') {
      if (!isRecord(value.parameters) || typeof value.parameters.taskId !== 'string') {
        return this.reject(value.requestId, 'invalid-parameters', 'Cancel requires a taskId.', snapshot);
      }
      const existing = this.queryTask(documentRequest.documentId, value.parameters.taskId);
      if (!existing || existing.status !== 'running') {
        return this.reject(value.requestId, 'command-unavailable', 'The task is not running.', snapshot);
      }
      this.workspace.getDocument(documentRequest.documentId)?.tasks.cancel(value.parameters.taskId);
      return { requestId: value.requestId, status: 'completed', value: { taskId: value.parameters.taskId },
        revisions: this.revisions(snapshot) };
    }

    if (value.command === 'command.batch') {
      const batch = parseAtomicCommandBatch(value.parameters);
      if (!batch) return this.reject(value.requestId, 'invalid-parameters',
        'Batch name, timeout, operations, identifiers or byte limits are invalid.', snapshot);
      const session = this.workspace.getDocument(documentRequest.documentId)!;
      const taskId = startAtomicCommandBatchTask(session, this.ports, batch, this.taskEvents);
      if (!taskId) return this.reject(value.requestId, 'execution-failed', 'The batch task did not start.', snapshot);
      return { requestId: value.requestId, status: 'accepted', taskId, revisions: this.revisions(snapshot) };
    }

    if (value.command === 'document.resizeImage') {
      const resize = parseImageSizeRequest(value.parameters);
      if ('message' in resize) {
        return this.reject(value.requestId, 'invalid-parameters', resize.message, snapshot);
      }
      if (!this.ports.resizeImage) {
        return this.reject(value.requestId, 'command-unavailable', 'Image Size is unavailable in this host.', snapshot);
      }
      try {
        await this.ports.resizeImage(documentRequest.documentId, resize);
        this.workspace.getDocument(documentRequest.documentId)?.markChanged();
        return { requestId: value.requestId, status: 'completed', value: {
          width: resize.width, height: resize.height, resolutionPpi: resize.resolutionPpi
        }, revisions: this.revisions(this.document(documentRequest.documentId) ?? snapshot) };
      } catch (reason) {
        return this.reject(value.requestId, 'execution-failed', reason instanceof Error ? reason.message : String(reason), snapshot);
      }
    }

    if (value.command === 'document.applyGeometry') {
      const geometry = parseDocumentGeometryRequest(value.parameters);
      if ('message' in geometry) {
        return this.reject(value.requestId, 'invalid-parameters', geometry.message, snapshot);
      }
      if (!this.ports.applyDocumentGeometry) {
        return this.reject(value.requestId, 'command-unavailable', 'Document geometry is unavailable in this host.', snapshot);
      }
      try {
        await this.ports.applyDocumentGeometry(documentRequest.documentId, geometry);
        this.workspace.getDocument(documentRequest.documentId)?.markChanged();
        return { requestId: value.requestId, status: 'completed', value: { operation: geometry.operation },
          revisions: this.revisions(this.document(documentRequest.documentId) ?? snapshot) };
      } catch (reason) {
        return this.reject(value.requestId, 'execution-failed', reason instanceof Error ? reason.message : String(reason), snapshot);
      }
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

    if (value.command === 'text.create' || value.command === 'text.replaceRange'
      || value.command === 'text.format' || value.command === 'text.setLayout') {
      const kind = value.command === 'text.create' ? 'create'
        : value.command === 'text.replaceRange' ? 'replace'
          : value.command === 'text.format' ? 'format' : 'layout';
      const command = parseSemanticTextCommand(kind, value.parameters);
      if ('message' in command) return this.reject(value.requestId, 'invalid-parameters', command.message, snapshot);
      if ('layerId' in command) {
        const layer = findDocumentLayer(snapshot.document, command.layerId as LayerId);
        if (layer?.type !== 'text') return this.reject(value.requestId, 'command-unavailable', 'The target text layer does not exist.', snapshot);
        if (layer.text.source.kind !== 'flow') return this.reject(value.requestId, 'command-unavailable',
          'Positioned imported text must be recovered as editable flow text before editing.', snapshot);
        const length = layer.text.source.text.length;
        const ranged = command.kind === 'replace' || command.kind === 'format';
        if (ranged && ((command.start ?? 0) > length || (command.end ?? length) > length))
          return this.reject(value.requestId, 'invalid-parameters', 'The text range exceeds the current content.', snapshot);
      }
      try {
        const result = await this.ports.executeTextCommand(documentRequest.documentId, command);
        if (!result) return this.reject(value.requestId, 'execution-failed', 'The text command did not change the document.', snapshot);
        this.workspace.getDocument(documentRequest.documentId)?.markChanged();
        return { requestId: value.requestId, status: 'completed', value: result,
          revisions: this.revisions(this.document(documentRequest.documentId) ?? snapshot) };
      } catch (reason) {
        return this.reject(value.requestId, 'execution-failed', reason instanceof Error ? reason.message : String(reason), snapshot);
      }
    }

    if (value.command === 'vector.create' || value.command === 'vector.update' || value.command === 'vector.remove') {
      const kind = value.command === 'vector.create' ? 'create' : value.command === 'vector.update' ? 'update' : 'remove';
      const command = parseSemanticVectorCommand(kind, value.parameters);
      if ('message' in command) return this.reject(value.requestId, 'invalid-parameters', command.message, snapshot);
      try {
        const result = await this.ports.executeVectorCommand(documentRequest.documentId, command);
        if (!result) return this.reject(value.requestId, 'execution-failed', 'The vector command did not change the document.', snapshot);
        this.workspace.getDocument(documentRequest.documentId)?.markChanged();
        return { requestId: value.requestId, status: 'completed', value: result,
          revisions: this.revisions(this.document(documentRequest.documentId) ?? snapshot) };
      } catch (reason) {
        return this.reject(value.requestId, 'execution-failed', reason instanceof Error ? reason.message : String(reason), snapshot);
      }
    }

    if (value.command === 'faceWarp.applyOperation') {
      const command = parseSemanticFaceWarpCommand(value.parameters);
      if ('message' in command) return this.reject(value.requestId, 'invalid-parameters', command.message, snapshot);
      if (!this.ports.executeFaceWarpCommand) {
        return this.reject(value.requestId, 'command-unavailable', 'Face Warp commands are unavailable in this host.', snapshot);
      }
      try {
        const result = await this.ports.executeFaceWarpCommand(documentRequest.documentId, command);
        if (!result) return this.reject(value.requestId, 'command-unavailable',
          'The target Face Warp layer, face or editable operation is unavailable.', snapshot);
        this.workspace.getDocument(documentRequest.documentId)?.markChanged();
        return { requestId: value.requestId, status: 'completed', value: result,
          revisions: this.revisions(this.document(documentRequest.documentId) ?? snapshot) };
      } catch (reason) {
        return this.reject(value.requestId, 'execution-failed', reason instanceof Error ? reason.message : String(reason), snapshot);
      }
    }

    if (value.command === 'layer.effect.add' || value.command === 'layer.effect.update'
      || value.command === 'layer.effect.remove' || value.command === 'layer.effect.move') {
      const kind = value.command.slice('layer.effect.'.length) as SemanticLayerStyleCommand['kind'];
      const command = parseSemanticLayerStyleCommand(kind, value.parameters);
      if ('message' in command) return this.reject(value.requestId, 'invalid-parameters', command.message, snapshot);
      try {
        const result = await this.ports.executeLayerStyleCommand(documentRequest.documentId, command);
        if (!result) return this.reject(value.requestId, 'execution-failed', 'The Layer Style command did not change the document.', snapshot);
        this.workspace.getDocument(documentRequest.documentId)?.markChanged();
        return { requestId: value.requestId, status: 'completed', value: result,
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
      const exported = await operation(request.documentId);
      task.throwIfCanceled();
      const file = exported instanceof File ? exported : exported.file;
      const findings = psd && !(exported instanceof File) ? exported.findings : [];
      return this.artifacts.register(file, kind, findings);
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
      case 'layer.createRaster': {
        if (!isRecord(parameters) || Object.keys(parameters).length > 0) {
          return this.invalidParameters('Create raster parameters must be an empty object.');
        }
        const beforeIds = new Set(walkLayerTree(snapshot.document!.layers).map(({ node }) => node.id));
        await this.ports.createRasterLayer(request.documentId);
        const after = this.document(request.documentId)?.document;
        const created = after
          ? walkLayerTree(after.layers).find(({ node }) => !beforeIds.has(node.id))?.node ?? null
          : null;
        return { value: { created: true, layerId: created?.id ?? null } };
      }
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
    if (!isLightTableCommandId(value.command)) {
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
  queryTaskEvents(afterCursor?: number, limit?: number): AutomationEventQueryResult;
  queryWorkspace(): WorkspaceQueryResult;
  queryDocument(documentId: DocumentSessionId): DocumentQueryResult | null;
  queryLayers(documentId: DocumentSessionId): readonly LayerQuerySummary[] | null;
  queryLayerEffects(documentId: DocumentSessionId, layerId: LayerId): LayerEffectsQueryResult | null;
  queryText(documentId: DocumentSessionId, layerId: LayerId): EditableTextQueryResult | null;
  queryVector(documentId: DocumentSessionId, layerId: LayerId): EditableVectorQueryResult | null;
  queryCapabilities(documentId: DocumentSessionId): readonly CommandCapabilitySummary[] | null;
  queryRenderTelemetry?(documentId: DocumentSessionId): RenderTelemetrySnapshot | null;
  resetRenderTelemetry?(documentId: DocumentSessionId): boolean;
  execute(request: unknown): Promise<LightTableCommandResult>;
}
