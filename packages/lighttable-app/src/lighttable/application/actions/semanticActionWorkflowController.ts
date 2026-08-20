import type {
  LightTableCommandOrigin,
  LightTableCommandRequest,
  LightTableCommandResult
} from '../commands/lightTableCommandContract';
import {
  SemanticActionLibrary,
  type SemanticActionLibrarySnapshot,
  type SemanticActionLibraryStorage
} from './semanticActionLibrary';
import {
  SemanticActionPlaybackController,
  type ActionPlaybackSnapshot,
  type ActionTaskPlaybackPort
} from './semanticActionPlayback';
import { SemanticActionRecorder, type ActionRecordingSnapshot } from './semanticActionRecorder';

export interface SemanticActionWorkflowPorts {
  execute(request: LightTableCommandRequest): Promise<LightTableCommandResult>;
  activeDocumentId(): string | undefined;
  readonly tasks: ActionTaskPlaybackPort;
}

/**
 * Owns the local Actions lifecycle around the shared semantic command route.
 * Recording decisions stay with LightTableCommandService; this controller only
 * stores, selects and replays the already validated command contracts.
 */
export class SemanticActionWorkflowController {
  private readonly recorder = new SemanticActionRecorder();
  private readonly library: SemanticActionLibrary;
  private readonly playback: SemanticActionPlaybackController;

  constructor(private readonly ports: SemanticActionWorkflowPorts,
    storage?: SemanticActionLibraryStorage) {
    this.library = new SemanticActionLibrary(storage);
    this.playback = new SemanticActionPlaybackController(ports.execute, ports.tasks);
  }

  dispose(): void { this.playback.stop(); }

  recordingSnapshot = (): ActionRecordingSnapshot => this.recorder.snapshot();
  subscribeRecording = (listener: () => void): (() => void) => this.recorder.subscribe(listener);
  startRecording = (name?: string): ActionRecordingSnapshot => {
    this.playback.clear();
    return this.recorder.start(name);
  };
  stopRecording = (): ActionRecordingSnapshot => this.recorder.stop();
  clearRecording = (): ActionRecordingSnapshot => {
    this.playback.clear();
    return this.recorder.clear();
  };
  createVariable = (sequence: number, parameterPath: string, name: string) => (
    this.recorder.createVariable(sequence, parameterPath, name)
  );
  updateVariable = (name: string, defaultValue: unknown) => this.recorder.updateVariable(name, defaultValue);
  deleteVariable = (name: string) => this.recorder.deleteVariable(name);
  bindVariable = (sequence: number, parameterPath: string, name: string) => (
    this.recorder.bindVariable(sequence, parameterPath, name)
  );
  bindResult = (sequence: number, parameterPath: string, producerStep: number, resultPath: string) => (
    this.recorder.bindResult(sequence, parameterPath, producerStep, resultPath)
  );
  restoreLiteral = (sequence: number, parameterPath: string) => (
    this.recorder.restoreLiteral(sequence, parameterPath)
  );
  replaceParameters = (sequence: number, parameters: Readonly<Record<string, unknown>>) => (
    this.recorder.replaceParameters(sequence, parameters)
  );
  updateRationale = (sequence: number, rationale: string) => (
    this.recorder.updateRationale(sequence, rationale)
  );

  librarySnapshot = (): SemanticActionLibrarySnapshot => this.library.snapshot();
  subscribeLibrary = (listener: () => void): (() => void) => this.library.subscribe(listener);
  createSet = (name: string) => this.library.createSet(name);
  renameSet = (id: string, name: string) => this.library.renameSet(id, name);
  selectSet = (id: string) => this.library.selectSet(id);
  deleteSet = (id: string): Promise<boolean> => this.library.deleteSet(id);
  deleteSaved = (id: string): Promise<boolean> => this.library.delete(id);

  async saveRecording(name: string) {
    const saved = await this.library.save(this.recorder.snapshot(), name);
    if (saved) this.recorder.restore(saved.recording);
    return saved;
  }

  async loadSaved(id: string): Promise<ActionRecordingSnapshot | null> {
    this.playback.clear();
    const action = await this.library.select(id);
    return action ? this.recorder.restore(action.recording) : null;
  }

  playbackSnapshot = (): ActionPlaybackSnapshot => this.playback.snapshot();
  subscribePlayback = (listener: () => void): (() => void) => this.playback.subscribe(listener);
  play = (overrides?: Readonly<Record<string, unknown>>): Promise<ActionPlaybackSnapshot> => this.playback.play(
    this.recorder.snapshot(), this.ports.activeDocumentId(), overrides
  );
  playAtomic = (overrides?: Readonly<Record<string, unknown>>): Promise<ActionPlaybackSnapshot> => (
    this.playback.playAtomic(this.recorder.snapshot(), this.ports.activeDocumentId(), overrides)
  );
  playStep = (sequence: number): Promise<ActionPlaybackSnapshot> => this.playback.playStep(
    this.recorder.snapshot(), sequence, this.ports.activeDocumentId()
  );
  playFrom = (sequence: number): Promise<ActionPlaybackSnapshot> => this.playback.playFrom(
    this.recorder.snapshot(), sequence, this.ports.activeDocumentId()
  );
  stopPlayback = (): void => this.playback.stop();

  record(request: LightTableCommandRequest, result: LightTableCommandResult,
    startedAt: number, recordingId: string | null,
    origin: LightTableCommandOrigin): void {
    this.recorder.record(request, result, startedAt, recordingId, origin);
  }

  completeTask(taskId: string, value: unknown): boolean {
    return this.recorder.completeTask(taskId, value);
  }
}
