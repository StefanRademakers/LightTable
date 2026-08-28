import {
  P0_FILTER_PACK,
  isP0FilterKind,
  normalizeP0FilterSettings,
  type P0FilterDefinition,
  type P0FilterKind,
  type P0FilterSettingsMap
} from './p0FilterCatalog';
import {
  P1_FILTER_PACK,
  isP1FilterKind,
  normalizeP1FilterSettings,
  type P1FilterDefinition,
  type P1FilterKind,
  type P1FilterSettingsMap
} from './p1FilterCatalog';
import {
  P2_FILTER_PACK, isP2FilterKind, normalizeP2FilterSettings,
  type P2FilterDefinition, type P2FilterKind, type P2FilterSettingsMap
} from './p2FilterCatalog';
import { createFilterRegistry } from './filterRegistry';

/**
 * Deliberately static activation point. A pack can be removed without hidden
 * registration side effects or changes to the document processing graph.
 */
export const ACTIVE_FILTER_PACKS = [P0_FILTER_PACK, P1_FILTER_PACK, P2_FILTER_PACK] as const;

export const FILTER_REGISTRY = createFilterRegistry(ACTIVE_FILTER_PACKS);

export type FilterKind = P0FilterKind | P1FilterKind | P2FilterKind;
export interface FilterSettingsMap extends P0FilterSettingsMap, P1FilterSettingsMap, P2FilterSettingsMap {}
export type FilterDefinition = P0FilterDefinition | P1FilterDefinition | P2FilterDefinition;
export const FILTER_DEFINITIONS = FILTER_REGISTRY.definitions as readonly FilterDefinition[];

export const isFilterKind = (value: unknown): value is FilterKind =>
  isP0FilterKind(value) || isP1FilterKind(value) || isP2FilterKind(value);

export const filterDefinition = <K extends FilterKind>(kind: K): Extract<FilterDefinition, { kind: K }> =>
  FILTER_REGISTRY.definition(kind) as Extract<FilterDefinition, { kind: K }>;

export const filterDefinitionForModule = (moduleType: string): FilterDefinition | null =>
  FILTER_REGISTRY.definitionForModule(moduleType) as FilterDefinition | null;

export const normalizeFilterSettings = <K extends FilterKind>(
  kind: K,
  value: unknown
): FilterSettingsMap[K] => isP0FilterKind(kind)
    ? normalizeP0FilterSettings(kind, value) as unknown as FilterSettingsMap[K]
    : isP1FilterKind(kind)
      ? normalizeP1FilterSettings(kind, value) as unknown as FilterSettingsMap[K]
      : normalizeP2FilterSettings(kind, value) as unknown as FilterSettingsMap[K];

export const defaultFilterSettings = <K extends FilterKind>(kind: K): FilterSettingsMap[K] =>
  normalizeFilterSettings(kind, filterDefinition(kind).defaults);
