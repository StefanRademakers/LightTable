import type { RecordedActionStep } from './semanticActionRecorder';

export interface ActionResultReference {
  readonly $lighttableResult: {
    readonly step: number;
    readonly path: string;
  };
}

export type ActionVariableType = 'string' | 'number' | 'boolean' | 'string-array' | 'json';

export interface ActionVariableDefinition {
  readonly name: string;
  readonly type: ActionVariableType;
  readonly defaultValue: unknown;
}

export interface ActionVariableReference {
  readonly $lighttableVariable: {
    readonly name: string;
  };
}

export const LIGHTTABLE_MAX_ACTION_VARIABLES = 32;
export const ACTION_VARIABLE_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/u;

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const identityValues = (steps: readonly RecordedActionStep[]): Map<string, ActionResultReference> => {
  const identities = new Map<string, ActionResultReference>();
  const visit = (value: unknown, step: number, path: string[]) => {
    if (Array.isArray(value)) {
      value.forEach((child, index) => visit(child, step, [...path, String(index)]));
      return;
    }
    if (!isRecord(value)) return;
    for (const [key, child] of Object.entries(value)) {
      const childPath = [...path, key];
      if ((key === 'id' || /Id$/.test(key)) && typeof child === 'string' && child) {
        identities.set(child, { $lighttableResult: { step, path: childPath.join('.') } });
      } else if (isRecord(child) || Array.isArray(child)) {
        visit(child, step, childPath);
      }
    }
  };
  for (const step of steps) {
    if ((step.outcome === 'completed' || step.outcome === 'accepted') && step.replayable) {
      visit(step.result, step.sequence, []);
    }
  }
  return identities;
};

export const bindRecordedParameters = (
  parameters: unknown,
  priorSteps: readonly RecordedActionStep[]
): unknown => {
  const identities = identityValues(priorSteps);
  const visit = (value: unknown, identityContext = false): unknown => {
    if (typeof value === 'string') return identityContext ? identities.get(value) ?? value : value;
    if (Array.isArray(value)) return value.map((child) => visit(child, identityContext));
    if (!isRecord(value)) return value;
    return Object.fromEntries(Object.entries(value)
      .map(([key, child]) => [key, visit(child, /Ids?$/.test(key))]));
  };
  return visit(parameters);
};

export const isActionResultReference = (value: unknown): value is ActionResultReference => {
  if (!isRecord(value) || Object.keys(value).length !== 1 || !isRecord(value.$lighttableResult)) return false;
  return Number.isInteger(value.$lighttableResult.step) && Number(value.$lighttableResult.step) > 0
    && typeof value.$lighttableResult.path === 'string' && Boolean(value.$lighttableResult.path);
};

export const isActionVariableReference = (value: unknown): value is ActionVariableReference => (
  isRecord(value) && Object.keys(value).length === 1 && isRecord(value.$lighttableVariable)
  && Object.keys(value.$lighttableVariable).length === 1
  && typeof value.$lighttableVariable.name === 'string'
  && ACTION_VARIABLE_NAME_PATTERN.test(value.$lighttableVariable.name)
);

export const inferActionVariableType = (value: unknown): ActionVariableType => {
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (Array.isArray(value) && value.every((entry) => typeof entry === 'string')) return 'string-array';
  return 'json';
};

export const actionVariableValueMatchesType = (type: ActionVariableType, value: unknown): boolean => {
  if (type === 'string') return typeof value === 'string';
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (type === 'boolean') return typeof value === 'boolean';
  if (type === 'string-array') return Array.isArray(value)
    && value.every((entry) => typeof entry === 'string');
  try { return JSON.stringify(value) !== undefined; } catch { return false; }
};

export const validateActionVariables = (
  variables: readonly ActionVariableDefinition[]
): string | null => {
  if (variables.length > LIGHTTABLE_MAX_ACTION_VARIABLES) {
    return `An Action can contain at most ${LIGHTTABLE_MAX_ACTION_VARIABLES} variables.`;
  }
  const names = new Set<string>();
  for (const variable of variables) {
    if (!isRecord(variable) || Object.keys(variable).some((key) => (
      key !== 'name' && key !== 'type' && key !== 'defaultValue'
    )) || !['string', 'number', 'boolean', 'string-array', 'json'].includes(variable.type)) {
      return 'Action variable metadata is invalid.';
    }
    if (!ACTION_VARIABLE_NAME_PATTERN.test(variable.name)) {
      return `Variable name ${JSON.stringify(variable.name)} is invalid.`;
    }
    if (names.has(variable.name)) return `Variable ${variable.name} is duplicated.`;
    names.add(variable.name);
    if (!actionVariableValueMatchesType(variable.type, variable.defaultValue)) {
      return `Variable ${variable.name} does not match its ${variable.type} type.`;
    }
  }
  return null;
};

const readPath = (value: unknown, path: string): unknown => path.split('.').reduce<unknown>(
  (current, key) => Array.isArray(current) && /^\d+$/u.test(key)
    ? current[Number(key)] : isRecord(current) ? current[key] : undefined,
  value
);

export const resolveActionParameters = (
  parameters: unknown,
  results: ReadonlyMap<number, unknown>,
  variables: ReadonlyMap<string, unknown> = new Map()
): { readonly value: unknown } | { readonly error: string } => {
  const visit = (value: unknown): unknown => {
    if (isActionResultReference(value)) {
      const source = results.get(value.$lighttableResult.step);
      const resolved = readPath(source, value.$lighttableResult.path);
      if (resolved === undefined) {
        throw new Error(`Step ${value.$lighttableResult.step} result has no ${value.$lighttableResult.path}.`);
      }
      return resolved;
    }
    if (isActionVariableReference(value)) {
      if (!variables.has(value.$lighttableVariable.name)) {
        throw new Error(`Variable ${value.$lighttableVariable.name} has no value.`);
      }
      return structuredClone(variables.get(value.$lighttableVariable.name));
    }
    if (Array.isArray(value)) return value.map(visit);
    if (!isRecord(value)) return value;
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, visit(child)]));
  };
  try {
    return { value: visit(parameters) };
  } catch (reason) {
    return { error: reason instanceof Error ? reason.message : String(reason) };
  }
};
