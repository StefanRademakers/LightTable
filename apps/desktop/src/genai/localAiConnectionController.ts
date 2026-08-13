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
import type {
  LightTableLocalAiConnectionSettings,
  LightTableLocalAiConnectionTest
} from '@lighttable/app';

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
  private settings: LightTableLocalAiConnectionSettings = {
    mode: 'managed', host: '127.0.0.1', port: 7862
  };

  constructor(
    private readonly managedSession: LocalAiProviderConfiguration | LocalAiProviderSessionSource,
    private readonly requestFetch?: typeof globalThis.fetch
  ) {}

  snapshot(): GenAiProviderSnapshot { return this.snapshotValue; }

  async configure(settings: LightTableLocalAiConnectionSettings): Promise<void> {
    const normalized = normalizeConnectionSettings(settings);
    if (sameSettings(this.settings, normalized)) return;
    if (this.snapshotValue.status === 'connected' || this.client) await this.disconnect();
    this.settings = normalized;
  }

  async testConnection(settings: LightTableLocalAiConnectionSettings): Promise<LightTableLocalAiConnectionTest> {
    const normalized = normalizeConnectionSettings(settings);
    let managedConfiguration: LocalAiProviderConfiguration | undefined;
    try {
      const configuration = normalized.mode === 'managed'
        ? managedConfiguration = isSessionSource(this.managedSession)
          ? await this.managedSession.start()
          : this.managedSession
        : externalConfiguration(normalized);
      const client = new LocalAiProviderClient({
        ...configuration,
        ...(this.requestFetch ? { fetch: this.requestFetch } : {})
      });
      const [health, capabilities] = await Promise.all([client.health(), client.capabilities()]);
      if (!['ready', 'busy', 'loading-model'].includes(health.status)) {
        throw new Error(health.message ?? `Local AI service is ${health.status}.`);
      }
      return { ok: true, message: `Connected to ${capabilities.provider.name}.` };
    } catch (reason) {
      return { ok: false, message: reason instanceof Error ? reason.message : String(reason) };
    } finally {
      if (normalized.mode === 'managed' && managedConfiguration && !this.client
        && isSessionSource(this.managedSession)) await this.managedSession.stop();
    }
  }

  subscribe(listener: (snapshot: GenAiProviderSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async connect(): Promise<GenAiProviderSnapshot> {
    this.publish({ ...this.snapshotValue, status: 'connecting', message: 'Connecting to local AI service…' });
    try {
      const configuration = this.settings.mode === 'managed'
        ? isSessionSource(this.managedSession) ? await this.managedSession.start() : this.managedSession
        : externalConfiguration(this.settings);
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
    if (this.settings.mode === 'managed' && isSessionSource(this.managedSession)) await this.managedSession.stop();
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

const normalizeConnectionSettings = (
  settings: LightTableLocalAiConnectionSettings
): LightTableLocalAiConnectionSettings => {
  const host = settings.host.trim().toLowerCase();
  if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host)) {
    throw new Error('Free Local AI only accepts loopback hosts.');
  }
  if (!Number.isInteger(settings.port) || settings.port < 1 || settings.port > 65_535) {
    throw new Error('Free Local AI port must be between 1 and 65535.');
  }
  return { mode: settings.mode === 'external' ? 'external' : 'managed', host, port: settings.port };
};

const externalConfiguration = (settings: LightTableLocalAiConnectionSettings): LocalAiProviderConfiguration => ({
  baseUrl: `http://${settings.host === '::1' ? '[::1]' : settings.host}:${settings.port}`
});

const sameSettings = (left: LightTableLocalAiConnectionSettings, right: LightTableLocalAiConnectionSettings) =>
  left.mode === right.mode && left.host === right.host && left.port === right.port;
