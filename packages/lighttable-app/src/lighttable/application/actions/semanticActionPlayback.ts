import { LIGHTTABLE_COMMAND_PROTOCOL_VERSION } from '@lighttable/command-contract';
import type {
  LightTableCommandRequest,
  LightTableCommandResult
} from '../commands/lightTableCommandContract';
import type { ActionRecordingSnapshot, RecordedActionStep } from './semanticActionRecorder';
import { resolveActionParameters } from './actionResultBindings';
import { checkActionCommandContracts } from './actionCommandContracts';

export interface ActionPlaybackStepResult {
  readonly sequence: number;
  readonly command: string;
  readonly status: LightTableCommandResult['status'] | 'binding-error'
    | 'contract-incompatible' | 'task-failed' | 'task-canceled' | 'task-timeout' | 'task-missing';
  readonly message: string | null;
  readonly durationMs: number;
}

export interface ActionPlaybackSnapshot {
  readonly status: 'idle' | 'running' | 'completed' | 'failed' | 'stopped';
  readonly currentSequence: number | null;
  readonly results: readonly ActionPlaybackStepResult[];
  readonly taskProgress: number | null;
}

export type ActionTaskWaitResult =
  | { readonly status: 'completed'; readonly value: unknown }
  | { readonly status: 'failed' | 'canceled' | 'timeout' | 'missing'; readonly message: string };
export interface ActionTaskPlaybackPort {
  wait(documentId: string, taskId: string, signal: AbortSignal,
    onProgress: (progress: number | null) => void): Promise<ActionTaskWaitResult>;
}

type ExecuteCommand = (request: LightTableCommandRequest) => Promise<LightTableCommandResult>;
const initialSnapshot = (): ActionPlaybackSnapshot => ({
  status: 'idle', currentSequence: null, results: [], taskProgress: null
});
const returnedDocumentId = (value: unknown): string | null => (
  typeof value === 'object' && value !== null && 'documentId' in value
    && typeof value.documentId === 'string' && value.documentId.length > 0
    ? value.documentId : null
);

const collectResultBindingDependencies = (value: unknown, dependencies: Set<number>): void => {
  if (!value || typeof value !== 'object') return;
  if (!Array.isArray(value) && '$lighttableResult' in value) {
    const binding = (value as { readonly $lighttableResult?: unknown }).$lighttableResult;
    if (typeof binding === 'object' && binding !== null && 'step' in binding
      && Number.isSafeInteger(binding.step) && (binding.step as number) > 0) {
      dependencies.add(binding.step as number);
      return;
    }
  }
  if (Array.isArray(value)) value.forEach((child) => collectResultBindingDependencies(child, dependencies));
  else Object.values(value).forEach((child) => collectResultBindingDependencies(child, dependencies));
};

const dependencyAwareSteps = (
  recording: ActionRecordingSnapshot,
  requested: readonly RecordedActionStep[]
): readonly RecordedActionStep[] => {
  const bySequence = new Map(recording.steps.map((step) => [step.sequence, step]));
  const included = new Set(requested.map(({ sequence }) => sequence));
  const pending = [...included];
  while (pending.length) {
    const sequence = pending.pop()!;
    const step = bySequence.get(sequence);
    if (!step) continue;
    const dependencies = new Set<number>();
    collectResultBindingDependencies(step.parameters, dependencies);
    if (step.documentId) {
      const producer = recording.steps.find((candidate) => candidate.sequence < sequence
        && returnedDocumentId(candidate.result) === step.documentId);
      if (producer) dependencies.add(producer.sequence);
    }
    for (const dependency of dependencies) {
      const producer = bySequence.get(dependency);
      // Forward references and non-replayable producers remain absent so the
      // existing binding/target validation fails closed at execution time.
      if (!producer?.replayable || producer.sequence >= sequence || included.has(producer.sequence)) continue;
      included.add(producer.sequence);
      pending.push(producer.sequence);
    }
  }
  return recording.steps.filter(({ sequence, replayable }) => replayable && included.has(sequence));
};

export class SemanticActionPlaybackController {
  private snapshotValue = initialSnapshot();
  private readonly listeners = new Set<() => void>();
  private stopRequested = false;
  private taskAbort: AbortController | null = null;

  constructor(private readonly execute: ExecuteCommand,
    private readonly tasks?: ActionTaskPlaybackPort) {}

  snapshot = (): ActionPlaybackSnapshot => this.snapshotValue;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  async play(recording: ActionRecordingSnapshot, targetDocumentId?: string): Promise<ActionPlaybackSnapshot> {
    return this.run(recording, recording.steps.filter(({ replayable }) => replayable), targetDocumentId);
  }

  async playStep(recording: ActionRecordingSnapshot, sequence: number,
    targetDocumentId?: string): Promise<ActionPlaybackSnapshot> {
    const step = recording.steps.find((candidate) => candidate.sequence === sequence && candidate.replayable);
    return this.run(recording, step ? dependencyAwareSteps(recording, [step]) : [], targetDocumentId);
  }

  async playFrom(recording: ActionRecordingSnapshot, sequence: number,
    targetDocumentId?: string): Promise<ActionPlaybackSnapshot> {
    const steps = recording.steps.filter((candidate) => candidate.replayable
      && candidate.sequence >= sequence);
    return this.run(recording, dependencyAwareSteps(recording, steps), targetDocumentId);
  }

  stop(): void {
    if (this.snapshotValue.status === 'running') {
      this.stopRequested = true;
      this.taskAbort?.abort();
    }
  }

  clear(): void {
    if (this.snapshotValue.status !== 'running') this.publish(initialSnapshot());
  }

  private async run(recording: ActionRecordingSnapshot,
    steps: readonly RecordedActionStep[], targetDocumentId?: string): Promise<ActionPlaybackSnapshot> {
    if (this.snapshotValue.status === 'running') return this.snapshotValue;
    const contracts = checkActionCommandContracts(recording.steps);
    if (!contracts.ok) {
      this.publish({ status: 'failed', currentSequence: contracts.sequence, taskProgress: null,
        results: [{ sequence: contracts.sequence,
          command: recording.steps.find(({ sequence }) => sequence === contracts.sequence)?.command ?? 'unknown',
          status: 'contract-incompatible', message: contracts.message, durationMs: 0 }] });
      return this.snapshotValue;
    }
    this.stopRequested = false;
    this.publish({ status: 'running', currentSequence: null, results: [], taskProgress: null });
    const producedResults = new Map<number, unknown>();
    const replayDocumentIds = new Map<string, string>();
    for (const step of steps) {
      if (this.stopRequested) {
        this.publish({ ...this.snapshotValue, status: 'stopped', currentSequence: null,
          taskProgress: null });
        return this.snapshotValue;
      }
      this.publish({ ...this.snapshotValue, currentSequence: step.sequence, taskProgress: null });
      const startedAt = Date.now();
      const parameters = resolveActionParameters(step.parameters, producedResults);
      if ('error' in parameters) {
        const result: ActionPlaybackStepResult = {
          sequence: step.sequence, command: step.command, status: 'binding-error',
          message: parameters.error, durationMs: Math.max(0, Date.now() - startedAt)
        };
        this.publish({ status: 'failed', currentSequence: step.sequence,
          results: [...this.snapshotValue.results, result], taskProgress: null });
        return this.snapshotValue;
      }
      const resolvedDocumentId = step.documentId
        ? replayDocumentIds.get(step.documentId) ?? targetDocumentId ?? step.documentId
        : undefined;
      const result = await this.execute({
        protocolVersion: LIGHTTABLE_COMMAND_PROTOCOL_VERSION,
        requestId: `action-play-${recording.id ?? 'unsaved'}-${step.sequence}-${startedAt}`,
        command: step.command,
        ...(resolvedDocumentId ? { documentId: resolvedDocumentId } : {}),
        parameters: parameters.value
      });
      const entry: ActionPlaybackStepResult = {
        sequence: step.sequence,
        command: step.command,
        status: result.status,
        message: result.status === 'rejected' ? result.message : null,
        durationMs: Math.max(0, Date.now() - startedAt)
      };
      const results = [...this.snapshotValue.results, entry];
      if (result.status === 'rejected') {
        this.publish({ status: 'failed', currentSequence: step.sequence, results, taskProgress: null });
        return this.snapshotValue;
      }
      if (result.status === 'accepted') {
        if (!this.tasks || !step.documentId) {
          const unsupported: ActionPlaybackStepResult = { sequence: step.sequence,
            command: step.command, status: 'task-missing',
            message: 'No task observer is available for this Action step.',
            durationMs: Math.max(0, Date.now() - startedAt) };
          this.publish({ status: 'failed', currentSequence: step.sequence,
            results: [...this.snapshotValue.results, unsupported], taskProgress: null });
          return this.snapshotValue;
        }
        this.taskAbort = new AbortController();
        const waiting = this.tasks.wait(resolvedDocumentId!, result.taskId,
          this.taskAbort.signal, (taskProgress) => {
            if (this.snapshotValue.status === 'running') {
              this.publish({ ...this.snapshotValue, taskProgress });
            }
          });
        if (this.stopRequested) this.taskAbort.abort();
        const task = await waiting;
        this.taskAbort = null;
        if (this.stopRequested) {
          this.publish({ ...this.snapshotValue, status: 'stopped', currentSequence: null,
            taskProgress: null });
          return this.snapshotValue;
        }
        if (task.status !== 'completed') {
          const terminal: ActionPlaybackStepResult = { sequence: step.sequence,
            command: step.command, status: `task-${task.status}`,
            message: task.message, durationMs: Math.max(0, Date.now() - startedAt) };
          this.publish({ status: 'failed', currentSequence: step.sequence,
            results: [...this.snapshotValue.results, terminal], taskProgress: null });
          return this.snapshotValue;
        }
        if (step.command.startsWith('file.export')
          && (!(typeof task.value === 'object' && task.value !== null && 'artifact' in task.value)
            || task.value.artifact === null)) {
          const missingArtifact: ActionPlaybackStepResult = { sequence: step.sequence,
            command: step.command, status: 'task-missing',
            message: 'The completed export did not publish an artifact.',
            durationMs: Math.max(0, Date.now() - startedAt) };
          this.publish({ status: 'failed', currentSequence: step.sequence,
            results: [...this.snapshotValue.results, missingArtifact], taskProgress: null });
          return this.snapshotValue;
        }
        const taskValue = typeof task.value === 'object' && task.value !== null
          ? task.value : { value: task.value };
        producedResults.set(step.sequence, { taskId: result.taskId, ...taskValue });
        const completed: ActionPlaybackStepResult = { sequence: step.sequence,
          command: step.command, status: 'completed', message: null,
          durationMs: Math.max(0, Date.now() - startedAt) };
        this.publish({ ...this.snapshotValue,
          results: [...this.snapshotValue.results, completed], taskProgress: null });
      } else {
        producedResults.set(step.sequence, result.value);
        const recordedDocumentId = returnedDocumentId(step.result);
        const createdDocumentId = returnedDocumentId(result.value);
        // Both workspace document creation and a source-scoped document fork
        // can produce the runtime document targeted by later recorded steps.
        // Always remap that returned identity for the remainder of this replay.
        if (recordedDocumentId && createdDocumentId) {
          replayDocumentIds.set(recordedDocumentId, createdDocumentId);
        }
        this.publish({ ...this.snapshotValue, results, taskProgress: null });
      }
    }
    this.publish({ ...this.snapshotValue, status: 'completed', currentSequence: null,
      taskProgress: null });
    return this.snapshotValue;
  }

  private publish(snapshot: ActionPlaybackSnapshot): void {
    this.snapshotValue = snapshot;
    for (const listener of this.listeners) listener();
  }
}
