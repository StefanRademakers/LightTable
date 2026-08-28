export type FilterPackId = 'p0' | 'p1' | 'p2';
export type FilterPackMaturity = 'stable' | 'preview' | 'experimental';

export interface FilterDefinitionContract {
  readonly kind: string;
  readonly moduleType: `lt.${string}`;
  readonly label: string;
  readonly menuLabel: string;
  readonly menuGroup: string;
}

export interface FilterPackContract<Definition extends FilterDefinitionContract = FilterDefinitionContract> {
  readonly id: FilterPackId;
  readonly maturity: FilterPackMaturity;
  readonly definitions: readonly Definition[];
  normalize(kind: string, value: unknown): unknown;
}

export interface FilterRegistry {
  readonly packs: readonly FilterPackContract[];
  readonly definitions: readonly FilterDefinitionContract[];
  definition(kind: string): FilterDefinitionContract | null;
  definitionForModule(moduleType: string): FilterDefinitionContract | null;
  packForKind(kind: string): FilterPackContract | null;
  normalize(kind: string, value: unknown): unknown;
}

/** Builds the one explicit catalog used by menus, commands and renderers. */
export const createFilterRegistry = (
  packs: readonly FilterPackContract[]
): FilterRegistry => {
  const byKind = new Map<string, FilterDefinitionContract>();
  const byModule = new Map<string, FilterDefinitionContract>();
  const packByKind = new Map<string, FilterPackContract>();
  for (const pack of packs) {
    for (const definition of pack.definitions) {
      if (byKind.has(definition.kind)) {
        throw new Error(`Duplicate filter kind: ${definition.kind}`);
      }
      if (byModule.has(definition.moduleType)) {
        throw new Error(`Duplicate filter module type: ${definition.moduleType}`);
      }
      byKind.set(definition.kind, definition);
      byModule.set(definition.moduleType, definition);
      packByKind.set(definition.kind, pack);
    }
  }
  const definitions = Object.freeze([...byKind.values()]);
  const activePacks = Object.freeze([...packs]);
  return Object.freeze({
    packs: activePacks,
    definitions,
    definition: (kind: string) => byKind.get(kind) ?? null,
    definitionForModule: (moduleType: string) => byModule.get(moduleType) ?? null,
    packForKind: (kind: string) => packByKind.get(kind) ?? null,
    normalize: (kind: string, value: unknown) => {
      const pack = packByKind.get(kind);
      if (!pack) throw new Error(`Unknown filter kind: ${kind}`);
      return pack.normalize(kind, value);
    }
  });
};
