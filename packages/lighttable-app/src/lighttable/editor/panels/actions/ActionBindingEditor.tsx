import React, { useEffect, useMemo, useState } from 'react';
import { ButtonBase } from '../../../../ui/ButtonBase';
import { FormSelect } from '../../../../ui/FormSelect';
import {
  isActionResultReference,
  isActionVariableReference,
  type ActionVariableDefinition
} from '../../../application/actions/actionResultBindings';
import type {
  ActionRecordingEditResult,
  RecordedActionStep
} from '../../../application/actions/semanticActionRecorder';

const record = (value: unknown): value is Readonly<Record<string, unknown>> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);
const pointerPart = (value: string): string => value.replace(/~/gu, '~0').replace(/\//gu, '~1');

interface ValuePath {
  readonly pointer: string;
  readonly dotPath: string;
  readonly label: string;
  readonly value: unknown;
}

const valuePaths = (value: unknown): ValuePath[] => {
  const paths: ValuePath[] = [];
  const visit = (current: unknown, pointer: string[], dot: string[]) => {
    if (pointer.length > 0) {
      paths.push({ pointer: `/${pointer.map(pointerPart).join('/')}`, dotPath: dot.join('.'),
        label: dot.join('.'), value: current });
    }
    if (isActionResultReference(current) || isActionVariableReference(current)) return;
    if (Array.isArray(current)) current.forEach((child, index) => visit(child,
      [...pointer, String(index)], [...dot, String(index)]));
    else if (record(current)) Object.entries(current).forEach(([key, child]) => visit(child,
      [...pointer, key], [...dot, key]));
  };
  visit(value, [], []);
  return paths;
};

const describeBinding = (value: unknown): string | null => {
  if (isActionVariableReference(value)) return `Variable: ${value.$lighttableVariable.name}`;
  if (isActionResultReference(value)) {
    return `Result: step ${value.$lighttableResult.step}.${value.$lighttableResult.path}`;
  }
  return null;
};

export interface ActionBindingEditorProps {
  readonly step: RecordedActionStep;
  readonly priorSteps: readonly RecordedActionStep[];
  readonly variables: readonly ActionVariableDefinition[];
  readonly disabled: boolean;
  readonly onCreateVariable: (path: string, name: string) => ActionRecordingEditResult;
  readonly onBindVariable: (path: string, name: string) => ActionRecordingEditResult;
  readonly onBindResult: (path: string, producer: number, resultPath: string) => ActionRecordingEditResult;
  readonly onRestoreLiteral: (path: string) => ActionRecordingEditResult;
}

export const ActionBindingEditor: React.FC<ActionBindingEditorProps> = ({
  step, priorSteps, variables, disabled, onCreateVariable, onBindVariable, onBindResult, onRestoreLiteral
}) => {
  const parameters = useMemo(() => valuePaths(step.parameters), [step.parameters]);
  const results = useMemo(() => priorSteps.flatMap((producer) => valuePaths(producer.result)
    .map((path) => ({ ...path, sequence: producer.sequence }))), [priorSteps]);
  const [parameterPath, setParameterPath] = useState(parameters[0]?.pointer ?? '');
  const [variableName, setVariableName] = useState(variables[0]?.name ?? '');
  const [newVariableName, setNewVariableName] = useState('');
  const [resultKey, setResultKey] = useState(results[0]
    ? `${results[0].sequence}:${results[0].dotPath}` : '');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!parameters.some(({ pointer }) => pointer === parameterPath)) {
      setParameterPath(parameters[0]?.pointer ?? '');
    }
  }, [parameterPath, parameters]);
  useEffect(() => {
    if (!variables.some(({ name }) => name === variableName)) setVariableName(variables[0]?.name ?? '');
  }, [variableName, variables]);
  useEffect(() => {
    if (!results.some((result) => `${result.sequence}:${result.dotPath}` === resultKey)) {
      setResultKey(results[0] ? `${results[0].sequence}:${results[0].dotPath}` : '');
    }
  }, [resultKey, results]);
  const selected = parameters.find(({ pointer }) => pointer === parameterPath) ?? parameters[0];
  const selectedBinding = describeBinding(selected?.value);
  const apply = (result: ActionRecordingEditResult) => setError(result.ok ? null : result.error);

  if (!selected) return <p className="lighttable-action-binding-editor__empty">No bindable parameters.</p>;
  return <div className="lighttable-action-binding-editor">
    <label>Parameter
      <FormSelect aria-label={`Step ${step.sequence} parameter`} value={selected.pointer}
        disabled={disabled} onChange={(event) => setParameterPath(event.currentTarget.value)}>
        {parameters.map((path) => <option key={path.pointer} value={path.pointer}>{path.label}</option>)}
      </FormSelect>
    </label>
    {selectedBinding ? <p className="lighttable-action-binding-editor__current">{selectedBinding}</p> : null}
    <div className="lighttable-action-binding-editor__row">
      <FormSelect aria-label={`Step ${step.sequence} variable`} value={variableName}
        disabled={disabled || variables.length === 0}
        onChange={(event) => setVariableName(event.currentTarget.value)}>
        {variables.length === 0 ? <option value="">No variables</option> : null}
        {variables.map((variable) => <option key={variable.name} value={variable.name}>
          {variable.name} ({variable.type})
        </option>)}
      </FormSelect>
      <ButtonBase type="button" disabled={disabled || !variableName}
        onClick={() => apply(onBindVariable(selected.pointer, variableName))}>Bind variable</ButtonBase>
    </div>
    <div className="lighttable-action-binding-editor__row">
      <input aria-label={`Step ${step.sequence} new variable name`} value={newVariableName}
        disabled={disabled} placeholder="variableName" maxLength={64}
        onChange={(event) => setNewVariableName(event.currentTarget.value)} />
      <ButtonBase type="button" disabled={disabled || !newVariableName.trim()}
        onClick={() => {
          const result = onCreateVariable(selected.pointer, newVariableName);
          apply(result);
          if (result.ok) { setVariableName(newVariableName.trim()); setNewVariableName(''); }
        }}>Promote</ButtonBase>
    </div>
    <div className="lighttable-action-binding-editor__row">
      <FormSelect aria-label={`Step ${step.sequence} prior result`} value={resultKey}
        disabled={disabled || results.length === 0}
        onChange={(event) => setResultKey(event.currentTarget.value)}>
        {results.length === 0 ? <option value="">No prior results</option> : null}
        {results.map((result) => <option key={`${result.sequence}:${result.dotPath}`}
          value={`${result.sequence}:${result.dotPath}`}>Step {result.sequence}: {result.label}</option>)}
      </FormSelect>
      <ButtonBase type="button" disabled={disabled || !resultKey}
        onClick={() => {
          const separator = resultKey.indexOf(':');
          apply(onBindResult(selected.pointer, Number(resultKey.slice(0, separator)),
            resultKey.slice(separator + 1)));
        }}>Bind result</ButtonBase>
    </div>
    <ButtonBase type="button" disabled={disabled || !selectedBinding}
      onClick={() => apply(onRestoreLiteral(selected.pointer))}>Use recorded value</ButtonBase>
    {error ? <p className="lighttable-action-binding-editor__error" role="alert">{error}</p> : null}
  </div>;
};

const encodeVariableValue = (variable: ActionVariableDefinition): string => {
  if (variable.type === 'string') return variable.defaultValue as string;
  if (variable.type === 'string-array') return (variable.defaultValue as string[]).join(', ');
  return JSON.stringify(variable.defaultValue);
};

const decodeVariableValue = (variable: ActionVariableDefinition, value: string): unknown => {
  if (variable.type === 'string') return value;
  if (variable.type === 'string-array') return value.split(',').map((entry) => entry.trim()).filter(Boolean);
  return JSON.parse(value);
};

export const ActionVariableRow: React.FC<{
  readonly variable: ActionVariableDefinition;
  readonly disabled: boolean;
  readonly onUpdate: (value: unknown) => ActionRecordingEditResult;
  readonly onDelete: () => ActionRecordingEditResult;
}> = ({ variable, disabled, onUpdate, onDelete }) => {
  const [draft, setDraft] = useState(() => encodeVariableValue(variable));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setDraft(encodeVariableValue(variable)); setError(null); }, [variable]);
  const apply = () => {
    try {
      const result = onUpdate(decodeVariableValue(variable, draft));
      setError(result.ok ? null : result.error);
    } catch { setError(`Enter a valid ${variable.type} value.`); }
  };
  return <div className="lighttable-action-variable-row">
    <label><span><strong>{variable.name}</strong> <small>{variable.type}</small></span>
      <input aria-label={`${variable.name} default`} value={draft} disabled={disabled}
        onChange={(event) => setDraft(event.currentTarget.value)} onBlur={apply} />
    </label>
    <ButtonBase type="button" disabled={disabled} onClick={apply}>Apply</ButtonBase>
    <ButtonBase type="button" disabled={disabled} onClick={() => {
      const result = onDelete(); setError(result.ok ? null : result.error);
    }}>Delete</ButtonBase>
    {error ? <p role="alert">{error}</p> : null}
  </div>;
};
