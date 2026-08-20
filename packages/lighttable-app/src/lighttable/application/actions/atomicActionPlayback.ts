import {
  LIGHTTABLE_COMMAND_SCHEMAS,
  formatSchemaValidationIssues,
  validateJsonSchemaValue
} from '@lighttable/command-contract';
import { ATOMIC_BATCH_COMMANDS } from '../commands/atomicCommandBatchContract';
import type { AtomicCommandBatch } from '../commands/atomicCommandBatchContract';
import { checkActionCommandContracts } from './actionCommandContracts';
import {
  actionVariableValueMatchesType,
  isActionResultReference,
  isActionVariableReference
} from './actionResultBindings';
import type { ActionRecordingSnapshot, RecordedActionStep } from './semanticActionRecorder';
import { atomicActionEligibility } from './atomicActionEligibility';

export type AtomicActionPlan = {
  readonly documentId: string;
  readonly batch: AtomicCommandBatch;
  readonly steps: readonly RecordedActionStep[];
};
export type AtomicActionCompileResult = { readonly ok: true; readonly plan: AtomicActionPlan }
  | { readonly ok: false; readonly error: string };

const own = (value: Readonly<Record<string, unknown>>, key: string): boolean => (
  Object.prototype.hasOwnProperty.call(value, key)
);

const transformParameters = (
  value: unknown,
  sequence: number,
  variables: ReadonlyMap<string, unknown>,
  operationIds: ReadonlyMap<number, string>
): unknown => {
  if (isActionVariableReference(value)) {
    const name = value.$lighttableVariable.name;
    if (!variables.has(name)) throw new Error(`Variable ${name} has no value.`);
    return structuredClone(variables.get(name));
  }
  if (isActionResultReference(value)) {
    const { step, path } = value.$lighttableResult;
    const operationId = operationIds.get(step);
    if (!operationId || step >= sequence) {
      throw new Error(`Step ${sequence} has an unavailable or forward result binding to step ${step}.`);
    }
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/u.test(path)) {
      throw new Error(`Step ${sequence} result binding ${path} is nested and cannot run atomically.`);
    }
    return { resultOf: operationId, field: path };
  }
  if (Array.isArray(value)) {
    return value.map((entry) => transformParameters(entry, sequence, variables, operationIds));
  }
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
    key, transformParameters(entry, sequence, variables, operationIds)
  ]));
};

export const compileAtomicAction = (
  recording: ActionRecordingSnapshot,
  targetDocumentId?: string,
  overrides: Readonly<Record<string, unknown>> = {}
): AtomicActionCompileResult => {
  const eligibility = atomicActionEligibility(recording);
  if (!eligibility.eligible) return { ok: false, error: eligibility.reason };
  const recordedDocumentIds = new Set(recording.steps.map(({ documentId }) => documentId));
  const actionName = recording.name.trim();
  const variables = recording.variables ?? [];
  const names = new Set(variables.map(({ name }) => name));
  const unknownOverride = Object.keys(overrides).find((name) => !names.has(name));
  if (unknownOverride) return { ok: false, error: `Unknown Action variable ${unknownOverride}.` };
  const invalidOverride = variables.find((variable) => own(overrides, variable.name)
    && !actionVariableValueMatchesType(variable.type, overrides[variable.name]));
  if (invalidOverride) {
    return { ok: false,
      error: `Action variable ${invalidOverride.name} requires a ${invalidOverride.type} value.` };
  }
  const effectiveVariables = variables.map((variable) => own(overrides, variable.name)
    ? { ...variable, defaultValue: overrides[variable.name] } : variable);
  const variableValues = new Map(effectiveVariables.map(({ name, defaultValue }) => [name, defaultValue]));
  const operationIds = new Map(recording.steps.map(({ sequence }) => [sequence, `step-${sequence}`]));
  try {
    const batch: AtomicCommandBatch = {
      name: actionName,
      timeoutMs: 5_000,
      operations: recording.steps.map((step) => ({
        operationId: operationIds.get(step.sequence)!,
        command: step.command as typeof ATOMIC_BATCH_COMMANDS[number],
        parameters: transformParameters(step.parameters, step.sequence, variableValues, operationIds)
      }))
    };
    const contracts = checkActionCommandContracts(recording.steps, false, effectiveVariables);
    if (!contracts.ok) return { ok: false, error: contracts.message };
    const validation = validateJsonSchemaValue(LIGHTTABLE_COMMAND_SCHEMAS['command.batch']!.input, batch);
    if (!validation.valid) {
      return { ok: false,
        error: `Atomic playback preflight failed: ${formatSchemaValidationIssues(validation.issues)}.` };
    }
    return { ok: true, plan: { documentId: targetDocumentId ?? [...recordedDocumentIds][0]!,
      batch, steps: recording.steps } };
  } catch (reason) {
    return { ok: false, error: reason instanceof Error ? reason.message : String(reason) };
  }
};
