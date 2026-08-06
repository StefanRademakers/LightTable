export type LightTableResourceKind =
  | 'font'
  | 'gradient'
  | 'brush'
  | 'pattern'
  | (string & {});

export interface LightTableResourceSummary {
  readonly id: string;
  readonly kind: LightTableResourceKind;
  readonly name: string;
  readonly providerId: string;
  readonly group?: string;
  readonly keywords?: readonly string[];
  readonly thumbnailUrl?: string;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}
export interface LightTableResourcePage {
  readonly items: readonly LightTableResourceSummary[];
  readonly nextCursor?: string;
  readonly total?: number;
}

export interface LightTableResourceQuery {
  readonly kind: LightTableResourceKind;
  readonly search?: string;
  readonly cursor?: string;
  readonly pageSize?: number;
}

export interface LightTableResourceProvider<TResource = unknown> {
  readonly id: string;
  readonly kinds: readonly LightTableResourceKind[];
  search(query: LightTableResourceQuery, signal?: AbortSignal): Promise<LightTableResourcePage>;
  /** Loads the heavyweight resource only after the user chooses it. */
  load(id: string, signal?: AbortSignal): Promise<TResource | null>;
}

export const LIGHTTABLE_RESOURCE_PAGE_SIZE = 50;
export const LIGHTTABLE_RESOURCE_PAGE_SIZE_MAX = 100;

const normalizedPageSize = (value: number | undefined) => Math.min(
  LIGHTTABLE_RESOURCE_PAGE_SIZE_MAX,
  Math.max(1, Math.trunc(value ?? LIGHTTABLE_RESOURCE_PAGE_SIZE))
);

export class LightTableResourceBrowser {
  private readonly providers = new Map<string, LightTableResourceProvider>();

  register(provider: LightTableResourceProvider): () => void {
    if (!provider.id.trim()) throw new Error('A resource provider needs a stable id.');
    if (this.providers.has(provider.id)) {
      throw new Error(`Resource provider already registered: ${provider.id}`);
    }
    this.providers.set(provider.id, provider);
    return () => this.providers.delete(provider.id);
  }

  provider(id: string): LightTableResourceProvider | undefined {
    return this.providers.get(id);
  }

  providersFor(kind: LightTableResourceKind): readonly LightTableResourceProvider[] {
    return [...this.providers.values()].filter((provider) => provider.kinds.includes(kind));
  }

  async search(
    providerId: string,
    query: LightTableResourceQuery,
    signal?: AbortSignal
  ): Promise<LightTableResourcePage> {
    const provider = this.providers.get(providerId);
    if (!provider || !provider.kinds.includes(query.kind)) {
      throw new Error(`Resource provider ${providerId} does not serve ${query.kind}.`);
    }
    signal?.throwIfAborted();
    const result = await provider.search({
      ...query,
      search: query.search?.trim(),
      pageSize: normalizedPageSize(query.pageSize)
    }, signal);
    signal?.throwIfAborted();
    if (result.items.length > LIGHTTABLE_RESOURCE_PAGE_SIZE_MAX) {
      throw new Error(`Resource provider ${providerId} returned an unbounded page.`);
    }
    return result;
  }

  async load<TResource = unknown>(
    providerId: string,
    id: string,
    signal?: AbortSignal
  ): Promise<TResource | null> {
    const provider = this.providers.get(providerId);
    if (!provider) throw new Error(`Unknown resource provider: ${providerId}`);
    signal?.throwIfAborted();
    return provider.load(id, signal) as Promise<TResource | null>;
  }
}
