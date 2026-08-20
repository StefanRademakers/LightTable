import type {
  LightTableCommandRequest,
  LightTableCommandOrigin,
  LightTableCommandResult
} from '../commands/lightTableCommandContract';
import { bindRecordedParameters } from './actionResultBindings';
import { currentRecordedCommandContract, type RecordedCommandContract } from './actionCommandContracts';

export interface RecordedActionStep {
  readonly sequence: number;
  readonly requestId: string;
  readonly origin: LightTableCommandOrigin;
  readonly command: string;
  readonly contract: RecordedCommandContract;
  readonly documentId: string | null;
  readonly parameters: unknown;
  readonly outcome: LightTableCommandResult['status'];
  readonly result: unknown;
  readonly startedAt: number;
  readonly durationMs: number;
  readonly replayable: boolean;
  readonly note: string | null;
}

export interface ActionRecordingSnapshot {
  readonly status: 'idle' | 'recording' | 'stopped';
  readonly id: string | null;
  readonly name: string;
  readonly startedAt: number | null;
  readonly stoppedAt: number | null;
  readonly steps: readonly RecordedActionStep[];
  readonly byteLength: number;
  readonly limitReached: boolean;
}

const MAX_STEPS = 256;
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_STEP_BYTES = 256 * 1024;
const NON_REPLAYABLE_COMMANDS = new Set(['history.undo', 'history.redo', 'task.cancel']);

const cloneBounded = (value: unknown): { value: unknown; bytes: number; complete: boolean } => {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) return { value: null, bytes: 4, complete: false };
    const bytes = new TextEncoder().encode(serialized).byteLength;
    if (bytes > MAX_STEP_BYTES) {
      return { value: { omitted: true, byteLength: bytes }, bytes: 48, complete: false };
    }
    return { value: JSON.parse(serialized), bytes, complete: true };
  } catch {
    return { value: { omitted: true, reason: 'not-json-serializable' }, bytes: 64, complete: false };
  }
};

const initialSnapshot = (): ActionRecordingSnapshot => ({
  status: 'idle', id: null, name: 'Untitled Action', startedAt: null, stoppedAt: null,
  steps: [], byteLength: 0, limitReached: false
});

export class SemanticActionRecorder {
  private snapshotValue = initialSnapshot();
  private readonly listeners = new Set<() => void>();
  private readonly completedTasks = new Map<string, unknown>();

  snapshot = (): ActionRecordingSnapshot => this.snapshotValue;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  start(name = 'Untitled Action'): ActionRecordingSnapshot {
    this.completedTasks.clear();
    const startedAt = Date.now();
    this.publish({ status: 'recording', id: `action-${startedAt}`, name: name.trim() || 'Untitled Action',
      startedAt, stoppedAt: null, steps: [], byteLength: 0, limitReached: false });
    return this.snapshotValue;
  }

  stop(): ActionRecordingSnapshot {
    if (this.snapshotValue.status === 'recording') {
      this.publish({ ...this.snapshotValue, status: 'stopped', stoppedAt: Date.now() });
    }
    return this.snapshotValue;
  }

  clear(): ActionRecordingSnapshot {
    this.completedTasks.clear();
    this.publish(initialSnapshot());
    return this.snapshotValue;
  }

  restore(snapshot: ActionRecordingSnapshot): ActionRecordingSnapshot {
    this.publish(structuredClone(snapshot));
    return this.snapshotValue;
  }

  completeTask(taskId: string, value: unknown): boolean {
    const index = this.snapshotValue.steps.findIndex((step) => step.outcome === 'accepted'
      && typeof step.result === 'object' && step.result !== null
      && 'taskId' in step.result && step.result.taskId === taskId);
    if (index < 0) {
      const queued = cloneBounded(value);
      if (!queued.complete) return false;
      this.completedTasks.set(taskId, queued.value);
      if (this.completedTasks.size > MAX_STEPS) {
        this.completedTasks.delete(this.completedTasks.keys().next().value!);
      }
      return true;
    }
    const previous = this.snapshotValue.steps[index]!;
    const nextResult = cloneBounded({ taskId, ...(typeof value === 'object' && value !== null
      ? value : { value }) });
    if (!nextResult.complete) return false;
    const previousBytes = cloneBounded(previous.result).bytes;
    const byteLength = this.snapshotValue.byteLength - previousBytes + nextResult.bytes;
    if (byteLength > MAX_BYTES) return false;
    const steps = [...this.snapshotValue.steps];
    steps[index] = { ...previous, result: nextResult.value };
    this.publish({ ...this.snapshotValue, steps, byteLength });
    return true;
  }

  record(request: LightTableCommandRequest, result: LightTableCommandResult, startedAt: number,
    recordingId = this.snapshotValue.id, origin: LightTableCommandOrigin = 'ui'): void {
    if (!recordingId || this.snapshotValue.id !== recordingId
      || this.snapshotValue.status === 'idle' || this.snapshotValue.limitReached) return;
    const rawParameters = cloneBounded(request.parameters);
    const parameters = rawParameters.complete
      ? cloneBounded(bindRecordedParameters(rawParameters.value, this.snapshotValue.steps))
      : rawParameters;
    const completedTask = result.status === 'accepted'
      ? this.completedTasks.get(result.taskId) : undefined;
    if (result.status === 'accepted') this.completedTasks.delete(result.taskId);
    const resultValue = cloneBounded(result.status === 'completed' ? result.value
      : result.status === 'accepted' ? { taskId: result.taskId,
        ...(typeof completedTask === 'object' && completedTask !== null
          ? completedTask : completedTask === undefined ? {} : { value: completedTask }) }
        : { code: result.code, message: result.message });
    const nextBytes = this.snapshotValue.byteLength + parameters.bytes + resultValue.bytes;
    if (this.snapshotValue.steps.length >= MAX_STEPS || nextBytes > MAX_BYTES) {
      this.publish({ ...this.snapshotValue, limitReached: true });
      return;
    }
    const successful = result.status === 'completed' || result.status === 'accepted';
    const replayable = (result.status === 'completed' || result.status === 'accepted') && parameters.complete
      && !NON_REPLAYABLE_COMMANDS.has(request.command);
    const note = successful
      ? result.status === 'accepted' ? null
        : parameters.complete ? NON_REPLAYABLE_COMMANDS.has(request.command) ? 'Control/history commands are diagnostic only.' : null
        : 'Parameters exceeded the recorder transport boundary.'
      : 'Rejected commands are retained for debugging but are not replayable.';
    const step: RecordedActionStep = {
      sequence: this.snapshotValue.steps.length + 1,
      requestId: request.requestId,
      origin,
      command: request.command,
      contract: currentRecordedCommandContract(request.command),
      documentId: request.documentId ?? null,
      parameters: parameters.value,
      outcome: result.status,
      result: resultValue.value,
      startedAt,
      durationMs: Math.max(0, Date.now() - startedAt),
      replayable,
      note
    };
    this.publish({ ...this.snapshotValue, steps: [...this.snapshotValue.steps, step], byteLength: nextBytes });
  }

  private publish(snapshot: ActionRecordingSnapshot): void {
    this.snapshotValue = snapshot;
    for (const listener of this.listeners) listener();
  }
}
