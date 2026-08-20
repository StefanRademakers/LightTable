import type { RecordedActionStep } from './semanticActionRecorder';

export interface ActionResultReference {
  readonly $lighttableResult: {
    readonly step: number;
    readonly path: string;
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const identityValues = (steps: readonly RecordedActionStep[]): Map<string, ActionResultReference> => {
  const identities = new Map<string, ActionResultReference>();
  const visit = (value: unknown, step: number, path: string[]) => {
    if (!isRecord(value)) return;
    for (const [key, child] of Object.entries(value)) {
      const childPath = [...path, key];
      if ((key === 'id' || /Id$/.test(key)) && typeof child === 'string' && child) {
        identities.set(child, { $lighttableResult: { step, path: childPath.join('.') } });
      } else if (isRecord(child)) {
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

const isReference = (value: unknown): value is ActionResultReference => {
  if (!isRecord(value) || Object.keys(value).length !== 1 || !isRecord(value.$lighttableResult)) return false;
  return Number.isInteger(value.$lighttableResult.step) && Number(value.$lighttableResult.step) > 0
    && typeof value.$lighttableResult.path === 'string' && Boolean(value.$lighttableResult.path);
};

const readPath = (value: unknown, path: string): unknown => path.split('.').reduce<unknown>(
  (current, key) => isRecord(current) ? current[key] : undefined,
  value
);

export const resolveActionParameters = (
  parameters: unknown,
  results: ReadonlyMap<number, unknown>
): { readonly value: unknown } | { readonly error: string } => {
  const visit = (value: unknown): unknown => {
    if (isReference(value)) {
      const source = results.get(value.$lighttableResult.step);
      const resolved = readPath(source, value.$lighttableResult.path);
      if (resolved === undefined) {
        throw new Error(`Step ${value.$lighttableResult.step} result has no ${value.$lighttableResult.path}.`);
      }
      return resolved;
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
