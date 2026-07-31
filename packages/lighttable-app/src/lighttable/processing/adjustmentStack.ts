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

export type AdjustmentStackOwner = 'geometry' | 'grade' | 'lens-fx';

const ownerIncludesCategory = (
  owner: AdjustmentStackOwner,
  category: ProcessingModuleCategory
) => owner === 'grade'
  ? category === 'tone' || category === 'color' || category === 'spatial'
  : owner === 'geometry'
    ? category === 'geometry'
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
      if (existing && existing.enabled && valuesEqual(existing.settings, settings)) {
        return {
          ...existing,
          settings: cloneValue(existing.settings)
        };
      }
      changed = true;
      return {
        id: existing?.id ?? createId('module'),
        type: definition.type,
        enabled: true,
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
