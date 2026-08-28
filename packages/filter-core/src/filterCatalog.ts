import { P0_FILTER_PACK } from './p0FilterCatalog';
import { createFilterRegistry } from './filterRegistry';

/**
 * Deliberately static activation point. A pack can be removed without hidden
 * registration side effects or changes to the document processing graph.
 */
export const ACTIVE_FILTER_PACKS = [P0_FILTER_PACK] as const;

export const FILTER_REGISTRY = createFilterRegistry(ACTIVE_FILTER_PACKS);

