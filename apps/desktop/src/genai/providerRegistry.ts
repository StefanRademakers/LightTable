import type {
  GenAiCostEstimate,
  GenAiModelId,
  GenAiModelSummary,
  GenAiProviderId,
  GenAiProviderSnapshot,
  GenAiWorkflowDefinition
} from '@lighttable/genai-core';

/**
 * Desktop-side provider boundary. Implementations own provider-specific auth,
 * discovery and request conversion. The renderer, Agent and MCP layers never
 * get access to those details.
 */
export interface DesktopGenAiProviderController {
  readonly providerId: GenAiProviderId;
  snapshot(): GenAiProviderSnapshot;
  subscribe(listener: (snapshot: GenAiProviderSnapshot) => void): () => void;
  connect(): Promise<GenAiProviderSnapshot>;
  disconnect(): Promise<GenAiProviderSnapshot>;
  listModels(): Promise<readonly GenAiModelSummary[]>;
  loadWorkflow(modelId: GenAiModelId, mode: string): Promise<GenAiWorkflowDefinition>;
  estimateCost(
    modelId: GenAiModelId,
    mode: string,
    fields: Readonly<Record<string, unknown>>
  ): Promise<GenAiCostEstimate | null>;
}

export class GenAiProviderRegistry {
  private readonly providers = new Map<GenAiProviderId, DesktopGenAiProviderController>();
  private readonly listeners = new Set<(snapshot: GenAiProviderSnapshot) => void>();
  private readonly subscriptions = new Map<GenAiProviderId, () => void>();

  register(provider: DesktopGenAiProviderController): void {
    if (this.providers.has(provider.providerId)) {
      throw new Error(`GenAI provider ${provider.providerId} is already registered.`);
    }
    this.providers.set(provider.providerId, provider);
    this.subscriptions.set(provider.providerId, provider.subscribe((snapshot) => {
      for (const listener of this.listeners) listener(snapshot);
    }));
  }

  snapshots(): readonly GenAiProviderSnapshot[] {
    return [...this.providers.values()].map((provider) => provider.snapshot());
  }

  provider(providerId: GenAiProviderId): DesktopGenAiProviderController {
    const provider = this.providers.get(providerId);
    if (!provider) throw new Error(`Unsupported GenAI provider: ${providerId}.`);
    return provider;
  }

  subscribe(listener: (snapshot: GenAiProviderSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    for (const unsubscribe of this.subscriptions.values()) unsubscribe();
    this.subscriptions.clear();
    this.providers.clear();
    this.listeners.clear();
  }
}
