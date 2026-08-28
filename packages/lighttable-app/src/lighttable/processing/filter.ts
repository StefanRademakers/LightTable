import {
  defaultFilterSettings,
  filterDefinition,
  filterDefinitionForModule,
  isFilterKind,
  normalizeFilterSettings,
  type FilterKind,
  type FilterSettingsMap,
} from "@lighttable/filter-core";
import type {
  AdjustmentModuleInstance,
  AdjustmentStack,
} from "./adjustmentStack";

const defaultId = (kind: "stack" | "module") =>
  `${kind}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;

export const createFilterStack = <K extends FilterKind>(
  kind: K,
  settings: unknown = {},
  createId: (kind: "stack" | "module") => string = defaultId,
): AdjustmentStack => ({
  id: createId("stack"),
  revision: 0,
  modules: [
    {
      id: createId("module"),
      type: filterDefinition(kind).moduleType,
      enabled: true,
      revision: 0,
      settings: normalizeFilterSettings(kind, {
        ...defaultFilterSettings(kind),
        ...(settings && typeof settings === "object" ? settings : {}),
      }),
    },
  ],
});

export const filterModule = (
  stack: AdjustmentStack | null | undefined,
  expectedKind?: FilterKind,
): AdjustmentModuleInstance | null =>
  stack?.modules.find((module) => {
    const definition = filterDefinitionForModule(module.type);
    return Boolean(
      definition && (!expectedKind || definition.kind === expectedKind),
    );
  }) ?? null;

export const filterKindForStack = (
  stack: AdjustmentStack | null | undefined,
): FilterKind | null =>
  filterDefinitionForModule(filterModule(stack)?.type ?? "")?.kind ?? null;

export const filterSettings = <K extends FilterKind>(
  stack: AdjustmentStack | null | undefined,
  kind: K,
): FilterSettingsMap[K] | null => {
  const module = filterModule(stack, kind);
  return module ? normalizeFilterSettings(kind, module.settings) : null;
};

export const setFilterSettings = <K extends FilterKind>(
  stack: AdjustmentStack,
  kind: K,
  patch: Partial<FilterSettingsMap[K]>,
): AdjustmentStack => {
  let changed = false;
  const modules = stack.modules.map((module) => {
    const definition = filterDefinitionForModule(module.type);
    if (definition?.kind !== kind) return module;
    const current = normalizeFilterSettings(kind, module.settings);
    const next = normalizeFilterSettings(kind, { ...current, ...patch });
    if (JSON.stringify(next) === JSON.stringify(current)) return module;
    changed = true;
    return { ...module, revision: module.revision + 1, settings: next };
  });
  return changed ? { ...stack, revision: stack.revision + 1, modules } : stack;
};

export const isFilterModuleType = (value: unknown): boolean =>
  typeof value === "string" && Boolean(filterDefinitionForModule(value));

export { isFilterKind };
