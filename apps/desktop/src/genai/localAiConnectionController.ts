import type {
  GenAiCostEstimate,
  GenAiModelId,
  GenAiModelSummary,
  GenAiProviderSnapshot,
  GenAiProviderId,
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
  LightTableLocalAiConnectionTest,
  LightTableAiProviderConfig
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
  readonly providerId: GenAiProviderId;
  private client: LocalAiProviderClient | null = null;
  private readonly listeners = new Set<(snapshot: GenAiProviderSnapshot) => void>();
  private snapshotValue: GenAiProviderSnapshot;
  private capabilitiesValue: LocalAiCapabilitiesV1 | null = null;
  private activeConfiguration: LocalAiProviderConfiguration | null = null;
  private settings: LightTableLocalAiConnectionSettings = {
    mode: 'managed', host: '127.0.0.1', port: 7862
  };
  private transportOverride: LocalAiProviderConfiguration | null = null;

  constructor(
    private readonly managedSession: LocalAiProviderConfiguration | LocalAiProviderSessionSource,
    private readonly requestFetch?: typeof globalThis.fetch,
    identity: { readonly providerId?: GenAiProviderId; readonly label?: string } = {}
  ) {
    this.providerId = identity.providerId ?? LOCAL_AI_PROVIDER_ID;
    this.snapshotValue = {
      id: this.providerId,
      label: identity.label ?? 'Free Local AI',
      status: 'disconnected'
    };
  }

  snapshot(): GenAiProviderSnapshot { return this.snapshotValue; }

  async configure(settings: LightTableLocalAiConnectionSettings): Promise<void> {
    const normalized = normalizeConnectionSettings(settings);
    if (sameSettings(this.settings, normalized) && !this.transportOverride) return;
    if (this.snapshotValue.status === 'connected' || this.client) await this.disconnect();
    this.settings = normalized;
    this.transportOverride = null;
  }

  async configureProvider(config: LightTableAiProviderConfig): Promise<void> {
    if (config.id !== this.providerId) throw new Error('Provider configuration identity mismatch.');
    if (this.snapshotValue.status === 'connected' || this.client) await this.disconnect();
    this.transportOverride = {
      baseUrl: normalizeProviderBaseUrl(config.transport.baseUrl,
        config.localProcess?.autoStart === true, config.transport.allowRemote === true),
      ...(config.transport.apiToken ? { apiToken: config.transport.apiToken } : {}),
      timeoutMs: config.transport.timeoutMs
    };
    this.snapshotValue = { id: this.providerId, label: config.displayName, status: 'disconnected' };
  }

  async testProvider(config: LightTableAiProviderConfig): Promise<LightTableLocalAiConnectionTest> {
    try {
      const client = new LocalAiProviderClient({
        baseUrl: normalizeProviderBaseUrl(config.transport.baseUrl,
          config.localProcess?.autoStart === true, config.transport.allowRemote === true),
        ...(config.transport.apiToken ? { apiToken: config.transport.apiToken } : {}),
        timeoutMs: config.transport.timeoutMs,
        ...(this.requestFetch ? { fetch: this.requestFetch } : {})
      });
      const capabilities = await client.capabilities();
      return { ok: true, message: `Connected to ${capabilities.provider.name}.` };
    } catch (reason) {
      return { ok: false, message: reason instanceof Error ? reason.message : String(reason) };
    }
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
      const configuration = this.transportOverride ?? (this.settings.mode === 'managed'
        ? isSessionSource(this.managedSession) ? await this.managedSession.start() : this.managedSession
        : externalConfiguration(this.settings));
      this.client = new LocalAiProviderClient({
        ...configuration,
        ...(this.requestFetch ? { fetch: this.requestFetch } : {})
      });
      const [health, capabilities] = await Promise.all([this.client.health(), this.client.capabilities()]);
      if (!['ready', 'busy', 'loading-model'].includes(health.status)) {
        throw new Error(health.message ?? `Local AI service is ${health.status}.`);
      }
      this.capabilitiesValue = capabilities;
      this.activeConfiguration = configuration;
      this.publish({
        id: this.providerId,
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
    this.activeConfiguration = null;
    this.client = null;
    if (!this.transportOverride && this.settings.mode === 'managed' && isSessionSource(this.managedSession)) {
      await this.managedSession.stop();
    }
    this.publish({ id: this.providerId, label: this.snapshotValue.label, status: 'disconnected' });
    return this.snapshotValue;
  }

  async listModels(): Promise<readonly GenAiModelSummary[]> {
    return localAiModels(await this.capabilities(), this.providerId);
  }

  async loadWorkflow(modelId: GenAiModelId, mode: string): Promise<GenAiWorkflowDefinition> {
    const capabilities = await this.capabilities();
    const model = capabilities.models.find(({ id }) => id === modelId);
    if (!model) throw new Error(`Local AI model ${modelId} is unavailable.`);
    return localAiWorkflow(model, operationForMode(mode), this.providerId);
  }

  async estimateCost(): Promise<GenAiCostEstimate | null> { return null; }

  clientInstance(): LocalAiProviderClient {
    if (!this.client) throw new Error('The local AI provider is not connected.');
    return this.client;
  }

  apiHelpUrl(): string {
    const configuration = this.activeConfiguration ?? this.transportOverride
      ?? (this.settings.mode === 'external' ? externalConfiguration(this.settings) : null);
    if (!configuration) throw new Error('Connect the local AI provider before opening API help.');
    return new URL('/api/help', configuration.baseUrl).toString();
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

const normalizeProviderBaseUrl = (value: string, requiresLoopback: boolean, allowRemote: boolean): string => {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Provider URL must be a plain HTTP(S) base URL.');
  }
  if (requiresLoopback && !['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname.toLowerCase())) {
    throw new Error('Auto-start providers must use a loopback address.');
  }
  if (!allowRemote && !['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname.toLowerCase())) {
    throw new Error('Enable remote access before sending images to a non-loopback provider.');
  }
  return url.toString().replace(/\/$/u, '');
};
