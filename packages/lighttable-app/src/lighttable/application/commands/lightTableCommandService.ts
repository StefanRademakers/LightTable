import type { DocumentSessionId, DocumentSessionSnapshot, DocumentViewport } from '../documents/documentSession';
import {
  LIGHTTABLE_COMMAND_SCHEMAS,
  formatSchemaValidationIssues,
  validateJsonSchemaValue
} from '@lighttable/command-contract';
import type { WorkspaceSession } from '../workspace/workspaceSession';
import { layerIsLocked, type LayerId, type LayerNode } from '../../editor/document/documentTypes';
import type { LayerStyleId, LayerStyleInstance, LayerStyleKind } from '../../editor/styles/layerStyleTypes';
import type { RenderTelemetrySnapshot } from '../rendering/renderTelemetry';
import { findDocumentLayer, siblingLayers, walkLayerTree } from '../../editor/document/layerTree';
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
import { projectLayerListPage, type LayerListQueryResult } from './layerListQuery';
export type { LayerListQueryResult } from './layerListQuery';
import { projectLayerDetailQuery, type LayerDetailQueryResult } from './layerDetailQuery';
export type { LayerDetailQueryResult } from './layerDetailQuery';
import {
  LIGHTTABLE_COMMAND_PROTOCOL_VERSION,
  type AutomationEventQueryResult, type AutomationTaskQueryResult, type CommandCapabilitySummary,
  type DocumentQueryResult, type EditableTextQueryResult, type EditableVectorQueryResult, type LayerEffectsQueryResult, type LightTableArtifactPlacement,
  type LightTableCommandErrorCode, type LightTableCommandId, type LightTableCommandPorts,
  type LightTableCommandExecutionContext, type LightTableCommandRequest, type LightTableCommandResult,
  type LightTableCreateDocumentOptions,
  type LightTableGradeClipboardCapture,
  type LightTableGestureKind, type LightTableGestureResult, type LightTableGestureSample,
  type LightTableRevisionSet, type LightTableWorkspaceCommandPorts, type WorkspaceQueryResult
} from './lightTableCommandContract';
import { parseSemanticTextCommand } from './semanticTextCommandContract';
import { parseSemanticVectorCommand } from './semanticVectorCommandContract';
import { observedCommandParametersAreValid } from './observedCommandValidation';
import { dispatchSemanticWarpStroke } from './semanticWarpCommandHandler';
import { dispatchSemanticFill } from './semanticFillCommandHandler';
import { dispatchSemanticAdjustmentCreation, dispatchSemanticFixedTransform,
  dispatchSemanticRasterInvert } from './semanticContextualEditDispatcher';
import { projectCommandCapabilities } from './commandCapabilityProjection';
import { dispatchSemanticTextFinalization } from './semanticTextFinalizationDispatcher';
import { dispatchSemanticMergeFlatten } from './semanticMergeFlattenDispatcher';
import { dispatchSemanticRasterGradient } from './semanticRasterGradientCommandHandler';
import { parseSemanticLayerStyleCommand, type SemanticLayerStyleCommand } from './semanticLayerStyleCommandContract';
import { projectEditableVectorQuery } from './vectorQueryProjection';
import { projectWarpQuery, type WarpQueryResult } from './warpQueryProjection';
import { parseAtomicCommandBatch } from './atomicCommandBatchContract';
import { AutomationTaskEventStore } from './automationTaskEventStore';
import {
  AutomationPublicationEventStore,
  projectAutomationPublicationEvents,
  type AutomationPublicationEventQueryResult,
  type AutomationPublicationEventWaitResult
} from './automationPublicationEventStore';
import { startAtomicCommandBatchTask } from './atomicCommandBatchTask';
import { isLightTableCommandId, isLightTableGestureKind, isLightTableGestureSample,
  parseCommittedGestureRequest, parseCreateDocumentOptions } from './lightTableCommandValidation';
import { parseImageSizeRequest } from '../imageSize/imageSizeModel';
import { commandScope } from './commandRequestScope';
import { parseDocumentGeometryRequest } from '../documentGeometry/documentGeometryModel';
import { parseSemanticAssignProfileCommand } from './semanticDocumentColorCommandContract';
import { SemanticPixelClipboardCommandHandler } from './semanticPixelClipboardCommandHandler';
import { SemanticGradeClipboardCommandHandler } from './semanticGradeClipboardCommandHandler';
import { parseSemanticFaceWarpCommand } from './semanticFaceWarpCommandContract';
import { parseSemanticLayerCommand } from './semanticLayerCommandContract';
import { parseSemanticSelectionCommand } from './semanticSelectionCommandContract';
import { startSemanticAutomationTask } from './semanticAutomationTaskDispatcher';
import {
  parseSemanticBasicAdjustmentCommand,
  parseBasicAdjustmentTarget
} from './semanticBasicAdjustmentCommandContract';
import { parseSemanticDetailAdjustmentCommand } from './semanticDetailAdjustmentCommandContract';
import type { BasicGradeQueryResult } from '../adjustments/basicAdjustmentQuery';
import {
  parseAdjustmentQueryTarget,
  type AdjustmentQueryResult
} from '../adjustments/adjustmentQuery';
import type { ActionRecordingSnapshot } from '../actions/semanticActionRecorder';
import type { ActionPlaybackSnapshot, ActionTaskPlaybackPort } from '../actions/semanticActionPlayback';
import type {
  SemanticActionLibrarySnapshot,
  SemanticActionLibraryStorage
} from '../actions/semanticActionLibrary';
import { SemanticActionWorkflowController } from '../actions/semanticActionWorkflowController';
import {
  DocumentPreviewArtifactController,
  type DocumentPreviewResult
} from './documentPreviewArtifacts';
import { LayerPreviewArtifactController, type LayerPreviewResult } from './layerPreviewArtifacts';
import type { PaletteColor } from '../color/documentPalette';
export type { LayerPreviewResult } from './layerPreviewArtifacts';
export * from './lightTableCommandContract';

export { LightTableCommandPortRegistry } from './lightTableCommandPortRegistry';

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const AUTOMATION_GESTURE_LEASE_MS = 30_000;
const ACTION_TASK_TIMEOUT_MS = 120_000;
const OBSERVED_STATE_ONLY_COMMANDS = new Set<LightTableCommandId>([
  'view.setZoom',
  'selection.applyShape',
  'selection.applyMagicWand',
  'selection.selectSubject',
  'selection.modify'
]);
const traceObservedCommand = (command: LightTableCommandId, accepted: boolean, reason: string) => {
  const trace = (globalThis as typeof globalThis & {
    __LIGHTTABLE_COMMAND_OBSERVATION_TRACE__?: Array<{
      command: string; accepted: boolean; reason: string;
    }>;
  }).__LIGHTTABLE_COMMAND_OBSERVATION_TRACE__;
  trace?.push({ command, accepted, reason });
  return accepted;
};

/**
 * Transport-neutral read/query and bounded command registry.
 *
 * It exposes serializable projections only. Existing application controllers
 * remain mutation authority through the injected ports; this service never
 * edits React state, document objects or GPU resources itself.
 */
export class LightTableCommandService {
  private readonly pixelClipboardCommands: SemanticPixelClipboardCommandHandler;
  private readonly gradeClipboardCommands: SemanticGradeClipboardCommandHandler;
  private workspaceRevision = 1;
  private readonly unsubscribe: () => void;
  private readonly taskArtifacts = new Map<string, LightTableArtifactMetadata>();
  private readonly gestures = new Map<string, {
    readonly documentId: DocumentSessionId;
    readonly kind: LightTableGestureKind;
    readonly pointerId: number;
    sampleCount: number;
    lease: ReturnType<typeof setTimeout>;
  }>();
  private gestureSequence = 0;
  private readonly executingDocumentCommands = new Map<DocumentSessionId, number>();
  private readonly taskEvents = new AutomationTaskEventStore();
  private readonly publicationEvents = new AutomationPublicationEventStore();
  private readonly actions: SemanticActionWorkflowController;
  private readonly documentPreviews = new DocumentPreviewArtifactController({
    snapshot: (documentId) => {
      const snapshot = this.document(documentId);
      return snapshot?.document ? {
        lifecycle: snapshot.lifecycle,
        canonicalRevision: snapshot.documentRevision,
        width: snapshot.document.width,
        height: snapshot.document.height
      } : null;
    },
    render: async (documentId, maxEdge, encoding, region) => (
      this.ports.exportPreviewArtifact(documentId, maxEdge, encoding, region)
    ),
    register: (file, context) => this.artifacts.registerPreview(file, context),
    query: (artifactId) => this.artifacts.query(artifactId)
  });
  private readonly layerPreviews = new LayerPreviewArtifactController({
    snapshot: (documentId, layerId) => {
      const snapshot = this.document(documentId);
      const layer = snapshot?.document ? findDocumentLayer(snapshot.document, layerId) : null;
      return snapshot?.document ? {
        lifecycle: snapshot.lifecycle, canonicalRevision: snapshot.documentRevision,
        layerExists: Boolean(layer), hasMask: Boolean(layer?.mask)
      } : null;
    },
    render: async (documentId, layerId, channel, maxEdge, encoding) => (
      this.ports.exportLayerPreviewArtifact(documentId, layerId, channel, maxEdge, encoding)
    ),
    register: (file, context) => this.artifacts.registerPreview(file, context),
    query: (artifactId) => this.artifacts.query(artifactId)
  });
  constructor(
    private readonly workspace: WorkspaceSession,
    private readonly ports: LightTableCommandPorts,
    private readonly workspacePorts?: LightTableWorkspaceCommandPorts,
    private readonly artifacts = new LightTableArtifactRegistry(),
    actionLibraryStorage?: SemanticActionLibraryStorage
  ) {
    this.actions = new SemanticActionWorkflowController({
      execute: (request) => this.execute(request, { origin: 'actions-playback', recording: 'ignore' }),
      activeDocumentId: () => this.workspace.getSnapshot().activeDocumentId ?? undefined,
      tasks: { wait: (documentId, taskId, signal, onProgress) =>
        this.waitForActionTask(documentId as DocumentSessionId, taskId, signal, onProgress) }
    }, actionLibraryStorage);
    this.pixelClipboardCommands = new SemanticPixelClipboardCommandHandler(this.artifacts);
    this.gradeClipboardCommands = new SemanticGradeClipboardCommandHandler(this.artifacts);
    let previousWorkspace = workspace.getSnapshot();
    this.unsubscribe = workspace.subscribe(() => {
      const currentWorkspace = workspace.getSnapshot();
      this.publicationEvents.appendAll(projectAutomationPublicationEvents(
        previousWorkspace, currentWorkspace
      ));
      previousWorkspace = currentWorkspace;
      this.workspaceRevision += 1;
      for (const [gestureId, gesture] of this.gestures) {
        const document = this.workspace.getDocument(gesture.documentId)?.getSnapshot();
        if (!document || document.lifecycle !== 'ready') void this.finishGesture(gestureId, false);
      }
    });
  }

  dispose(): void {
    this.unsubscribe();
    this.actions.dispose();
    this.publicationEvents.dispose();
    void this.cancelAllGestures();
    this.artifacts.clear();
    this.taskArtifacts.clear();
    this.documentPreviews.clear();
    this.layerPreviews.clear();
  }

  registerInputArtifact(file: File): LightTableArtifactMetadata { return this.artifacts.register(file, 'input'); }
  registerPixelClipboardArtifact(file: File): LightTableArtifactMetadata { return this.pixelClipboardCommands.register(file); }
  registerGradeClipboardArtifact(capture: LightTableGradeClipboardCapture): LightTableArtifactMetadata {
    return this.gradeClipboardCommands.register(capture);
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
    this.documentPreviews.invalidateArtifact(artifactId);
    this.layerPreviews.invalidateArtifact(artifactId);
    return this.artifacts.release(artifactId);
  }

  requestDocumentPreview(request: unknown): Promise<DocumentPreviewResult> {
    return this.documentPreviews.request(request);
  }

  requestLayerPreview(request: unknown): Promise<LayerPreviewResult> {
    return this.layerPreviews.request(request);
  }

  async requestDocumentPalette(request: unknown): Promise<{
    readonly status: 'completed'; readonly documentId: DocumentSessionId;
    readonly canonicalRevision: number; readonly colors: readonly PaletteColor[];
  } | { readonly status: 'rejected'; readonly code: string; readonly message: string;
    readonly currentRevision?: number }> {
    if (!isRecord(request) || typeof request.documentId !== 'string'
      || !Number.isSafeInteger(request.expectedDocumentRevision)
      || (request.expectedDocumentRevision as number) < 0
      || !Number.isInteger(request.colorCount) || (request.colorCount as number) < 1
      || (request.colorCount as number) > 256) {
      return { status: 'rejected', code: 'invalid-request',
        message: 'Palette requires documentId, expectedDocumentRevision and colorCount 1-256.' };
    }
    const documentId = request.documentId as DocumentSessionId;
    const expectedRevision = request.expectedDocumentRevision as number;
    const opening = this.document(documentId);
    if (!opening?.document || opening.lifecycle !== 'ready') return {
      status: 'rejected', code: 'document-not-ready', message: 'The palette document is not ready.'
    };
    if (opening.documentRevision !== expectedRevision) return {
      status: 'rejected', code: 'stale-document-revision', message: 'The expected document revision is stale.',
      currentRevision: opening.documentRevision
    };
    if (!this.ports.getDocumentPalette) return { status: 'rejected', code: 'renderer-unavailable',
      message: 'Document palette extraction is unavailable.' };
    const colors = await this.ports.getDocumentPalette(documentId, request.colorCount as number);
    const closing = this.document(documentId);
    if (!closing?.document || closing.documentRevision !== expectedRevision) return {
      status: 'rejected', code: 'stale-document-revision',
      message: 'The document changed while its palette was extracted.',
      ...(closing ? { currentRevision: closing.documentRevision } : {})
    };
    return { status: 'completed', documentId, canonicalRevision: expectedRevision, colors };
  }

  async requestLayerPalette(request: unknown): Promise<{
    readonly status: 'completed'; readonly documentId: DocumentSessionId; readonly layerId: LayerId;
    readonly canonicalRevision: number; readonly colors: readonly PaletteColor[];
  } | { readonly status: 'rejected'; readonly code: string; readonly message: string;
    readonly currentRevision?: number }> {
    if (!isRecord(request) || typeof request.documentId !== 'string'
      || typeof request.layerId !== 'string'
      || !Number.isSafeInteger(request.expectedDocumentRevision)
      || (request.expectedDocumentRevision as number) < 0
      || !Number.isInteger(request.colorCount) || (request.colorCount as number) < 1
      || (request.colorCount as number) > 256) {
      return { status: 'rejected', code: 'invalid-request',
        message: 'Layer palette requires documentId, layerId, expectedDocumentRevision and colorCount 1-256.' };
    }
    const documentId = request.documentId as DocumentSessionId;
    const layerId = request.layerId as LayerId;
    const expectedRevision = request.expectedDocumentRevision as number;
    const opening = this.document(documentId);
    if (!opening?.document || opening.lifecycle !== 'ready') return {
      status: 'rejected', code: 'document-not-ready', message: 'The palette document is not ready.'
    };
    if (opening.documentRevision !== expectedRevision) return {
      status: 'rejected', code: 'stale-document-revision', message: 'The expected document revision is stale.',
      currentRevision: opening.documentRevision
    };
    if (!findDocumentLayer(opening.document, layerId)) return {
      status: 'rejected', code: 'layer-not-found', message: `Layer ${layerId} does not exist.`
    };
    if (!this.ports.getLayerPalette) return { status: 'rejected', code: 'renderer-unavailable',
      message: 'Layer palette extraction is unavailable.' };
    const colors = await this.ports.getLayerPalette(documentId, layerId, request.colorCount as number);
    const closing = this.document(documentId);
    if (!closing?.document || closing.documentRevision !== expectedRevision) return {
      status: 'rejected', code: 'stale-document-revision',
      message: 'The document changed while its layer palette was extracted.',
      ...(closing ? { currentRevision: closing.documentRevision } : {})
    };
    return { status: 'completed', documentId, layerId, canonicalRevision: expectedRevision, colors };
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

  private waitForActionTask(
    documentId: DocumentSessionId,
    taskId: string,
    signal: AbortSignal,
    onProgress: (progress: number | null) => void
  ): ReturnType<ActionTaskPlaybackPort['wait']> {
    const session = this.workspace.getDocument(documentId);
    if (!session) return Promise.resolve({ status: 'missing', message: 'The task document is no longer open.' });
    return new Promise((resolve) => {
      let settled = false;
      let unsubscribe: () => void = () => undefined;
      const finish = (result: Awaited<ReturnType<ActionTaskPlaybackPort['wait']>>) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        signal.removeEventListener('abort', abort);
        unsubscribe();
        resolve(result);
      };
      const inspect = () => {
        const task = this.queryTask(documentId, taskId);
        if (!task) {
          finish({ status: 'missing', message: 'The accepted task was not published.' });
          return;
        }
        onProgress(task.progress);
        if (task.status === 'running') return;
        if (task.status === 'completed') {
          queueMicrotask(() => {
            const completed = this.queryTask(documentId, taskId) ?? task;
            finish({ status: 'completed', value: {
              progress: completed.progress, artifact: completed.artifact
            } });
          });
        } else if (task.status === 'failed') {
          finish({ status: 'failed', message: task.error ?? 'The Action task failed.' });
        } else {
          finish({ status: 'canceled', message: 'The Action task was canceled.' });
        }
      };
      const abort = () => {
        session.tasks.cancel(taskId);
        finish({ status: 'canceled', message: 'Playback stopped the Action task.' });
      };
      const timeout = setTimeout(() => {
        session.tasks.cancel(taskId);
        finish({ status: 'timeout', message: 'The Action task exceeded the 120 second playback limit.' });
      }, ACTION_TASK_TIMEOUT_MS);
      signal.addEventListener('abort', abort, { once: true });
      try {
        unsubscribe = session.tasks.subscribe(inspect);
        if (signal.aborted) abort(); else inspect();
      } catch {
        finish({ status: 'missing', message: 'The task owner is unavailable.' });
      }
    });
  }

  queryTaskEvents(afterCursor = 0, limit = 100): AutomationEventQueryResult {
    return this.taskEvents.query(afterCursor, limit);
  }

  queryPublicationEvents(afterCursor = 0, limit = 100): AutomationPublicationEventQueryResult {
    return this.publicationEvents.query(afterCursor, limit);
  }

  waitForPublicationEvents(
    afterCursor = 0,
    limit = 100,
    timeoutMs = 10_000
  ): Promise<AutomationPublicationEventWaitResult> {
    return this.publicationEvents.wait(afterCursor, limit, timeoutMs);
  }

  subscribeTaskEvents = (listener: () => void): (() => void) => this.taskEvents.subscribe(listener);
  taskEventRevision = (): number => this.taskEvents.snapshot();
  actionRecordingSnapshot = (): ActionRecordingSnapshot => this.actions.recordingSnapshot();
  subscribeActionRecording = (listener: () => void) => this.actions.subscribeRecording(listener);
  startActionRecording = (name?: string) => this.actions.startRecording(name);
  stopActionRecording = () => this.actions.stopRecording();
  clearActionRecording = () => this.actions.clearRecording();
  createActionVariable = (sequence: number, parameterPath: string, name: string) => (
    this.actions.createVariable(sequence, parameterPath, name)
  );
  updateActionVariable = (name: string, defaultValue: unknown) => (
    this.actions.updateVariable(name, defaultValue)
  );
  deleteActionVariable = (name: string) => this.actions.deleteVariable(name);
  bindActionParameterToVariable = (sequence: number, parameterPath: string, name: string) => (
    this.actions.bindVariable(sequence, parameterPath, name)
  );
  bindActionParameterToResult = (sequence: number, parameterPath: string,
    producerStep: number, resultPath: string) => (
    this.actions.bindResult(sequence, parameterPath, producerStep, resultPath)
  );
  restoreActionParameterLiteral = (sequence: number, parameterPath: string) => (
    this.actions.restoreLiteral(sequence, parameterPath)
  );
  replaceActionStepParameters = (sequence: number, parameters: Readonly<Record<string, unknown>>) => (
    this.actions.replaceParameters(sequence, parameters)
  );
  updateActionStepRationale = (sequence: number, rationale: string) => (
    this.actions.updateRationale(sequence, rationale)
  );
  actionLibrarySnapshot = (): SemanticActionLibrarySnapshot => this.actions.librarySnapshot();
  subscribeActionLibrary = (listener: () => void) => this.actions.subscribeLibrary(listener);
  createActionSet = (name: string) => this.actions.createSet(name);
  renameActionSet = (id: string, name: string) => this.actions.renameSet(id, name);
  selectActionSet = (id: string) => this.actions.selectSet(id);
  deleteActionSet = (id: string) => this.actions.deleteSet(id);
  saveActionRecording = (name: string) => this.actions.saveRecording(name);
  loadSavedAction = (id: string) => this.actions.loadSaved(id);
  deleteSavedAction = (id: string) => this.actions.deleteSaved(id);
  playActionRecordingAtomically = (overrides?: Readonly<Record<string, unknown>>) => (
    this.actions.playAtomic(overrides)
  );

  recordObservedCommand(command: LightTableCommandId, documentId: DocumentSessionId,
    parameters: unknown, value: unknown): boolean {
    if ((this.executingDocumentCommands.get(documentId) ?? 0) > 0) {
      return traceObservedCommand(command, false, 'command-execution-active');
    }
    if (!observedCommandParametersAreValid(command, parameters)) {
      return traceObservedCommand(command, false, 'invalid-observed-parameters');
    }
    if (!OBSERVED_STATE_ONLY_COMMANDS.has(command)) {
      this.workspace.getDocument(documentId)?.markChanged();
    }
    const resultSchema = LIGHTTABLE_COMMAND_SCHEMAS[command]?.result;
    if (resultSchema && !validateJsonSchemaValue(resultSchema, value).valid) {
      return traceObservedCommand(command, false, 'invalid-observed-result');
    }
    const recording = this.actions.recordingSnapshot();
    if (recording.status !== 'recording' || !recording.id) {
      return traceObservedCommand(command, false, 'recorder-inactive');
    }
    const startedAt = Date.now();
    const parsed = this.parseRequest({
      protocolVersion: LIGHTTABLE_COMMAND_PROTOCOL_VERSION,
      requestId: `observed-${command}-${crypto.randomUUID()}`,
      command,
      documentId,
      parameters
    });
    if ('rejection' in parsed) return traceObservedCommand(command, false, 'request-rejected');
    this.actions.record(parsed.value, {
      requestId: parsed.value.requestId,
      status: 'completed',
      value,
      revisions: this.revisions(this.document(documentId) ?? undefined)
    }, startedAt, recording.id, 'ui');
    return traceObservedCommand(command, true, 'recorded');
  }
  actionPlaybackSnapshot = (): ActionPlaybackSnapshot => this.actions.playbackSnapshot();
  subscribeActionPlayback = (listener: () => void) => this.actions.subscribePlayback(listener);
  playActionRecording = (overrides?: Readonly<Record<string, unknown>>) => this.actions.play(overrides);
  playActionStep = (sequence: number) => this.actions.playStep(sequence);
  playActionFromStep = (sequence: number) => this.actions.playFrom(sequence);
  stopActionPlayback = (): void => this.actions.stopPlayback();

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
    this.gestures.set(gestureId, {
      documentId, kind: request.kind, pointerId, sampleCount: 1,
      lease: this.createGestureLease(gestureId)
    });
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
    clearTimeout(gesture.lease);
    gesture.lease = this.createGestureLease(gestureId);
    return { status: 'updated', gestureId, sampleCount: gesture.sampleCount };
  }

  async finishGesture(gestureId: string, commit: boolean): Promise<LightTableGestureResult> {
    const gesture = this.gestures.get(gestureId);
    if (!gesture) return { status: 'rejected', message: 'The gesture does not exist.' };
    this.gestures.delete(gestureId);
    clearTimeout(gesture.lease);
    const finished = await this.ports.finishGesture(
      gesture.documentId, gesture.kind, gesture.pointerId, commit
    );
    if (finished && commit && gesture.kind !== 'selection-rectangle') {
      this.workspace.getDocument(gesture.documentId)?.markChanged();
    }
    return finished
      ? { status: commit ? 'completed' : 'canceled', gestureId, sampleCount: gesture.sampleCount }
      : { status: 'rejected', message: 'The editor could not finish the gesture.' };
  }

  async cancelAllGestures(documentId?: DocumentSessionId): Promise<number> {
    const gestureIds = [...this.gestures]
      .filter(([, gesture]) => documentId === undefined || gesture.documentId === documentId)
      .map(([gestureId]) => gestureId);
    await Promise.all(gestureIds.map((gestureId) => this.finishGesture(gestureId, false)));
    return gestureIds.length;
  }

  private createGestureLease(gestureId: string): ReturnType<typeof setTimeout> {
    return setTimeout(() => void this.finishGesture(gestureId, false), AUTOMATION_GESTURE_LEASE_MS);
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
      color: canonical ? { ...canonical.colorSettings } : null,
      activeLayerId: canonical?.activeLayerId ?? null,
      layerCount: canonical ? walkLayerTree(canonical.layers).length : 0,
      viewport: { ...document.viewport },
      history: {
        canUndo: document.history.canUndo,
        canRedo: document.history.canRedo,
        busy: document.history.busy,
        undoDepth: document.history.undoDepth,
        redoDepth: document.history.redoDepth,
        undoLabel: document.history.undoLabel,
        redoLabel: document.history.redoLabel,
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

  queryLayerPage(value: unknown): LayerListQueryResult {
    if (!isRecord(value) || typeof value.documentId !== 'string' || !value.documentId) {
      return { status: 'rejected', code: 'invalid-request',
        message: 'Layer list requires a documentId.' };
    }
    const documentId = value.documentId as DocumentSessionId;
    const snapshot = this.document(documentId);
    if (!snapshot?.document) {
      return { status: 'rejected', code: 'document-not-found',
        message: 'The layer-list document is not available.' };
    }
    return projectLayerListPage(
      documentId, snapshot.document, snapshot.documentRevision, value
    );
  }

  queryLayerDetail(value: unknown): LayerDetailQueryResult {
    if (!isRecord(value) || typeof value.documentId !== 'string' || !value.documentId) {
      return { status: 'rejected', code: 'invalid-request',
        message: 'Layer query requires a documentId.' };
    }
    const documentId = value.documentId as DocumentSessionId;
    const snapshot = this.document(documentId);
    if (!snapshot?.document) return { status: 'rejected', code: 'document-not-found',
      message: 'The layer-query document is not available.' };
    return projectLayerDetailQuery(
      documentId, snapshot.document, snapshot.documentRevision, value
    );
  }

  queryLayerEffects(documentId: DocumentSessionId, layerId: LayerId): LayerEffectsQueryResult | null {
    const canonical = this.document(documentId)?.document;
    const layer = canonical ? findDocumentLayer(canonical, layerId) : null;
    if (!layer) return null;
    return {
      layerId,
      enabled: layer.styleStack.enabled,
      scale: layer.styleStack.scale,
      globalLight: structuredClone(layer.styleStack.globalLight),
      revision: layer.styleStack.revision,
      totalEffects: layer.styleStack.effects.length,
      truncated: layer.styleStack.effects.length > 128,
      effects: layer.styleStack.effects.slice(0, 128).map((effect) => ({
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
        fill: structuredClone(run.fill ?? null), stroke: structuredClone(run.stroke ?? null),
        tracking: run.tracking, syntheticBold: run.syntheticBold,
        syntheticItalic: run.syntheticItalic, underline: Boolean(run.underline) };
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

  queryWarp(documentId: DocumentSessionId, layerId: LayerId): WarpQueryResult | null {
    const document = this.document(documentId)?.document;
    const layer = document ? findDocumentLayer(document, layerId) : null;
    return layer?.type === 'raster' ? projectWarpQuery(layer) : null;
  }

  queryBasicGrade(documentId: DocumentSessionId, value: unknown): BasicGradeQueryResult | null {
    if (!this.document(documentId)?.document) return null;
    const target = parseBasicAdjustmentTarget(value);
    if ('message' in target) throw new Error(target.message);
    return this.ports.queryBasicAdjustments?.(documentId, target) ?? null;
  }

  queryAdjustment(documentId: DocumentSessionId, value: unknown): AdjustmentQueryResult {
    const snapshot = this.document(documentId);
    if (!snapshot?.document) return { status: 'rejected', code: 'target-not-found',
      message: 'The adjustment-query document is not available.' };
    if (!isRecord(value)) return { status: 'rejected', code: 'invalid-request',
      message: 'Adjustment query parameters must be an object.' };
    const expected = value.expectedDocumentRevision;
    if (expected !== undefined && (!Number.isSafeInteger(expected) || (expected as number) < 0)) {
      return { status: 'rejected', code: 'invalid-request',
        message: 'expectedDocumentRevision must be a non-negative safe integer.' };
    }
    if (expected !== undefined && expected !== snapshot.documentRevision) return {
      status: 'rejected', code: 'stale-document-revision',
      message: 'The expected document revision is stale.',
      currentRevision: snapshot.documentRevision
    };
    const target = parseAdjustmentQueryTarget(value.target);
    if ('message' in target) return { status: 'rejected', code: 'invalid-request',
      message: target.message };
    return this.ports.queryAdjustments?.(documentId, target) ?? {
      status: 'rejected', code: 'unsupported-target',
      message: 'Adjustment inspection is unavailable in the mounted document.'
    };
  }

  queryCapabilities(documentId: DocumentSessionId): readonly CommandCapabilitySummary[] | null {
    const snapshot = this.document(documentId);
    return snapshot ? projectCommandCapabilities(snapshot, this.ports, Boolean(this.workspacePorts)) : null;
  }

  async execute(requestValue: unknown, context: LightTableCommandExecutionContext = {
    origin: 'ui', recording: 'record'
  }): Promise<LightTableCommandResult> {
    const startedAt = Date.now();
    const recording = this.actions.recordingSnapshot();
    const recordingId = context.recording === 'record' && recording.status === 'recording'
      ? recording.id
      : null;
    const parsed = this.parseRequest(requestValue);
    const documentId = 'value' in parsed ? parsed.value.documentId : undefined;
    if (documentId) {
      this.executingDocumentCommands.set(documentId,
        (this.executingDocumentCommands.get(documentId) ?? 0) + 1);
    }
    let result: LightTableCommandResult;
    try {
      result = await this.executeCommand(requestValue);
    } finally {
      if (documentId) {
        const depth = (this.executingDocumentCommands.get(documentId) ?? 1) - 1;
        if (depth > 0) this.executingDocumentCommands.set(documentId, depth);
        else this.executingDocumentCommands.delete(documentId);
      }
    }
    if (!('rejection' in parsed) && context.recording === 'record') {
      this.actions.record(parsed.value, result, startedAt, recordingId, context.origin);
    }
    return result;
  }

  private async executeCommand(requestValue: unknown): Promise<LightTableCommandResult> {
    const request = this.parseRequest(requestValue);
    if ('rejection' in request) return request.rejection;
    const { value } = request;
    const sharedSchema = LIGHTTABLE_COMMAND_SCHEMAS[value.command]?.input;
    if (sharedSchema) {
      const validation = validateJsonSchemaValue(sharedSchema, value.parameters);
      if (!validation.valid) {
        return this.reject(value.requestId, 'invalid-parameters',
          `Command parameters do not match schema v1: ${formatSchemaValidationIssues(validation.issues)}.`);
      }
    }
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
      if (!isRecord(value.parameters) || Object.keys(value.parameters).length !== 1
        || typeof value.parameters.artifactId !== 'string'
        || value.parameters.artifactId.length < 1 || value.parameters.artifactId.length > 256) {
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
      if (value.expectedDocumentRevision !== undefined
        && value.expectedDocumentRevision !== source.documentRevision) {
        return this.reject(value.requestId, 'stale-document-revision',
          `Expected document revision ${value.expectedDocumentRevision}, current revision is ${source.documentRevision}.`,
          source);
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

    const automationTask = startSemanticAutomationTask(value.command, value.parameters, this.workspace.getDocument(
      documentRequest.documentId)!, this.ports, this.taskEvents,
      (id, result) => this.actions.completeTask(id, result));
    if (automationTask) {
      return 'error' in automationTask ? this.reject(value.requestId, automationTask.error, automationTask.message, snapshot)
        : { requestId: value.requestId, status: 'accepted', taskId: automationTask.taskId, revisions: this.revisions(snapshot) };
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
        const committed = this.document(documentRequest.documentId)?.document;
        return { requestId: value.requestId, status: 'completed', value: {
          width: committed?.width ?? resize.width,
          height: committed?.height ?? resize.height,
          resolutionPpi: committed?.resolutionPpi ?? resize.resolutionPpi
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
        const committed = this.document(documentRequest.documentId)?.document;
        return { requestId: value.requestId, status: 'completed', value: {
          operation: geometry.operation,
          width: committed?.width ?? snapshot.document!.width,
          height: committed?.height ?? snapshot.document!.height
        },
          revisions: this.revisions(this.document(documentRequest.documentId) ?? snapshot) };
      } catch (reason) {
        return this.reject(value.requestId, 'execution-failed', reason instanceof Error ? reason.message : String(reason), snapshot);
      }
    }

    if (value.command === 'document.assignProfile') {
      const command = parseSemanticAssignProfileCommand(value.parameters);
      if ('message' in command) {
        return this.reject(value.requestId, 'invalid-parameters', command.message, snapshot);
      }
      if (!this.ports.assignDocumentProfile) {
        return this.reject(value.requestId, 'command-unavailable',
          'Assign Profile is unavailable in this host.', snapshot);
      }
      try {
        const result = await this.ports.assignDocumentProfile(
          documentRequest.documentId,
          command
        );
        if (result.changed) this.workspace.getDocument(documentRequest.documentId)?.markChanged();
        return { requestId: value.requestId, status: 'completed', value: result,
          revisions: this.revisions(this.document(documentRequest.documentId) ?? snapshot) };
      } catch (reason) {
        return this.reject(value.requestId, 'execution-failed',
          reason instanceof Error ? reason.message : String(reason), snapshot);
      }
    }

    if (value.command === 'selection.copyPixels' || value.command === 'selection.pastePixels') {
      const dispatched = await this.pixelClipboardCommands.dispatch(value.command, value.parameters,
        documentRequest.documentId, this.ports);
      if (dispatched.ok) {
        if (dispatched.mutated) this.workspace.getDocument(documentRequest.documentId)?.markChanged();
        return { requestId: value.requestId, status: 'completed', value: dispatched.value,
          revisions: this.revisions(this.document(documentRequest.documentId) ?? snapshot) };
      }
      return this.reject(value.requestId, dispatched.code, dispatched.message, snapshot);
    }

    if (value.command === 'grade.copy' || value.command === 'grade.paste') {
      const dispatched = await this.gradeClipboardCommands.dispatch(value.command, value.parameters,
        documentRequest.documentId, this.ports);
      if (dispatched.ok) {
        if (dispatched.mutated) this.workspace.getDocument(documentRequest.documentId)?.markChanged();
        return { requestId: value.requestId, status: 'completed', value: dispatched.value,
          revisions: this.revisions(this.document(documentRequest.documentId) ?? snapshot) };
      }
      return this.reject(value.requestId, dispatched.code, dispatched.message, snapshot);
    }

    if (value.command === 'file.exportBitmap') {
      if (!isRecord(value.parameters) || Object.keys(value.parameters).length !== 1
        || !['jpeg', 'webp', 'tiff'].includes(String(value.parameters.format))) {
        return this.reject(value.requestId, 'invalid-parameters',
          'Bitmap export requires format jpeg, webp or tiff.', snapshot);
      }
      return this.startArtifactExport(documentRequest, snapshot);
    }

    if (value.command === 'file.exportNative' || value.command === 'file.exportPng'
      || value.command === 'file.exportPsd') {
      if (!isRecord(value.parameters) || Object.keys(value.parameters).length > 0) {
        return this.reject(value.requestId, 'invalid-parameters', 'Export parameters must be an empty object.', snapshot);
      }
      return this.startArtifactExport(documentRequest, snapshot);
    }

    if (value.command === 'layer.placeArtifact') {
      if (!isRecord(value.parameters)
        || Object.keys(value.parameters).some((key) => !['artifactId', 'name', 'x', 'y'].includes(key))
        || typeof value.parameters.artifactId !== 'string'
        || value.parameters.artifactId.length < 1 || value.parameters.artifactId.length > 256) {
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
          || !value.parameters.name.trim() || value.parameters.name.length > 255
          || /[\u0000-\u001f\u007f]/u.test(value.parameters.name)))) {
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

    if (value.command === 'warp.applyStroke') {
      const outcome = await dispatchSemanticWarpStroke(value.parameters,
        this.ports.executeWarpStrokeCommand
          ? (command) => this.ports.executeWarpStrokeCommand!(documentRequest.documentId, command)
          : undefined);
      if (!outcome.ok) return this.reject(value.requestId, outcome.code, outcome.message, snapshot);
      this.workspace.getDocument(documentRequest.documentId)?.markChanged();
      return { requestId: value.requestId, status: 'completed', value: outcome.value,
        revisions: this.revisions(this.document(documentRequest.documentId) ?? snapshot) };
    }

    if (value.command === 'raster.fill') {
      const outcome = await dispatchSemanticFill(value.parameters,
        this.ports.executeFillCommand
          ? (command) => this.ports.executeFillCommand!(documentRequest.documentId, command)
          : undefined);
      if (!outcome.ok) return this.reject(value.requestId, outcome.code, outcome.message, snapshot);
      this.workspace.getDocument(documentRequest.documentId)?.markChanged();
      return { requestId: value.requestId, status: 'completed', value: outcome.value,
        revisions: this.revisions(this.document(documentRequest.documentId) ?? snapshot) };
    }

    if (value.command === 'raster.applyGradient') {
      const outcome = await dispatchSemanticRasterGradient(value.parameters,
        this.ports.executeRasterGradientCommand
          ? (command) => this.ports.executeRasterGradientCommand!(documentRequest.documentId, command)
          : undefined);
      if (!outcome.ok) return this.reject(value.requestId, outcome.code, outcome.message, snapshot);
      this.workspace.getDocument(documentRequest.documentId)?.markChanged();
      return { requestId: value.requestId, status: 'completed', value: outcome.value,
        revisions: this.revisions(this.document(documentRequest.documentId) ?? snapshot) };
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

    if (value.command === 'layer.style.update' || value.command === 'layer.effect.add' || value.command === 'layer.effect.update'
      || value.command === 'layer.effect.remove' || value.command === 'layer.effect.move') {
      const kind = value.command === 'layer.style.update' ? 'stack-update'
        : value.command.slice('layer.effect.'.length) as SemanticLayerStyleCommand['kind'];
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
      if (value.command !== 'view.setZoom' && result.changed !== false) {
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
    const requestParameters = isRecord(request.parameters) ? request.parameters : {};
    const bitmapFormat = request.command === 'file.exportBitmap'
      ? requestParameters.format as 'jpeg' | 'webp' | 'tiff'
      : null;
    const operation = native ? this.ports.exportNativeArtifact.bind(this.ports)
      : psd ? this.ports.exportPsdArtifact.bind(this.ports)
        : bitmapFormat
          ? (documentId: DocumentSessionId) => this.ports.exportBitmapArtifact(documentId, bitmapFormat)
          : this.ports.exportPngArtifact.bind(this.ports);
    const kind: LightTableArtifactKind = native ? 'native-document'
      : psd ? 'psd-export' : bitmapFormat ? `${bitmapFormat}-export` : 'png-export';
    void session.tasks.run('export', native ? 'Export native document'
      : psd ? 'Export Photoshop artifact'
        : bitmapFormat ? `Export ${bitmapFormat.toUpperCase()} artifact` : 'Export PNG artifact', async (task) => {
      const exported = await operation(request.documentId);
      task.throwIfCanceled();
      const file = exported instanceof File ? exported : exported.file;
      const findings = psd && !(exported instanceof File) ? exported.findings : [];
      const artifact = this.artifacts.register(file, kind, findings);
      this.taskArtifacts.set(task.id, artifact);
      this.actions.completeTask(task.id, { artifact });
      return artifact;
    });
    const taskId = session.tasks.getSnapshot().activeTaskIds.at(-1);
    if (!taskId) return this.reject(request.requestId, 'execution-failed', 'The export task did not start.', snapshot);
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
  ): Promise<{ value: unknown; changed?: boolean } | { code: LightTableCommandErrorCode; message: string }> {
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
      case 'transform.applyFixed': {
        const result = await dispatchSemanticFixedTransform(parameters, snapshot.document!,
          this.ports.executeFixedTransform
            ? (command) => this.ports.executeFixedTransform!(request.documentId, command) : undefined,
          () => this.document(request.documentId)?.document?.revision);
        return result.ok ? { value: result.value } : result;
      }
      case 'adjustment.create': {
        const result = await dispatchSemanticAdjustmentCreation(parameters, snapshot.document!,
          this.ports.executeAdjustmentCreation
            ? (command) => this.ports.executeAdjustmentCreation!(request.documentId, command) : undefined,
          () => this.document(request.documentId)?.document?.revision);
        return result.ok ? { value: result.value } : result;
      }
      case 'raster.invert': {
        const result = await dispatchSemanticRasterInvert(parameters, snapshot.document!,
          this.ports.executeRasterInvert
            ? (command) => this.ports.executeRasterInvert!(request.documentId, command) : undefined,
          () => this.document(request.documentId)?.document?.revision);
        return result.ok ? { value: result.value } : result;
      }
      case 'text.convertToShape':
      case 'text.rasterize': {
        const convertToShape = request.command === 'text.convertToShape';
        const executor = convertToShape ? this.ports.executeTextToShape : this.ports.executeTextRasterize;
        const result = await dispatchSemanticTextFinalization(
          parameters,
          snapshot.document!,
          convertToShape ? 'convert to shape' : 'rasterize',
          executor ? (command) => executor.call(this.ports, request.documentId, command) : undefined,
          () => this.document(request.documentId)?.document?.revision
        );
        return result.ok ? { value: result.value } : result;
      }
      case 'layer.merge':
      case 'layer.flattenGroup':
      case 'document.flattenImage': {
        const result = await dispatchSemanticMergeFlatten(request.command, parameters, snapshot.document!, {
          merge: this.ports.executeLayerMerge ? (command) => this.ports.executeLayerMerge!(request.documentId, command) : undefined,
          flattenGroup: this.ports.executeFlattenGroup ? (command) => this.ports.executeFlattenGroup!(request.documentId, command) : undefined,
          flattenImage: this.ports.executeFlattenImage ? () => this.ports.executeFlattenImage!(request.documentId) : undefined
        },
          () => this.document(request.documentId)?.document?.revision);
        return result.ok ? { value: result.value } : result;
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
        return created
          ? { value: { created: true, layerId: created.id } }
          : { code: 'execution-failed', message: 'The raster layer was not created.' };
      }
      case 'layer.duplicate':
      case 'layer.copyToNewLayer':
      case 'layer.delete':
      case 'layer.move':
      case 'layer.setBlendMode':
      case 'layer.setClipping':
      case 'layer.setTransform':
      case 'layer.setMask':
      case 'layer.setLock': {
        const kinds = {
          'layer.duplicate': 'duplicate',
          'layer.copyToNewLayer': 'copy-to-new-layer',
          'layer.delete': 'delete',
          'layer.move': 'move',
          'layer.setBlendMode': 'set-blend-mode',
          'layer.setClipping': 'set-clipping',
          'layer.setTransform': 'set-transform',
          'layer.setMask': 'set-mask',
          'layer.setLock': 'set-lock'
        } as const;
        const command = parseSemanticLayerCommand(kinds[request.command], parameters);
        if ('message' in command) return this.invalidParameters(command.message);
        const targetIds = 'layerIds' in command ? command.layerIds : [command.layerId];
        if (targetIds.some((id) => !findDocumentLayer(snapshot.document!, id))) {
          return { code: 'command-unavailable', message: 'One or more target layers do not exist.' };
        }
        if (command.kind === 'duplicate' || command.kind === 'copy-to-new-layer') {
          const layer = findDocumentLayer(snapshot.document!, command.layerId)!;
          if (command.kind === 'copy-to-new-layer' ? layer.type !== 'raster'
            : layer.type !== 'raster' && layer.type !== 'text') {
            return { code: 'command-unavailable', message: command.kind === 'copy-to-new-layer'
              ? 'Layer via Copy requires a raster source layer.'
              : 'Only raster and text layers can currently be duplicated.' };
          }
        }
        if (command.kind === 'delete'
          && !queryLayerCommandCapabilities(snapshot.document!, command.layerIds).canDeleteSelection) {
          return { code: 'command-unavailable', message: 'The requested layers cannot be deleted.' };
        }
        if (command.kind === 'move') {
          const siblings = siblingLayers(snapshot.document!, command.layerId);
          const index = siblings.findIndex(({ id }) => id === command.layerId);
          const targetIndex = index + (command.direction === 'up' ? 1 : -1);
          if (index < 0 || targetIndex < 0 || targetIndex >= siblings.length) {
            return { code: 'command-unavailable', message: `The layer cannot move ${command.direction}.` };
          }
        }
        if (command.kind === 'set-clipping' && command.clipping) {
          const siblings = siblingLayers(snapshot.document!, command.layerId);
          if (siblings.findIndex(({ id }) => id === command.layerId) <= 0) {
            return { code: 'command-unavailable', message: 'Clipping requires a lower sibling layer.' };
          }
        }
        if (command.kind === 'set-transform'
          && layerIsLocked(findDocumentLayer(snapshot.document!, command.layerId)!, 'position')) {
          return { code: 'command-unavailable', message: 'The target layer position is locked.' };
        }
        if (command.kind === 'set-mask') {
          const layer = findDocumentLayer(snapshot.document!, command.layerId)!;
          if (command.operation === 'add' && layer.mask) {
            return { code: 'command-unavailable', message: 'The target layer already has a raster mask.' };
          }
          if (command.operation !== 'add' && !layer.mask) {
            return { code: 'command-unavailable', message: 'The target layer has no raster mask.' };
          }
        }
        const beforeRevision = snapshot.document!.revision;
        const result = await this.ports.executeLayerCommand(request.documentId, command);
        if (!result) {
          return { code: 'execution-failed', message: 'The layer command did not complete.' };
        }
        const changed = this.document(request.documentId)?.document?.revision !== beforeRevision;
        return { value: result, changed };
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
      case 'tool.commitGesture': {
        const committed = parseCommittedGestureRequest(parameters);
        if ('message' in committed) return this.invalidParameters(committed.message);
        const started = await this.beginGesture({
          documentId: request.documentId,
          kind: committed.kind,
          coordinateSpace: 'document',
          parameters: committed.parameters,
          sample: committed.samples[0]
        });
        if (started.status !== 'started' || !started.gestureId) {
          return { code: 'execution-failed', message: started.message ?? 'The tool operation did not start.' };
        }
        for (let offset = 1; offset < committed.samples.length; offset += 64) {
          const updated = await this.updateGesture(
            started.gestureId,
            committed.samples.slice(offset, offset + 64)
          );
          if (updated.status === 'rejected') {
            return { code: 'execution-failed', message: updated.message ?? 'The tool operation failed.' };
          }
        }
        const finished = await this.finishGesture(started.gestureId, true);
        if (finished.status !== 'completed') {
          return { code: 'execution-failed', message: finished.message ?? 'The tool operation did not commit.' };
        }
        return { value: {
          kind: committed.kind,
          sampleCount: committed.samples.length
        }, changed: false };
      }
      case 'selection.applyShape':
      case 'selection.applyMagicWand':
      case 'selection.modify': {
        const command = parseSemanticSelectionCommand(parameters);
        if ('message' in command) return this.invalidParameters(command.message);
        if (!this.ports.executeSelectionCommand) {
          return { code: 'command-unavailable', message: 'Selection commands are unavailable in this host.' };
        }
        const result = await this.ports.executeSelectionCommand(request.documentId, command);
        if (!result) return { code: 'execution-failed', message: 'The selection could not be applied.' };
        return { value: result, changed: false };
      }
      case 'grade.setBasic': {
        const command = parseSemanticBasicAdjustmentCommand(parameters);
        if ('message' in command) return this.invalidParameters(command.message);
        if (!this.ports.executeBasicAdjustmentCommand) {
          return { code: 'command-unavailable', message: 'Basic Grade commands are unavailable in this host.' };
        }
        const result = await this.ports.executeBasicAdjustmentCommand(request.documentId, command);
        if (!result || typeof result !== 'object') {
          return { code: 'execution-failed', message: 'The basic Grade could not be applied.' };
        }
        return { value: result, changed: (result as { changed?: boolean }).changed !== false };
      }
      case 'grade.setDetail': {
        const command = parseSemanticDetailAdjustmentCommand(parameters);
        if ('message' in command) return this.invalidParameters(command.message);
        if (!this.ports.executeDetailAdjustmentCommand) {
          return { code: 'command-unavailable', message: 'Detail commands are unavailable in this host.' };
        }
        const result = await this.ports.executeDetailAdjustmentCommand(request.documentId, command);
        if (!result || typeof result !== 'object') {
          return { code: 'execution-failed', message: 'Detail could not be applied.' };
        }
        return { value: result, changed: (result as { changed?: boolean }).changed !== false };
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
        const beforeRevision = snapshot.document!.revision;
        const completed = await this.ports[direction](request.documentId);
        if (!completed) return { code: 'execution-failed', message: `${direction} did not complete.` };
        const documentChanged = this.document(request.documentId)?.document?.revision !== beforeRevision;
        return { value: { changed: true, documentChanged }, changed: documentChanged };
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
    const scope = commandScope(value.command);
    if (scope === 'workspace' && value.documentId !== undefined) {
      return { rejection: this.reject(requestId, 'invalid-request',
        'Workspace commands may not include a documentId.') };
    }
    if (scope === 'workspace' && value.expectedDocumentRevision !== undefined) {
      return { rejection: this.reject(requestId, 'invalid-request',
        'Workspace commands may not include expectedDocumentRevision.') };
    }
    if (scope === 'document' && (typeof value.documentId !== 'string' || !value.documentId)) {
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
  cancelAllGestures(documentId?: DocumentSessionId): Promise<number>;
  registerInputArtifact(file: File): LightTableArtifactMetadata;
  registerPixelClipboardArtifact?(file: File): LightTableArtifactMetadata;
  queryArtifact(artifactId: string): LightTableArtifactMetadata | null;
  resolveArtifact(artifactId: string): File | null;
  listArtifacts(): readonly LightTableArtifactMetadata[];
  releaseArtifact(artifactId: string): boolean;
  requestDocumentPreview(request: unknown): Promise<DocumentPreviewResult>;
  requestDocumentPalette?(request: unknown): Promise<unknown>;
  requestLayerPalette?(request: unknown): Promise<unknown>;
  requestLayerPreview(request: unknown): Promise<LayerPreviewResult>;
  queryTask(documentId: DocumentSessionId, taskId: string): AutomationTaskQueryResult | null;
  queryTaskEvents(afterCursor?: number, limit?: number): AutomationEventQueryResult;
  queryPublicationEvents(afterCursor?: number, limit?: number): AutomationPublicationEventQueryResult;
  waitForPublicationEvents(
    afterCursor?: number,
    limit?: number,
    timeoutMs?: number
  ): Promise<AutomationPublicationEventWaitResult>;
  queryWorkspace(): WorkspaceQueryResult;
  queryDocument(documentId: DocumentSessionId): DocumentQueryResult | null;
  queryLayers(documentId: DocumentSessionId): readonly LayerQuerySummary[] | null;
  queryLayerPage(request: unknown): LayerListQueryResult;
  queryLayerDetail(request: unknown): LayerDetailQueryResult;
  queryLayerEffects(documentId: DocumentSessionId, layerId: LayerId): LayerEffectsQueryResult | null;
  queryText(documentId: DocumentSessionId, layerId: LayerId): EditableTextQueryResult | null;
  queryVector(documentId: DocumentSessionId, layerId: LayerId): EditableVectorQueryResult | null;
  queryWarp?(documentId: DocumentSessionId, layerId: LayerId): WarpQueryResult | null;
  queryBasicGrade(documentId: DocumentSessionId, target: unknown): BasicGradeQueryResult | null;
  queryAdjustment(documentId: DocumentSessionId, request: unknown): AdjustmentQueryResult;
  queryCapabilities(documentId: DocumentSessionId): readonly CommandCapabilitySummary[] | null;
  /** Read-only diagnostic projection of the visible Actions recorder. */
  actionRecordingSnapshot?(): ActionRecordingSnapshot;
  queryRenderTelemetry?(documentId: DocumentSessionId): RenderTelemetrySnapshot | null;
  resetRenderTelemetry?(documentId: DocumentSessionId): boolean;
  execute(request: unknown, context?: LightTableCommandExecutionContext): Promise<LightTableCommandResult>;
}
