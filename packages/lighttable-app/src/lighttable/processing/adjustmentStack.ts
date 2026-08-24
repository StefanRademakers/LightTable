import { cloneAdjustments, createDefaultAdjustments, type BasicAdjustments } from '../types';
import {
  type ProcessingModuleCategory,
  type CurrentAdjustmentSettingsPath,
  type ProcessingScope
} from './moduleDefinitions';
import {
  currentProcessingModuleRegistry,
  type ProcessingModuleRegistry
} from './processingModuleRegistry';

export interface AdjustmentModuleInstance {
  /** Stable identity for selection, history and future node references. */
  id: string;
  /** Stable engine type used by the current LightTable processing registry. */
  type: string;
  enabled: boolean;
  revision: number;
  settings: Record<string, unknown>;
}

export interface AdjustmentStack {
  id: string;
  revision: number;
  modules: AdjustmentModuleInstance[];
}

export type AdjustmentStackOwner = 'geometry' | 'grade' | 'filter' | 'lens-fx';
export type LocalProcessingKind = 'grade' | 'curves' | 'lens-fx';
export type GradeModuleGroup =
  | 'light'
  | 'color'
  | 'colorMixer'
  | 'colorGrading'
  | 'blackWhiteMix'
  | 'look'
  | 'curves'
  | 'effects'
  | 'detail';

const GRADE_MODULE_TYPES: Readonly<Record<GradeModuleGroup, readonly string[]>> = {
  light: ['lt.light'],
  color: ['lt.white-balance', 'lt.global-color'],
  colorMixer: ['lt.color-mixer'],
  colorGrading: ['lt.color-grading'],
  blackWhiteMix: ['lt.black-white-mix'],
  look: ['lt.grade-look'],
  curves: ['lt.curves'],
  effects: ['lt.local-contrast'],
  detail: ['lt.detail']
};

const ownerIncludesCategory = (
  owner: AdjustmentStackOwner,
  category: ProcessingModuleCategory
) => owner === 'grade'
  ? category === 'tone' || category === 'color' || category === 'spatial'
  : owner === 'geometry'
    ? category === 'geometry'
    : owner === 'filter'
      ? category === 'filter'
      : category === 'lens' || category === 'output';

export const adjustmentModuleBelongsToOwner = (
  type: string,
  owner: AdjustmentStackOwner,
  registry: ProcessingModuleRegistry = currentProcessingModuleRegistry
): boolean => {
  const definition = registry.definition(type);
  return Boolean(definition && ownerIncludesCategory(owner, definition.category));
};

export const adjustmentStackHasOwner = (
  stack: AdjustmentStack | null | undefined,
  owner: AdjustmentStackOwner,
  registry: ProcessingModuleRegistry = currentProcessingModuleRegistry
): boolean => Boolean(stack?.modules.some((module) =>
  adjustmentModuleBelongsToOwner(module.type, owner, registry)
));

export const adjustmentModuleBelongsToLocalProcessing = (
  type: string,
  kind: LocalProcessingKind,
  registry: ProcessingModuleRegistry = currentProcessingModuleRegistry
): boolean => kind === 'curves'
  ? type === 'lt.curves'
  : kind === 'grade'
    ? type !== 'lt.curves' && adjustmentModuleBelongsToOwner(type, 'grade', registry)
    : adjustmentModuleBelongsToOwner(type, 'lens-fx', registry);

export const adjustmentStackHasLocalProcessing = (
  stack: AdjustmentStack | null | undefined,
  kind: LocalProcessingKind,
  registry: ProcessingModuleRegistry = currentProcessingModuleRegistry
): boolean => Boolean(stack?.modules.some((module) =>
  adjustmentModuleBelongsToLocalProcessing(module.type, kind, registry)
));

export const adjustmentStackLocalProcessingIsEnabled = (
  stack: AdjustmentStack,
  kind: LocalProcessingKind,
  registry: ProcessingModuleRegistry = currentProcessingModuleRegistry
): boolean => stack.modules.some((module) =>
  module.enabled && adjustmentModuleBelongsToLocalProcessing(module.type, kind, registry)
);

export const setAdjustmentStackLocalProcessingEnabled = (
  stack: AdjustmentStack,
  kind: LocalProcessingKind,
  enabled: boolean,
  registry: ProcessingModuleRegistry = currentProcessingModuleRegistry
): AdjustmentStack => {
  let changed = false;
  const modules = stack.modules.map((module) => {
    if (
      !adjustmentModuleBelongsToLocalProcessing(module.type, kind, registry)
      || module.enabled === enabled
    ) return module;
    changed = true;
    return { ...module, enabled, revision: module.revision + 1 };
  });
  return changed ? {
    ...cloneAdjustmentStack(stack),
    revision: stack.revision + 1,
    modules
  } : stack;
};

export const removeAdjustmentStackLocalProcessing = (
  stack: AdjustmentStack,
  kind: LocalProcessingKind,
  registry: ProcessingModuleRegistry = currentProcessingModuleRegistry
): AdjustmentStack => {
  const cloned = cloneAdjustmentStack(stack);
  const modules = cloned.modules.filter((module) =>
    !adjustmentModuleBelongsToLocalProcessing(module.type, kind, registry)
  );
  return modules.length === stack.modules.length ? stack : {
    ...cloned,
    revision: stack.revision + 1,
    modules
  };
};

export const adjustmentStackOwnerIsEnabled = (
  stack: AdjustmentStack,
  owner: AdjustmentStackOwner,
  registry: ProcessingModuleRegistry = currentProcessingModuleRegistry
): boolean => stack.modules.some((module) =>
  module.enabled && adjustmentModuleBelongsToOwner(module.type, owner, registry)
);

export const setAdjustmentStackOwnerEnabled = (
  stack: AdjustmentStack,
  owner: AdjustmentStackOwner,
  enabled: boolean,
  registry: ProcessingModuleRegistry = currentProcessingModuleRegistry
): AdjustmentStack => {
  let changed = false;
  const modules = stack.modules.map((module) => {
    if (
      !adjustmentModuleBelongsToOwner(module.type, owner, registry)
      || module.enabled === enabled
    ) return module;
    changed = true;
    return {
      ...module,
      enabled,
      revision: module.revision + 1
    };
  });
  if (!changed) return stack;
  return {
    ...cloneAdjustmentStack(stack),
    revision: stack.revision + 1,
    modules
  };
};

export const adjustmentStackForOwner = (
  stack: AdjustmentStack,
  owner: AdjustmentStackOwner,
  registry: ProcessingModuleRegistry = currentProcessingModuleRegistry
): AdjustmentStack => ({
  ...cloneAdjustmentStack(stack),
  modules: stack.modules.filter((module) =>
    adjustmentModuleBelongsToOwner(module.type, owner, registry)
  )
});

/** Keeps an explicit module inventory for a specialized adjustment node. */
export const adjustmentStackForModuleTypes = (
  stack: AdjustmentStack,
  types: readonly string[]
): AdjustmentStack => {
  const included = new Set(types);
  return {
    ...cloneAdjustmentStack(stack),
    modules: stack.modules.filter((module) => included.has(module.type))
  };
};

/** Removes one authored processing owner while preserving every other module family. */
export const removeAdjustmentStackOwner = (
  stack: AdjustmentStack,
  owner: AdjustmentStackOwner,
  registry: ProcessingModuleRegistry = currentProcessingModuleRegistry
): AdjustmentStack => {
  const cloned = cloneAdjustmentStack(stack);
  const modules = cloned.modules.filter((module) =>
    !adjustmentModuleBelongsToOwner(module.type, owner, registry)
  );
  if (modules.length === stack.modules.length) return stack;
  return {
    ...cloned,
    revision: stack.revision + 1,
    modules
  };
};

export const adjustmentStackOwnerHasAuthoredSettings = (
  adjustments: BasicAdjustments,
  owner: AdjustmentStackOwner,
  registry: ProcessingModuleRegistry = currentProcessingModuleRegistry
): boolean => {
  const defaults = createDefaultAdjustments();
  return registry.definitions().some((definition) =>
    ownerIncludesCategory(owner, definition.category)
    && definition.settingsPaths.some((path) =>
      !valuesEqual(readSetting(adjustments, path), readSetting(defaults, path))
    )
  );
};

export type AdjustmentIdFactory = (kind: 'stack' | 'module') => string;

const defaultIdFactory: AdjustmentIdFactory = (kind) =>
  `${kind}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;

const cloneValue = <T>(value: T): T => {
  if (value === null || typeof value !== 'object') return value;
  return structuredClone(value);
};

const valuesEqual = (left: unknown, right: unknown) =>
  JSON.stringify(left) === JSON.stringify(right);

const readSetting = (
  adjustments: BasicAdjustments,
  path: CurrentAdjustmentSettingsPath
): unknown => {
  if (path.startsWith('effects.')) {
    const effect = path.slice('effects.'.length) as keyof BasicAdjustments['effects'];
    return adjustments.effects[effect];
  }
  return adjustments[path as Exclude<CurrentAdjustmentSettingsPath, `effects.${string}`>];
};

const writeSetting = (
  adjustments: BasicAdjustments,
  path: CurrentAdjustmentSettingsPath,
  value: unknown
) => {
  if (path.startsWith('effects.')) {
    const effect = path.slice('effects.'.length) as keyof BasicAdjustments['effects'];
    (adjustments.effects as unknown as Record<string, unknown>)[effect] = cloneValue(value);
    return;
  }
  (adjustments as unknown as Record<string, unknown>)[path] = cloneValue(value);
};

const settingsForModule = (
  adjustments: BasicAdjustments,
  paths: readonly CurrentAdjustmentSettingsPath[]
) => Object.fromEntries(paths.map((path) => [path, cloneValue(readSetting(adjustments, path))]));

export const cloneAdjustmentStack = (stack: AdjustmentStack): AdjustmentStack => ({
  id: stack.id,
  revision: stack.revision,
  modules: stack.modules.map((module) => ({
    id: module.id,
    type: module.type,
    enabled: module.enabled,
    revision: module.revision,
    settings: cloneValue(module.settings)
  }))
});

export const adjustmentStackIsEnabled = (stack: AdjustmentStack): boolean =>
  stack.modules.some((module) => module.enabled);

export const setAdjustmentStackEnabled = (
  stack: AdjustmentStack,
  enabled: boolean
): AdjustmentStack => {
  if (stack.modules.every((module) => module.enabled === enabled)) return stack;
  return {
    ...cloneAdjustmentStack(stack),
    revision: stack.revision + 1,
    modules: stack.modules.map((module) => module.enabled === enabled
      ? module
      : {
        ...module,
        enabled,
        revision: module.revision + 1
      })
  };
};

/** Reports a Grade section's bypass state without treating a not-yet-authored
 * neutral module as disabled. */
export const adjustmentStackGradeGroupIsEnabled = (
  stack: AdjustmentStack | null | undefined,
  group: GradeModuleGroup
): boolean => {
  const requested = new Set(GRADE_MODULE_TYPES[group]);
  const modules = stack?.modules.filter((module) => requested.has(module.type)) ?? [];
  return modules.length === 0 || modules.some((module) => module.enabled);
};

/** Bypasses one Grade section while retaining its authored parameters. Missing
 * neutral modules are materialized so an off state survives the first edit. */
export const setAdjustmentStackGradeGroupEnabled = (
  stack: AdjustmentStack | null | undefined,
  group: GradeModuleGroup,
  enabled: boolean
): AdjustmentStack => {
  const types = GRADE_MODULE_TYPES[group];
  const ensured = ensureAdjustmentStackModuleTypes(stack, types);
  const requested = new Set(types);
  let changed = false;
  const modules = ensured.modules.map((module) => {
    if (!requested.has(module.type) || module.enabled === enabled) return module;
    changed = true;
    return { ...module, enabled, revision: module.revision + 1 };
  });
  return changed ? {
    ...cloneAdjustmentStack(ensured),
    revision: ensured.revision + 1,
    modules
  } : ensured;
};

export const adjustmentStackForScope = (
  stack: AdjustmentStack,
  scope: 'layer' | 'adjustment-layer' | 'group' | 'document-creative' | 'document-output',
  registry: ProcessingModuleRegistry = currentProcessingModuleRegistry
): AdjustmentStack => ({
  ...cloneAdjustmentStack(stack),
  modules: stack.modules
    .filter((module) => {
      return registry.allows(module.type, scope);
    })
    .map((module) => ({
      ...module,
      settings: cloneValue(module.settings)
    }))
});

/**
 * Bridges the current BasicAdjustments UI to the serializable module model.
 * The alpha document format intentionally has no compatibility/migration layer:
 * it is rebuilt from the current registry while the editor is still evolving.
 */
export const createAdjustmentStackFromBasicAdjustments = (
  adjustments: BasicAdjustments,
  previous?: AdjustmentStack,
  createId: AdjustmentIdFactory = defaultIdFactory
): AdjustmentStack => {
  let changed = !previous;
  const currentModules = currentProcessingModuleRegistry.definitions()
    .filter((definition) => definition.settingsPaths.length > 0)
    .map((definition) => {
      const settings = settingsForModule(adjustments, definition.settingsPaths);
      const existing = previous?.modules.find((module) => module.type === definition.type);
      if (existing && valuesEqual(existing.settings, settings)) {
        return {
          ...existing,
          settings: cloneValue(existing.settings)
        };
      }
      changed = true;
      return {
        id: existing?.id ?? createId('module'),
        type: definition.type,
        enabled: existing?.enabled ?? true,
        revision: (existing?.revision ?? -1) + 1,
        settings
      };
    });
  return {
    id: previous?.id ?? createId('stack'),
    revision: changed ? (previous?.revision ?? -1) + 1 : (previous?.revision ?? 0),
    modules: currentModules
  };
};

/** Adds missing neutral modules without disturbing authored local processing. */
export const ensureAdjustmentStackModuleTypes = (
  stack: AdjustmentStack | null | undefined,
  types: readonly string[]
): AdjustmentStack => {
  const source = adjustmentStackForScope(
    createAdjustmentStackFromBasicAdjustments(createDefaultAdjustments()),
    'layer'
  );
  const requested = new Set(types);
  const base = stack ? cloneAdjustmentStack(stack) : {
    id: source.id,
    revision: 0,
    modules: []
  };
  const existing = new Set(base.modules.map((module) => module.type));
  const additions = source.modules.filter((module) =>
    requested.has(module.type) && !existing.has(module.type)
  );
  if (!additions.length) return stack ?? base;
  return {
    ...base,
    revision: base.revision + 1,
    modules: [...base.modules, ...additions]
  };
};

export const ensureAdjustmentStackLocalProcessing = (
  stack: AdjustmentStack | null | undefined,
  kind: LocalProcessingKind
): AdjustmentStack => {
  const source = adjustmentStackForScope(
    createAdjustmentStackFromBasicAdjustments(createDefaultAdjustments()),
    'layer'
  );
  return ensureAdjustmentStackModuleTypes(
    stack,
    source.modules
      .filter((module) => adjustmentModuleBelongsToLocalProcessing(module.type, kind))
      .map((module) => module.type)
  );
};

/**
 * Current evaluator bridge. A later graph evaluator will execute these
 * modules directly instead of materializing the legacy aggregate object.
 */
export const materializeBasicAdjustments = (
  stack: AdjustmentStack,
  registry: ProcessingModuleRegistry = currentProcessingModuleRegistry,
  scope?: ProcessingScope,
  includeDisabled = false
): BasicAdjustments => {
  const result = createDefaultAdjustments();
  const modulesByType = new Map(stack.modules.map((module) => [module.type, module]));
  for (const definition of registry.definitions()) {
    const module = modulesByType.get(definition.type);
    if (
      !module
      || (!includeDisabled && !module.enabled)
      || (scope && !definition.allowedScopes.includes(scope))
    ) continue;
    for (const path of definition.settingsPaths) {
      if (Object.prototype.hasOwnProperty.call(module.settings, path)) {
        writeSetting(result, path, module.settings[path]);
      }
    }
  }
  return cloneAdjustments(result);
};
