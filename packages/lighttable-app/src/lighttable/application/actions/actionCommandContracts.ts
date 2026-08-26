import {
  LIGHTTABLE_COMMAND_SCHEMA_VERSION,
  LIGHTTABLE_COMMAND_SCHEMAS,
  formatSchemaValidationIssues,
  validateJsonSchemaValue
} from '@lighttable/command-contract';
import {
  resolveActionParameters,
  validateActionVariables,
  type ActionVariableDefinition
} from './actionResultBindings';

export type RecordedCommandContract =
  | { readonly status: 'complete'; readonly schemaVersion: number }
  | { readonly status: 'properties-only'; readonly schemaVersion: null };

interface ContractStep {
  readonly sequence: number;
  readonly command: string;
  readonly parameters: unknown;
  readonly outcome: string;
  readonly result: unknown;
  readonly contract?: RecordedCommandContract;
}

export const currentRecordedCommandContract = (command: string): RecordedCommandContract => (
  LIGHTTABLE_COMMAND_SCHEMAS[command as keyof typeof LIGHTTABLE_COMMAND_SCHEMAS]
    ? { status: 'complete', schemaVersion: LIGHTTABLE_COMMAND_SCHEMA_VERSION }
    : { status: 'properties-only', schemaVersion: null }
);

const validContract = (value: unknown): value is RecordedCommandContract => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
  && Object.keys(value).length === 2
  && (('status' in value && value.status === 'properties-only'
      && 'schemaVersion' in value && value.schemaVersion === null)
    || ('status' in value && value.status === 'complete'
      && 'schemaVersion' in value && value.schemaVersion === LIGHTTABLE_COMMAND_SCHEMA_VERSION))
);

export type ActionContractCheck<T extends ContractStep> =
  | { readonly ok: true; readonly steps: readonly (T & { readonly contract: RecordedCommandContract })[] }
  | { readonly ok: false; readonly sequence: number; readonly message: string };

/** Validates saved steps only against the one command contract shipped by this alpha build. */
export const checkActionCommandContracts = <T extends ContractStep>(
  steps: readonly T[],
  variables: readonly ActionVariableDefinition[] = []
): ActionContractCheck<T> => {
  const variableError = validateActionVariables(variables);
  if (variableError) return { ok: false, sequence: 0, message: variableError };
  const variableValues = new Map(variables.map(({ name, defaultValue }) => [name, defaultValue]));
  const results = new Map<number, unknown>();
  const checked: (T & { readonly contract: RecordedCommandContract })[] = [];
  for (const step of steps) {
    const current = currentRecordedCommandContract(step.command);
    if (!step.contract || !validContract(step.contract)
      || step.contract.status !== current.status
      || step.contract.schemaVersion !== current.schemaVersion) {
      return { ok: false, sequence: step.sequence,
        message: `Step ${step.sequence} (${step.command}) does not match the current command contract.` };
    }
    if (current.status === 'complete') {
      const resolved = resolveActionParameters(step.parameters, results, variableValues);
      if ('error' in resolved) return { ok: false, sequence: step.sequence,
        message: `Step ${step.sequence} (${step.command}) cannot resolve its bindings: ${resolved.error}` };
      const schema = LIGHTTABLE_COMMAND_SCHEMAS[step.command as keyof typeof LIGHTTABLE_COMMAND_SCHEMAS]!;
      const input = validateJsonSchemaValue(schema.input, resolved.value);
      if (!input.valid) return { ok: false, sequence: step.sequence,
        message: `Step ${step.sequence} (${step.command}) has invalid parameters: ${formatSchemaValidationIssues(input.issues)}.` };
      if (step.outcome === 'completed') {
        const result = validateJsonSchemaValue(schema.result, step.result);
        if (!result.valid) return { ok: false, sequence: step.sequence,
          message: `Step ${step.sequence} (${step.command}) has an invalid result: ${formatSchemaValidationIssues(result.issues)}.` };
      }
    }
    checked.push({ ...step, contract: current });
    results.set(step.sequence, step.result);
  }
  return { ok: true, steps: checked };
};
