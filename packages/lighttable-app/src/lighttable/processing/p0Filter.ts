import {
  defaultP0FilterSettings,
  isP0FilterKind,
  normalizeP0FilterSettings,
  p0FilterDefinition,
  p0FilterDefinitionForModule,
  type P0FilterKind,
  type P0FilterSettingsMap
} from '@lighttable/filter-core';
import type { AdjustmentModuleInstance, AdjustmentStack } from './adjustmentStack';
export {
  createFilterStack as createAllFilterStack,
  filterKindForStack,
  filterModule,
  filterSettings,
  isFilterKind,
  isFilterModuleType,
  setFilterSettings
} from './filter';

const defaultId = (kind: 'stack' | 'module') =>
  `${kind}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;

export const createP0FilterStack = <K extends P0FilterKind>(
  kind: K,
  settings: unknown = {},
  createId: (kind: 'stack' | 'module') => string = defaultId
): AdjustmentStack => ({
  id: createId('stack'),
  revision: 0,
  modules: [{
    id: createId('module'),
    type: p0FilterDefinition(kind).moduleType,
    enabled: true,
    revision: 0,
    settings: normalizeP0FilterSettings(kind, {
      ...defaultP0FilterSettings(kind),
      ...(settings && typeof settings === 'object' ? settings : {})
    })
  }]
});

export const p0FilterModule = (
  stack: AdjustmentStack | null | undefined,
  expectedKind?: P0FilterKind
): AdjustmentModuleInstance | null => stack?.modules.find((module) => {
  const definition = p0FilterDefinitionForModule(module.type);
  return Boolean(definition && (!expectedKind || definition.kind === expectedKind));
}) ?? null;

export const p0FilterKindForStack = (
  stack: AdjustmentStack | null | undefined
): P0FilterKind | null => {
  const definition = p0FilterDefinitionForModule(p0FilterModule(stack)?.type ?? '');
  return definition?.kind ?? null;
};

export const p0FilterSettings = <K extends P0FilterKind>(
  stack: AdjustmentStack | null | undefined,
  kind: K
): P0FilterSettingsMap[K] | null => {
  const module = p0FilterModule(stack, kind);
  return module ? normalizeP0FilterSettings(kind, module.settings) : null;
};

export const setP0FilterSettings = <K extends P0FilterKind>(
  stack: AdjustmentStack,
  kind: K,
  patch: Partial<P0FilterSettingsMap[K]>
): AdjustmentStack => {
  let changed = false;
  const modules = stack.modules.map((module) => {
    const definition = p0FilterDefinitionForModule(module.type);
    if (definition?.kind !== kind) return module;
    const next = normalizeP0FilterSettings(kind, { ...module.settings, ...patch });
    if (JSON.stringify(next) === JSON.stringify(normalizeP0FilterSettings(kind, module.settings))) {
      return module;
    }
    changed = true;
    return { ...module, revision: module.revision + 1, settings: next };
  });
  return changed ? { ...stack, revision: stack.revision + 1, modules } : stack;
};

export const isP0FilterModuleType = (value: unknown): boolean =>
  typeof value === 'string' && Boolean(p0FilterDefinitionForModule(value));

export { isP0FilterKind };
