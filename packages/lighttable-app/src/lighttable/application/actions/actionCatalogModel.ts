import type {
  LightTableCommandCategory,
  LightTableCommandDefinition
} from '@lighttable/command-contract';
import type { CommandCapabilitySummary } from '../commands/lightTableCommandContract';

export const ACTION_CATEGORY_LABELS: Readonly<Record<LightTableCommandCategory, string>> = {
  document: 'Document',
  image: 'Image',
  view: 'View',
  layer: 'Layers',
  effects: 'Effects',
  file: 'File',
  text: 'Text',
  vector: 'Vector',
  automation: 'Automation',
  history: 'History'
};

export interface ActionCatalogItem {
  readonly definition: LightTableCommandDefinition;
  readonly available: boolean;
  readonly unavailableReason: string | null;
}

export interface ActionCatalogGroup {
  readonly category: LightTableCommandCategory;
  readonly label: string;
  readonly items: readonly ActionCatalogItem[];
}

export interface ActionCatalogFilter {
  readonly query: string;
  readonly category: 'all' | LightTableCommandCategory;
}

export const actionExposureLabel = (definition: LightTableCommandDefinition): string => {
  if (definition.externalMcp === 'execute') return 'MCP';
  if (definition.externalMcp === 'dedicated') return 'Dedicated MCP tool';
  if (definition.agentAccess) return 'Agent Access only';
  return 'Local only';
};

export const buildActionCatalogGroups = (
  definitions: readonly LightTableCommandDefinition[],
  capabilities: readonly CommandCapabilitySummary[] | null,
  filter: ActionCatalogFilter
): readonly ActionCatalogGroup[] => {
  const capabilityById = new Map(capabilities?.map((capability) => [capability.command, capability]) ?? []);
  const query = filter.query.trim().toLocaleLowerCase();
  const byCategory = new Map<LightTableCommandCategory, ActionCatalogItem[]>();

  for (const definition of definitions) {
    if (filter.category !== 'all' && definition.category !== filter.category) continue;
    if (query && ![definition.id, definition.label, definition.description]
      .some((value) => value.toLocaleLowerCase().includes(query))) continue;
    const capability = capabilityById.get(definition.id);
    const items = byCategory.get(definition.category) ?? [];
    items.push({
      definition,
      available: capability?.available ?? false,
      unavailableReason: capability?.reason
        ?? (capability ? null : 'The host did not report this command capability.')
    });
    byCategory.set(definition.category, items);
  }

  return [...byCategory].map(([category, items]) => ({
    category,
    label: ACTION_CATEGORY_LABELS[category],
    items
  }));
};
