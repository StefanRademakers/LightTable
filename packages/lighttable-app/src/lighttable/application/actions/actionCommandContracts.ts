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
  | { readonly status: 'legacy-properties-only'; readonly schemaVersion: null };

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
    : { status: 'legacy-properties-only', schemaVersion: null }
);

const validContract = (value: unknown): value is RecordedCommandContract => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
  && Object.keys(value).length === 2
  && (('status' in value && value.status === 'legacy-properties-only'
      && 'schemaVersion' in value && value.schemaVersion === null)
    || ('status' in value && value.status === 'complete'
      && 'schemaVersion' in value && Number.isSafeInteger(value.schemaVersion)
      && Number(value.schemaVersion) > 0))
);

export type ActionContractCheck<T extends ContractStep> =
  | { readonly ok: true; readonly steps: readonly (T & { readonly contract: RecordedCommandContract })[];
      readonly migrated: boolean }
  | { readonly ok: false; readonly sequence: number; readonly message: string };

export const checkActionCommandContracts = <T extends ContractStep>(
  steps: readonly T[], allowMissingLegacyContract = false,
  variables: readonly ActionVariableDefinition[] = []
): ActionContractCheck<T> => {
  const variableError = validateActionVariables(variables);
  if (variableError) return { ok: false, sequence: 0, message: variableError };
  const variableValues = new Map(variables.map(({ name, defaultValue }) => [name, defaultValue]));
  const results = new Map<number, unknown>();
  const migratedSteps: (T & { readonly contract: RecordedCommandContract })[] = [];
  let migrated = false;
  for (const step of steps) {
    const current = currentRecordedCommandContract(step.command);
    const recorded = step.contract;
    if (!recorded && !allowMissingLegacyContract) {
      return { ok: false, sequence: step.sequence,
        message: `Step ${step.sequence} (${step.command}) has no recorded command contract.` };
    }
    if (recorded && !validContract(recorded)) {
      return { ok: false, sequence: step.sequence,
        message: `Step ${step.sequence} (${step.command}) has an invalid command contract marker.` };
    }
    if (recorded?.status === 'complete' && current.status !== 'complete') {
      return { ok: false, sequence: step.sequence,
        message: `Step ${step.sequence} (${step.command}) requires schema v${recorded.schemaVersion}, but this runtime has no complete schema.` };
    }
    if (recorded?.status === 'complete' && current.status === 'complete'
      && recorded.schemaVersion !== current.schemaVersion) {
      return { ok: false, sequence: step.sequence,
        message: `Step ${step.sequence} (${step.command}) uses schema v${recorded.schemaVersion}; this runtime supports v${current.schemaVersion}.` };
    }
    if (current.status === 'complete') {
      const resolved = resolveActionParameters(step.parameters, results, variableValues);
      if ('error' in resolved) {
        return { ok: false, sequence: step.sequence,
          message: `Step ${step.sequence} (${step.command}) cannot resolve its recorded bindings: ${resolved.error}` };
      }
      const schema = LIGHTTABLE_COMMAND_SCHEMAS[step.command as keyof typeof LIGHTTABLE_COMMAND_SCHEMAS]!;
      const input = validateJsonSchemaValue(schema.input, resolved.value);
      if (!input.valid) {
        return { ok: false, sequence: step.sequence,
          message: `Step ${step.sequence} (${step.command}) is incompatible with schema v${current.schemaVersion}: ${formatSchemaValidationIssues(input.issues)}.` };
      }
      if (step.outcome === 'completed') {
        const result = validateJsonSchemaValue(schema.result, step.result);
        if (!result.valid) {
          return { ok: false, sequence: step.sequence,
            message: `Step ${step.sequence} (${step.command}) has a result incompatible with schema v${current.schemaVersion}: ${formatSchemaValidationIssues(result.issues)}.` };
        }
      }
    }
    const contract = current.status === 'complete' ? current
      : recorded?.status === 'legacy-properties-only' ? recorded : current;
    if (!recorded || recorded.status !== contract.status
      || recorded.schemaVersion !== contract.schemaVersion) migrated = true;
    migratedSteps.push({ ...step, contract });
    results.set(step.sequence, step.result);
  }
  return { ok: true, steps: migratedSteps, migrated };
};
