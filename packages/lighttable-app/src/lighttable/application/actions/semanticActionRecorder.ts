import type {
  LightTableCommandRequest,
  LightTableCommandOrigin,
  LightTableCommandResult
} from '../commands/lightTableCommandContract';
import {
  ACTION_VARIABLE_NAME_PATTERN,
  LIGHTTABLE_MAX_ACTION_VARIABLES,
  actionVariableValueMatchesType,
  inferActionVariableType,
  isActionResultReference,
  isActionVariableReference,
  resolveActionParameters,
  type ActionVariableDefinition
} from './actionResultBindings';
import { bindRecordedParameters } from './actionResultBindings';
import {
  checkActionCommandContracts,
  currentRecordedCommandContract,
  type RecordedCommandContract
} from './actionCommandContracts';

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
  readonly variables: readonly ActionVariableDefinition[];
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
  steps: [], variables: [], byteLength: 0, limitReached: false
});

const decodePointer = (path: string): string[] | null => {
  if (!path.startsWith('/')) return null;
  return path.slice(1).split('/').map((part) => part.replace(/~1/gu, '/').replace(/~0/gu, '~'));
};

const valueAtPointer = (value: unknown, path: string): unknown => {
  const parts = decodePointer(path);
  if (!parts) return undefined;
  return parts.reduce<unknown>((current, part) => {
    if (Array.isArray(current) && /^\d+$/u.test(part)) return current[Number(part)];
    return typeof current === 'object' && current !== null ? (current as Record<string, unknown>)[part] : undefined;
  }, value);
};

const replaceAtPointer = (value: unknown, path: string, replacement: unknown): unknown | undefined => {
  const parts = decodePointer(path);
  if (!parts?.length) return undefined;
  const visit = (current: unknown, depth: number): unknown | undefined => {
    const key = parts[depth]!;
    if (Array.isArray(current) && /^\d+$/u.test(key)) {
      const index = Number(key);
      if (index >= current.length) return undefined;
      const copy = [...current];
      copy[index] = depth === parts.length - 1 ? replacement : visit(copy[index], depth + 1);
      return copy[index] === undefined ? undefined : copy;
    }
    if (typeof current !== 'object' || current === null || !(key in current)) return undefined;
    const copy = { ...(current as Record<string, unknown>) };
    copy[key] = depth === parts.length - 1 ? replacement : visit(copy[key], depth + 1);
    return copy[key] === undefined ? undefined : copy;
  };
  return visit(value, 0);
};

export type ActionRecordingEditResult = { readonly ok: true } | { readonly ok: false; readonly error: string };

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
      startedAt, stoppedAt: null, steps: [], variables: [], byteLength: 0, limitReached: false });
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

  createVariable(sequence: number, parameterPath: string, name: string): ActionRecordingEditResult {
    const normalized = name.trim();
    if (!ACTION_VARIABLE_NAME_PATTERN.test(normalized)) {
      return { ok: false, error: 'Variable names must start with a letter and contain only letters, numbers, _ or -.' };
    }
    if (this.snapshotValue.variables.length >= LIGHTTABLE_MAX_ACTION_VARIABLES) {
      return { ok: false, error: `An Action can contain at most ${LIGHTTABLE_MAX_ACTION_VARIABLES} variables.` };
    }
    if (this.snapshotValue.variables.some((variable) => variable.name === normalized)) {
      return { ok: false, error: `Variable ${normalized} already exists.` };
    }
    const step = this.snapshotValue.steps.find((candidate) => candidate.sequence === sequence);
    if (!step) return { ok: false, error: `Step ${sequence} does not exist.` };
    const defaults = new Map(this.snapshotValue.variables.map(({ name: key, defaultValue }) => [key, defaultValue]));
    const recordedResults = new Map(this.snapshotValue.steps
      .filter((candidate) => candidate.sequence < sequence).map((candidate) => [candidate.sequence, candidate.result]));
    const resolved = resolveActionParameters(step.parameters, recordedResults, defaults);
    if ('error' in resolved) return { ok: false, error: resolved.error };
    const defaultValue = valueAtPointer(resolved.value, parameterPath);
    if (defaultValue === undefined) return { ok: false, error: `Parameter ${parameterPath} does not exist.` };
    return this.applyEdit([...this.snapshotValue.variables, {
      name: normalized, type: inferActionVariableType(defaultValue), defaultValue: structuredClone(defaultValue)
    }], sequence, parameterPath, { $lighttableVariable: { name: normalized } });
  }

  updateVariable(name: string, defaultValue: unknown): ActionRecordingEditResult {
    const variable = this.snapshotValue.variables.find((candidate) => candidate.name === name);
    if (!variable) return { ok: false, error: `Variable ${name} does not exist.` };
    if (!actionVariableValueMatchesType(variable.type, defaultValue)) {
      return { ok: false, error: `Variable ${name} requires a ${variable.type} value.` };
    }
    const variables = this.snapshotValue.variables.map((candidate) => candidate.name === name
      ? { ...candidate, defaultValue: structuredClone(defaultValue) } : candidate);
    return this.applySnapshot({ ...this.snapshotValue, variables });
  }

  deleteVariable(name: string): ActionRecordingEditResult {
    const variable = this.snapshotValue.variables.find((candidate) => candidate.name === name);
    if (!variable) return { ok: false, error: `Variable ${name} does not exist.` };
    const replace = (value: unknown): unknown => {
      if (isActionVariableReference(value) && value.$lighttableVariable.name === name) {
        return structuredClone(variable.defaultValue);
      }
      if (Array.isArray(value)) return value.map(replace);
      if (typeof value !== 'object' || value === null) return value;
      return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, replace(child)]));
    };
    return this.applySnapshot({ ...this.snapshotValue,
      variables: this.snapshotValue.variables.filter((candidate) => candidate.name !== name),
      steps: this.snapshotValue.steps.map((step) => ({ ...step, parameters: replace(step.parameters) })) });
  }

  bindVariable(sequence: number, parameterPath: string, name: string): ActionRecordingEditResult {
    if (!this.snapshotValue.variables.some((variable) => variable.name === name)) {
      return { ok: false, error: `Variable ${name} does not exist.` };
    }
    return this.applyEdit(this.snapshotValue.variables, sequence, parameterPath,
      { $lighttableVariable: { name } });
  }

  bindResult(sequence: number, parameterPath: string, producerStep: number,
    resultPath: string): ActionRecordingEditResult {
    if (producerStep >= sequence) return { ok: false, error: 'A result binding must reference an earlier step.' };
    const producer = this.snapshotValue.steps.find((step) => step.sequence === producerStep && step.replayable);
    if (!producer) return { ok: false, error: `Producer step ${producerStep} is unavailable.` };
    return this.applyEdit(this.snapshotValue.variables, sequence, parameterPath,
      { $lighttableResult: { step: producerStep, path: resultPath } });
  }

  restoreLiteral(sequence: number, parameterPath: string): ActionRecordingEditResult {
    const step = this.snapshotValue.steps.find((candidate) => candidate.sequence === sequence);
    const current = step ? valueAtPointer(step.parameters, parameterPath) : undefined;
    if (!isActionResultReference(current) && !isActionVariableReference(current)) {
      return { ok: false, error: 'The selected parameter is not bound.' };
    }
    const variables = new Map(this.snapshotValue.variables.map(({ name, defaultValue }) => [name, defaultValue]));
    const results = new Map(this.snapshotValue.steps.filter(({ sequence: candidate }) => candidate < sequence)
      .map((candidate) => [candidate.sequence, candidate.result]));
    const resolved = resolveActionParameters(current, results, variables);
    if ('error' in resolved) return { ok: false, error: resolved.error };
    return this.applyEdit(this.snapshotValue.variables, sequence, parameterPath, resolved.value);
  }

  replaceParameters(sequence: number,
    parameters: Readonly<Record<string, unknown>>): ActionRecordingEditResult {
    const step = this.snapshotValue.steps.find((candidate) => candidate.sequence === sequence);
    if (!step) return { ok: false, error: `Step ${sequence} does not exist.` };
    return this.applySnapshot({ ...this.snapshotValue,
      steps: this.snapshotValue.steps.map((candidate) => candidate.sequence === sequence
        ? { ...candidate, parameters: structuredClone(parameters) } : candidate) });
  }

  private applyEdit(variables: readonly ActionVariableDefinition[], sequence: number,
    parameterPath: string, replacement: unknown): ActionRecordingEditResult {
    const step = this.snapshotValue.steps.find((candidate) => candidate.sequence === sequence);
    if (!step) return { ok: false, error: `Step ${sequence} does not exist.` };
    const parameters = replaceAtPointer(step.parameters, parameterPath, replacement);
    if (parameters === undefined) return { ok: false, error: `Parameter ${parameterPath} does not exist.` };
    return this.applySnapshot({ ...this.snapshotValue, variables,
      steps: this.snapshotValue.steps.map((candidate) => candidate.sequence === sequence
        ? { ...candidate, parameters } : candidate) });
  }

  private applySnapshot(snapshot: ActionRecordingSnapshot): ActionRecordingEditResult {
    if (this.snapshotValue.status !== 'stopped') {
      return { ok: false, error: 'Stop the Action before editing variables or bindings.' };
    }
    const contracts = checkActionCommandContracts(snapshot.steps, false, snapshot.variables);
    if (!contracts.ok) return { ok: false, error: contracts.message };
    let byteLength: number;
    try {
      byteLength = new TextEncoder().encode(JSON.stringify({ variables: snapshot.variables,
        steps: snapshot.steps.map(({ parameters, result }) => ({ parameters, result })) })).byteLength;
    } catch {
      return { ok: false, error: 'The edited Action is not JSON serializable.' };
    }
    if (byteLength > MAX_BYTES) {
      return { ok: false, error: 'The edited Action exceeds the recorder boundary.' };
    }
    this.publish({ ...snapshot, steps: contracts.steps, byteLength });
    return { ok: true };
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
