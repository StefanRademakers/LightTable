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
  private recordingSetId: string | null = null;

  constructor(private readonly ports: SemanticActionWorkflowPorts,
    storage?: SemanticActionLibraryStorage) {
    this.library = new SemanticActionLibrary(storage);
    this.playback = new SemanticActionPlaybackController(ports.execute, ports.tasks);
  }

  dispose(): void {
    this.playback.dispose();
    this.library.dispose();
    this.recorder.dispose();
  }

  recordingSnapshot = (): ActionRecordingSnapshot => this.recorder.snapshot();
  subscribeRecording = (listener: () => void): (() => void) => this.recorder.subscribe(listener);
  startRecording = (name?: string, insertAfterSequence?: number): ActionRecordingSnapshot => {
    this.playback.clear();
    this.recordingSetId ??= this.library.snapshot().selectedSetId;
    return this.recorder.start(name, insertAfterSequence);
  };
  stopRecording = (): ActionRecordingSnapshot => this.recorder.stop();
  clearRecording = (): ActionRecordingSnapshot => {
    this.playback.clear();
    this.recordingSetId = null;
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
  setStepEnabled = (sequence: number, enabled: boolean) => this.recorder.setStepEnabled(sequence, enabled);
  setStepInteractive = (sequence: number, interactive: boolean) => (
    this.recorder.setStepInteractive(sequence, interactive)
  );
  deleteStep = (sequence: number) => this.recorder.deleteStep(sequence);
  duplicateStep = (sequence: number) => this.recorder.duplicateStep(sequence);
  moveStep = (sequence: number, direction: -1 | 1) => this.recorder.moveStep(sequence, direction);

  librarySnapshot = (): SemanticActionLibrarySnapshot => this.library.snapshot();
  subscribeLibrary = (listener: () => void): (() => void) => this.library.subscribe(listener);
  async createSet(name: string) {
    const recordingBefore = this.recorder.snapshot();
    const created = await this.library.createSet(name);
    if (created && this.recorder.snapshot() === recordingBefore) this.recorder.clear();
    return created;
  }
  async createAction(setId: string, name: string) {
    this.playback.clear();
    this.recorder.clear();
    this.recordingSetId = setId;
    const recording = this.recorder.start(name);
    const placeholder: ActionRecordingSnapshot = {
      ...recording,
      status: 'stopped',
      stoppedAt: recording.startedAt
    };
    const saved = await this.library.save(placeholder, recording.name, setId);
    if (!saved) {
      this.recordingSetId = null;
      this.recorder.clear();
    }
    return saved;
  }
  renameSet = (id: string, name: string) => this.library.renameSet(id, name);
  async selectSet(id: string) {
    const recordingBefore = this.recorder.snapshot();
    const selected = await this.library.selectSet(id);
    if (!selected) return null;
    // Persisting a set selection is asynchronous. Never let its completion
    // erase a recording that the user started while that write was pending.
    if (this.recorder.snapshot() !== recordingBefore) return selected;
    const actionId = this.library.snapshot().selectedId;
    const action = actionId
      ? this.library.snapshot().actions.find((candidate) => candidate.id === actionId) : null;
    if (action) {
      this.recordingSetId = action.setId;
      this.recorder.restore(action.recording);
    } else {
      this.recordingSetId = null;
      this.recorder.clear();
    }
    return selected;
  }
  async deleteSet(id: string): Promise<boolean> {
    const deleted = await this.library.deleteSet(id);
    if (deleted) this.restoreLibrarySelection();
    return deleted;
  }
  moveSet = (id: string, direction: -1 | 1): Promise<boolean> => this.library.moveSet(id, direction);
  async deleteSaved(id: string): Promise<boolean> {
    const deleted = await this.library.delete(id);
    if (deleted && this.recorder.snapshot().id === id) this.restoreLibrarySelection();
    return deleted;
  }
  async renameSaved(id: string, name: string) {
    const renamed = await this.library.rename(id, name);
    if (renamed && this.recorder.snapshot().id === id) this.recorder.restore(renamed.recording);
    return renamed;
  }
  async duplicateSaved(id: string) {
    const duplicated = await this.library.duplicate(id);
    if (duplicated) this.recorder.restore(duplicated.recording);
    return duplicated;
  }
  moveSaved = (id: string, direction: -1 | 1) => this.library.move(id, direction);
  async setSavedEnabled(id: string, enabled: boolean) {
    const action = await this.library.setEnabled(id, enabled);
    if (action && this.recorder.snapshot().id === id) this.recorder.restore(action.recording);
    return action;
  }
  async setSetEnabled(id: string, enabled: boolean) {
    const actions = await this.library.setSetEnabled(id, enabled);
    const loaded = actions?.find((action) => action.id === this.recorder.snapshot().id);
    if (loaded) this.recorder.restore(loaded.recording);
    return actions;
  }

  async saveRecording(name: string) {
    const recording = this.recorder.snapshot();
    const saved = await this.library.save(recording, name,
      this.recordingSetId ?? this.library.snapshot().selectedSetId);
    // Saving may finish after the user has already started the next Action.
    // Persist the completed recording, but never replace newer recorder state.
    if (saved && this.recorder.snapshot() === recording) this.recorder.restore(saved.recording);
    return saved;
  }

  async loadSaved(id: string): Promise<ActionRecordingSnapshot | null> {
    this.playback.clear();
    const action = await this.library.select(id);
    if (!action) return null;
    this.recordingSetId = action.setId;
    return this.recorder.restore(action.recording);
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
  continueInteractivePlayback = (parameters: Readonly<Record<string, unknown>>): void => (
    this.playback.continueInteractive(parameters)
  );
  cancelInteractivePlayback = (): void => this.playback.cancelInteractive();

  record(request: LightTableCommandRequest, result: LightTableCommandResult,
    startedAt: number, recordingId: string | null,
    origin: LightTableCommandOrigin): void {
    this.recorder.record(request, result, startedAt, recordingId, origin);
  }

  completeTask(taskId: string, value: unknown): boolean {
    return this.recorder.completeTask(taskId, value);
  }

  private restoreLibrarySelection(): void {
    const snapshot = this.library.snapshot();
    const selected = snapshot.selectedId
      ? snapshot.actions.find((action) => action.id === snapshot.selectedId) : null;
    if (selected) {
      this.recordingSetId = selected.setId;
      this.recorder.restore(selected.recording);
    } else {
      this.recordingSetId = null;
      this.recorder.clear();
    }
  }
}
