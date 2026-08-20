import React, { useMemo, useState } from 'react';
import {
  LIGHTTABLE_COMMAND_SCHEMAS,
  type LightTableCommandId
} from '@lighttable/command-contract';
import {
  isActionResultReference,
  isActionVariableReference,
  resolveActionParameters,
  type ActionVariableDefinition
} from '../../../application/actions/actionResultBindings';
import type {
  ActionRecordingEditResult,
  RecordedActionStep
} from '../../../application/actions/semanticActionRecorder';
import { CommandParameterEditor } from './CommandParameterEditor';

const record = (value: unknown): value is Readonly<Record<string, unknown>> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const sameJsonValue = (left: unknown, right: unknown): boolean => {
  try { return JSON.stringify(left) === JSON.stringify(right); } catch { return false; }
};

const preserveBindings = (recorded: unknown, displayed: unknown, edited: unknown): {
  readonly value: unknown;
  readonly changedBoundValue: boolean;
} => {
  if (isActionResultReference(recorded) || isActionVariableReference(recorded)) {
    return { value: structuredClone(recorded), changedBoundValue: !sameJsonValue(displayed, edited) };
  }
  if (Array.isArray(recorded) && Array.isArray(displayed) && Array.isArray(edited)) {
    const children = edited.map((value, index) => preserveBindings(recorded[index], displayed[index], value));
    return { value: children.map((child) => child.value),
      changedBoundValue: children.some((child) => child.changedBoundValue) };
  }
  if (record(recorded) && record(displayed) && record(edited)) {
    const children = Object.entries(edited).map(([key, value]) => [key,
      preserveBindings(recorded[key], displayed[key], value)] as const);
    return { value: Object.fromEntries(children.map(([key, child]) => [key, child.value])),
      changedBoundValue: children.some(([, child]) => child.changedBoundValue) };
  }
  return { value: edited, changedBoundValue: false };
};

export const ActionStepParameterEditor: React.FC<{
  readonly step: RecordedActionStep;
  readonly priorSteps: readonly RecordedActionStep[];
  readonly variables: readonly ActionVariableDefinition[];
  readonly disabled: boolean;
  readonly onApply: (parameters: Readonly<Record<string, unknown>>) => ActionRecordingEditResult;
}> = ({ step, priorSteps, variables, disabled, onApply }) => {
  const [result, setResult] = useState<string | null>(null);
  const schema = LIGHTTABLE_COMMAND_SCHEMAS[step.command as LightTableCommandId]?.input;
  const resolved = useMemo(() => resolveActionParameters(step.parameters,
    new Map(priorSteps.map((candidate) => [candidate.sequence, candidate.result])),
    new Map(variables.map(({ name, defaultValue }) => [name, defaultValue]))),
  [priorSteps, step.parameters, variables]);
  if (!schema) return <p className="lighttable-action-step-editor__message">
    This command has no complete editable schema.
  </p>;
  if ('error' in resolved || !record(resolved.value)) {
    return <p className="lighttable-action-step-editor__error" role="alert">
      {'error' in resolved ? resolved.error : 'Recorded parameters are not an object.'}
    </p>;
  }
  return <div className="lighttable-action-step-editor">
    <p>Bound values are shown resolved; edit their source in Bindings below.</p>
    <CommandParameterEditor schema={schema} initialParameters={resolved.value}
      disabled={disabled} running={false} runLabel="Apply parameters"
      onRun={(edited) => {
        const merged = preserveBindings(step.parameters, resolved.value, edited);
        if (merged.changedBoundValue) {
          return setResult('Bound values must be edited through Variables or Bindings.');
        }
        if (!record(merged.value)) return setResult('Edited parameters are not an object.');
        const applied = onApply(merged.value);
        setResult(applied.ok ? 'Parameters updated.' : applied.error);
      }} />
    {result ? <p className={result === 'Parameters updated.'
      ? 'lighttable-action-step-editor__message' : 'lighttable-action-step-editor__error'}
      role="status">{result}</p> : null}
  </div>;
};
