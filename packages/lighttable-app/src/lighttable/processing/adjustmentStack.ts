import { cloneAdjustments, createDefaultAdjustments, type BasicAdjustments } from '../types';
import {
  CURRENT_PROCESSING_MODULES,
  type CurrentAdjustmentSettingsPath,
  type CurrentProcessingModuleType,
  type ProcessingScope
} from './moduleDefinitions';

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

export type AdjustmentIdFactory = (kind: 'stack' | 'module') => string;

const defaultIdFactory: AdjustmentIdFactory = (kind) =>
  `${kind}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;

const cloneValue = <T>(value: T): T => {
  if (value === null || typeof value !== 'object') return value;
  return structuredClone(value);
};

const valuesEqual = (left: unknown, right: unknown) =>
  JSON.stringify(left) === JSON.stringify(right);

const isCurrentModuleType = (type: string): type is CurrentProcessingModuleType =>
  CURRENT_PROCESSING_MODULES.some((definition) => definition.type === type);

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

export const adjustmentStackForScope = (
  stack: AdjustmentStack,
  scope: 'layer' | 'adjustment-layer' | 'group' | 'document-creative' | 'document-output'
): AdjustmentStack => ({
  ...cloneAdjustmentStack(stack),
  modules: stack.modules
    .filter((module) => {
      const definition = CURRENT_PROCESSING_MODULES.find(({ type }) => type === module.type);
      return Boolean(
        definition
        && (definition.allowedScopes as readonly ProcessingScope[]).includes(scope)
      );
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
  const currentModules = CURRENT_PROCESSING_MODULES.map((definition) => {
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
export const materializeBasicAdjustments = (stack: AdjustmentStack): BasicAdjustments => {
  const result = createDefaultAdjustments();
  for (const module of stack.modules) {
    if (!module.enabled || !isCurrentModuleType(module.type)) continue;
    const definition = CURRENT_PROCESSING_MODULES.find(({ type }) => type === module.type);
    if (!definition) continue;
    for (const path of definition.settingsPaths) {
      if (Object.prototype.hasOwnProperty.call(module.settings, path)) {
        writeSetting(result, path, module.settings[path]);
      }
    }
  }
  return cloneAdjustments(result);
};
