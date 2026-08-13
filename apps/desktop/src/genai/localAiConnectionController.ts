import type {
  GenAiCostEstimate,
  GenAiModelId,
  GenAiModelSummary,
  GenAiProviderSnapshot,
  GenAiWorkflowDefinition
} from '@lighttable/genai-core';
import {
  LOCAL_AI_PROVIDER_ID,
  LocalAiProviderClient,
  localAiModels,
  localAiWorkflow,
  type LocalAiCapabilitiesV1,
  type LocalAiOperation
} from '@lighttable/genai-local';
import type { DesktopGenAiProviderController } from './providerRegistry';

export interface LocalAiProviderConfiguration {
  readonly baseUrl: string;
  readonly apiToken?: string;
  readonly timeoutMs?: number;
}

export interface LocalAiProviderSessionSource {
  start(): Promise<LocalAiProviderConfiguration>;
  stop(): Promise<void>;
}

export class LocalAiConnectionController implements DesktopGenAiProviderController {
  readonly providerId = LOCAL_AI_PROVIDER_ID;
  private client: LocalAiProviderClient | null = null;
  private readonly listeners = new Set<(snapshot: GenAiProviderSnapshot) => void>();
  private snapshotValue: GenAiProviderSnapshot = {
    id: LOCAL_AI_PROVIDER_ID,
    label: 'Free Local AI',
    status: 'disconnected'
  };
  private capabilitiesValue: LocalAiCapabilitiesV1 | null = null;

  constructor(
    private readonly configuration: LocalAiProviderConfiguration | LocalAiProviderSessionSource,
    private readonly requestFetch?: typeof globalThis.fetch
  ) {}

  snapshot(): GenAiProviderSnapshot { return this.snapshotValue; }

  subscribe(listener: (snapshot: GenAiProviderSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async connect(): Promise<GenAiProviderSnapshot> {
    this.publish({ ...this.snapshotValue, status: 'connecting', message: 'Connecting to local AI service…' });
    try {
      const configuration = isSessionSource(this.configuration)
        ? await this.configuration.start()
        : this.configuration;
      this.client = new LocalAiProviderClient({
        ...configuration,
        ...(this.requestFetch ? { fetch: this.requestFetch } : {})
      });
      const [health, capabilities] = await Promise.all([this.client.health(), this.client.capabilities()]);
      if (!['ready', 'busy', 'loading-model'].includes(health.status)) {
        throw new Error(health.message ?? `Local AI service is ${health.status}.`);
      }
      this.capabilitiesValue = capabilities;
      this.publish({
        id: LOCAL_AI_PROVIDER_ID,
        label: capabilities.provider.name,
        status: 'connected',
        connectedAt: Date.now()
      });
    } catch (reason) {
      this.publish({
        ...this.snapshotValue,
        status: 'error',
        message: reason instanceof Error ? reason.message : String(reason)
      });
    }
    return this.snapshotValue;
  }

  async disconnect(): Promise<GenAiProviderSnapshot> {
    this.capabilitiesValue = null;
    this.client = null;
    if (isSessionSource(this.configuration)) await this.configuration.stop();
    this.publish({ id: LOCAL_AI_PROVIDER_ID, label: this.snapshotValue.label, status: 'disconnected' });
    return this.snapshotValue;
  }

  async listModels(): Promise<readonly GenAiModelSummary[]> {
    return localAiModels(await this.capabilities());
  }

  async loadWorkflow(modelId: GenAiModelId, mode: string): Promise<GenAiWorkflowDefinition> {
    const capabilities = await this.capabilities();
    const model = capabilities.models.find(({ id }) => id === modelId);
    if (!model) throw new Error(`Local AI model ${modelId} is unavailable.`);
    return localAiWorkflow(model, operationForMode(mode));
  }

  async estimateCost(): Promise<GenAiCostEstimate | null> { return null; }

  clientInstance(): LocalAiProviderClient {
    if (!this.client) throw new Error('The local AI provider is not connected.');
    return this.client;
  }

  private async capabilities(): Promise<LocalAiCapabilitiesV1> {
    if (this.capabilitiesValue) return this.capabilitiesValue;
    const capabilities = await this.clientInstance().capabilities();
    this.capabilitiesValue = capabilities;
    return capabilities;
  }

  private publish(snapshot: GenAiProviderSnapshot): void {
    this.snapshotValue = snapshot;
    for (const listener of this.listeners) listener(snapshot);
  }
}

const operationForMode = (mode: string): LocalAiOperation => {
  if (mode === 'text2image' || mode === 'image.create') return 'image.create';
  if (mode === 'image2image' || mode === 'image.edit') return 'image.edit';
  if (mode === 'inpaint' || mode === 'image.inpaint') return 'image.inpaint';
  throw new Error(`Unsupported local AI mode: ${mode}.`);
};

const isSessionSource = (
  value: LocalAiProviderConfiguration | LocalAiProviderSessionSource
): value is LocalAiProviderSessionSource => 'start' in value && 'stop' in value;
