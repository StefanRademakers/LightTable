import { isActionResultReference } from './actionResultBindings';

export interface MigratableActionCommandStep {
  readonly sequence: number;
  readonly command: string;
  readonly parameters: unknown;
  readonly outcome: string;
  readonly result: unknown;
}

export interface ActionCommandMigrationValue {
  readonly parameters: unknown;
  readonly outcome: string;
  readonly result: unknown;
}

export interface ActionCommandMigrationOutput extends ActionCommandMigrationValue {
  /** Exact recorded result paths renamed by this migration. */
  readonly resultPathRenames?: Readonly<Record<string, string>>;
}

export interface ActionCommandSchemaMigration {
  readonly command: string;
  readonly fromVersion: number;
  readonly toVersion: number;
  migrate(value: Readonly<ActionCommandMigrationValue>): ActionCommandMigrationOutput;
}

/**
 * Production migrations live here when a command contract actually changes.
 * Do not add speculative or implicit identity migrations: every entry is a
 * reviewed compatibility promise for one command and one consecutive version.
 */
export const ACTION_COMMAND_SCHEMA_MIGRATIONS: readonly ActionCommandSchemaMigration[] = [];

export type ActionCommandMigrationResult<T extends MigratableActionCommandStep> =
  | { readonly ok: true; readonly steps: readonly T[]; readonly migrated: boolean }
  | { readonly ok: false; readonly sequence: number; readonly message: string };

const record = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const serializable = (value: unknown): boolean => {
  try { return JSON.stringify(value) !== undefined; } catch { return false; }
};

const rewriteResultReferences = (
  value: unknown,
  producerSequence: number,
  renames: Readonly<Record<string, string>>
): unknown => {
  if (isActionResultReference(value)) {
    const reference = value.$lighttableResult;
    const path = reference.step === producerSequence ? renames[reference.path] : undefined;
    return path === undefined ? value : { $lighttableResult: { step: reference.step, path } };
  }
  if (Array.isArray(value)) {
    return value.map((entry) => rewriteResultReferences(entry, producerSequence, renames));
  }
  if (!record(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
    key, rewriteResultReferences(entry, producerSequence, renames)
  ]));
};

const validateRenames = (value: unknown): value is Readonly<Record<string, string>> => (
  record(value) && Object.keys(value).length <= 256
  && Object.entries(value).every(([from, to]) => Boolean(from) && from.length <= 512
    && typeof to === 'string' && Boolean(to) && to.length <= 512)
);

export const migrateActionCommandSteps = <T extends MigratableActionCommandStep>(
  sourceSteps: readonly T[],
  currentVersion: number,
  migrations: readonly ActionCommandSchemaMigration[] = ACTION_COMMAND_SCHEMA_MIGRATIONS
): ActionCommandMigrationResult<T> => {
  const registry = new Map<string, ActionCommandSchemaMigration>();
  for (const migration of migrations) {
    const key = `${migration.command}\u0000${migration.fromVersion}`;
    if (!migration.command || !Number.isSafeInteger(migration.fromVersion)
      || migration.fromVersion < 1 || migration.toVersion !== migration.fromVersion + 1) {
      return { ok: false, sequence: 0,
        message: 'Action command-schema migration registry contains an invalid or non-consecutive entry.' };
    }
    if (registry.has(key)) return { ok: false, sequence: 0,
      message: `Action command-schema migration registry duplicates ${migration.command} v${migration.fromVersion}.` };
    registry.set(key, migration);
  }
  let steps: T[];
  try { steps = sourceSteps.map((step) => structuredClone(step)) as T[]; } catch {
    return { ok: false, sequence: 0,
      message: 'Action command-schema migration input is not cloneable.' };
  }
  let migrated = false;
  for (let index = 0; index < steps.length; index += 1) {
    let step = steps[index]!;
    const contract = record(step) && record((step as Record<string, unknown>).contract)
      ? (step as Record<string, unknown>).contract as Record<string, unknown> : null;
    if (contract?.status !== 'complete' || !Number.isSafeInteger(contract.schemaVersion)) continue;
    let version = Number(contract.schemaVersion);
    if (version > currentVersion) return { ok: false, sequence: step.sequence,
      message: `Step ${step.sequence} (${step.command}) uses schema v${version}; this runtime supports v${currentVersion}.` };
    while (version < currentVersion) {
      const migration = registry.get(`${step.command}\u0000${version}`);
      if (!migration) return { ok: false, sequence: step.sequence,
        message: `Step ${step.sequence} (${step.command}) needs an explicit schema v${version} to v${version + 1} migration.` };
      let output: ActionCommandMigrationOutput;
      try {
        output = migration.migrate(structuredClone({ parameters: step.parameters,
          outcome: step.outcome, result: step.result }));
      } catch (reason) {
        return { ok: false, sequence: step.sequence,
          message: `Step ${step.sequence} (${step.command}) schema v${version} migration failed: ${reason instanceof Error ? reason.message : String(reason)}` };
      }
      if (!record(output) || !Object.hasOwn(output, 'parameters') || !Object.hasOwn(output, 'result')
        || output.outcome !== step.outcome || !serializable(output.parameters) || !serializable(output.result)
        || (output.resultPathRenames !== undefined && !validateRenames(output.resultPathRenames))) {
        return { ok: false, sequence: step.sequence,
          message: `Step ${step.sequence} (${step.command}) schema v${version} migration returned invalid data.` };
      }
      const resultPathRenames = output.resultPathRenames ?? {};
      let parameters: unknown;
      let result: unknown;
      try {
        parameters = structuredClone(output.parameters);
        result = structuredClone(output.result);
      } catch {
        return { ok: false, sequence: step.sequence,
          message: `Step ${step.sequence} (${step.command}) schema v${version} migration returned unclonable data.` };
      }
      step = { ...step, parameters, result,
        contract: { status: 'complete', schemaVersion: migration.toVersion } } as T;
      steps[index] = step;
      for (let later = index + 1; later < steps.length; later += 1) {
        steps[later] = { ...steps[later]!, parameters: rewriteResultReferences(
          steps[later]!.parameters, step.sequence, resultPathRenames
        ) } as T;
      }
      version = migration.toVersion;
      migrated = true;
    }
  }
  return { ok: true, steps, migrated };
};
