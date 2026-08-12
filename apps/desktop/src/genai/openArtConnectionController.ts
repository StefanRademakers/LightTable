import { randomBytes } from 'node:crypto';
import type {
  GenAiCostEstimate,
  GenAiGenerationRequest,
  GenAiGenerationSubmission,
  GenAiJobId,
  GenAiModelId,
  GenAiModelSummary,
  GenAiProviderId,
  GenAiProviderSnapshot,
  GenAiWorkflowDefinition
} from '@lighttable/genai-core';
import { transitionGenAiProvider } from '@lighttable/genai-core';
import {
  OpenArtConnection,
  OPENART_MCP_URL,
  OPENART_PROVIDER_ID,
  type OpenArtCredentialStore
} from '@lighttable/genai-openart';
import {
  mcpToolPayload,
  normalizeOpenArtModels,
  normalizeOpenArtWorkflow,
  normalizeOpenArtCost,
  buildOpenArtGenerationParams,
  type OpenArtResolvedReference
} from '@lighttable/genai-openart';
import type { OpenArtConnectionHost } from '@lighttable/genai-openart';
import type { OpenArtCatalogStore } from './openArtCatalogStore';

const providerId = OPENART_PROVIDER_ID as GenAiProviderId;

export class OpenArtConnectionController {
  private snapshotValue: GenAiProviderSnapshot = {
    id: providerId,
    label: 'OpenArt',
    status: 'disconnected'
  };
  private readonly listeners = new Set<(snapshot: GenAiProviderSnapshot) => void>();
  private readonly connection: OpenArtConnection;
  private operation: Promise<GenAiProviderSnapshot> | null = null;
  private connectGeneration = 0;
  private readonly workflows = new Map<string, GenAiWorkflowDefinition>();
  private models: readonly GenAiModelSummary[] | null = null;
  private readonly catalogStore?: OpenArtCatalogStore;
  private costEstimateSupported = true;

  constructor(options: {
    readonly version: string;
    readonly store: OpenArtCredentialStore;
    readonly host: OpenArtConnectionHost;
    readonly catalogStore?: OpenArtCatalogStore;
  }) {
    this.catalogStore = options.catalogStore;
    this.connection = new OpenArtConnection({
      endpoint: OPENART_MCP_URL,
      appVersion: options.version,
      store: options.store,
      host: options.host,
      createState: () => randomBytes(32).toString('base64url')
    });
  }

  snapshot(): GenAiProviderSnapshot {
    return this.snapshotValue;
  }

  subscribe(listener: (snapshot: GenAiProviderSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  connect(): Promise<GenAiProviderSnapshot> {
    const generation = ++this.connectGeneration;
    this.publish(transitionGenAiProvider(this.snapshotValue, 'connecting', {
      message: 'Complete sign-in in your browser.'
    }));
    const operation = this.connection.resetInteractiveConnection()
      .then(() => generation === this.connectGeneration
        ? this.connection.connect()
        : undefined)
      .then(() => {
        if (generation !== this.connectGeneration) return this.snapshotValue;
        this.publish(transitionGenAiProvider(this.snapshotValue, 'connected', {
          message: undefined,
          connectedAt: Date.now()
        }));
        return this.snapshotValue;
      })
      .catch((reason) => {
        if (generation !== this.connectGeneration) return this.snapshotValue;
        const message = reason instanceof Error ? reason.message : String(reason);
        this.publish(transitionGenAiProvider(this.snapshotValue, 'error', { message }));
        return this.snapshotValue;
      })
      .finally(() => { if (this.operation === operation) this.operation = null; });
    this.operation = operation;
    return operation;
  }

  restore(): Promise<GenAiProviderSnapshot> {
    if (this.operation) return this.operation;
    if (this.snapshotValue.status !== 'disconnected') return Promise.resolve(this.snapshotValue);
    this.operation = this.connection.restore().then((result) => {
      if (result === 'connected') {
        this.publish(transitionGenAiProvider(this.snapshotValue, 'connecting'));
        this.publish(transitionGenAiProvider(this.snapshotValue, 'connected', {
          connectedAt: Date.now()
        }));
      } else if (result === 'expired') {
        this.publish(transitionGenAiProvider(this.snapshotValue, 'connecting'));
        this.publish(transitionGenAiProvider(this.snapshotValue, 'expired', {
          message: 'Your OpenArt session expired. Connect again.'
        }));
      }
      return this.snapshotValue;
    }).catch((reason) => {
      this.publish(transitionGenAiProvider(this.snapshotValue, 'connecting'));
      this.publish(transitionGenAiProvider(this.snapshotValue, 'error', {
        message: reason instanceof Error
          ? reason.message
          : 'OpenArt connection recovery failed.'
      }));
      return this.snapshotValue;
    }).finally(() => { this.operation = null; });
    return this.operation;
  }

  async disconnect(): Promise<GenAiProviderSnapshot> {
    ++this.connectGeneration;
    this.operation = null;
    await this.connection.disconnect(true);
    this.publish(transitionGenAiProvider(this.snapshotValue, 'disconnected', {
      message: undefined
    }));
    return this.snapshotValue;
  }

  async listModels(): Promise<readonly GenAiModelSummary[]> {
    if (this.models) return this.models;
    try {
      const result = await this.connection.callTool('openart_model_list');
      const models = normalizeOpenArtModels(mcpToolPayload(result as Parameters<typeof mcpToolPayload>[0]));
      this.models = models;
      await this.catalogStore?.saveModels(models);
      return models;
    } catch (reason) {
      const cached = (await this.catalogStore?.load())?.models ?? [];
      if (cached.length) { this.models = cached; return cached; }
      throw reason;
    }
  }

  async loadWorkflow(modelId: GenAiModelId, mode: string): Promise<GenAiWorkflowDefinition> {
    const workflowId = `${OPENART_PROVIDER_ID}:${modelId}:${mode}`;
    const memoryWorkflow = this.workflows.get(workflowId);
    if (memoryWorkflow) return memoryWorkflow;
    const diskWorkflow = await this.catalogStore?.workflow(workflowId);
    if (diskWorkflow) {
      this.workflows.set(diskWorkflow.id, diskWorkflow);
      return diskWorkflow;
    }
    try {
      const result = await this.connection.callTool('openart_model_form_get', { model: modelId, mode });
      const workflow = normalizeOpenArtWorkflow(
        mcpToolPayload(result as Parameters<typeof mcpToolPayload>[0]), modelId, mode
      );
      this.workflows.set(workflow.id, workflow);
      await this.catalogStore?.saveWorkflow(workflow);
      return workflow;
    } catch (reason) {
      const cached = this.workflows.get(workflowId) ?? await this.catalogStore?.workflow(workflowId);
      if (cached) { this.workflows.set(cached.id, cached); return cached; }
      throw reason;
    }
  }

  async estimateCost(
    modelId: GenAiModelId,
    mode: string,
    params: Readonly<Record<string, unknown>>
  ): Promise<GenAiCostEstimate | null> {
    if (!this.costEstimateSupported) return null;
    try {
      const result = await this.connection.callTool('openart_model_cost', { model: modelId, mode, params });
      return normalizeOpenArtCost(mcpToolPayload(result as Parameters<typeof mcpToolPayload>[0]));
    } catch (reason) {
      // Pricing is optional presentation metadata. Some OpenArt MCP versions
      // return prose rather than a structured payload; never fail or stall the
      // generation form for that response, and do not retry it on every edit.
      if (reason instanceof Error && reason.message.includes('no machine-readable result')) {
        this.costEstimateSupported = false;
      }
      return null;
    }
  }

  async submitGeneration(
    request: GenAiGenerationRequest,
    resolvedReferences: readonly OpenArtResolvedReference[] = [],
    jobId = `genai-${Date.now()}-${randomBytes(8).toString('hex')}` as GenAiJobId
  ): Promise<GenAiGenerationSubmission> {
    const mode = request.workflowId.split(':').at(-1) ?? 'text2image';
    const workflow = this.workflows.get(request.workflowId)
      ?? await this.loadWorkflow(request.modelId, mode);
    const result = await this.connection.callTool('openart_generate_image', {
      model: request.modelId,
      mode,
      params: buildOpenArtGenerationParams(request, workflow, resolvedReferences)
    });
    const payload = mcpToolPayload(result as Parameters<typeof mcpToolPayload>[0]);
    const providerJobId = findHistoryId(payload);
    if (!providerJobId) throw new Error('OpenArt accepted no identifiable generation job.');
    return { jobId, providerJobId, status: 'submitted' };
  }

  async waitForGeneration(
    providerJobId: string,
    signal?: AbortSignal
  ): Promise<{ readonly url: string; readonly mediaType: string }> {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      signal?.throwIfAborted();
      const result = await this.connection.callTool('openart_creation_wait', {
        historyId: providerJobId,
        timeoutSeconds: 45
      });
      signal?.throwIfAborted();
      const payload = mcpToolPayload(result as Parameters<typeof mcpToolPayload>[0]);
      const status = findString(payload, ['status', 'state'])?.toUpperCase();
      if (status === 'FAILED') throw new Error(findString(payload, ['errorMessage', 'error_message', 'error', 'message']) ?? 'OpenArt generation failed.');
      if (status === 'CANCELLED' || status === 'CANCELED') throw new Error('OpenArt generation was cancelled.');
      if (status === 'COMPLETED') {
        const url = findBestHttpUrl(payload);
        if (!url) throw new Error('OpenArt completed the generation without an output URL.');
        return { url, mediaType: 'image/png' };
      }
      await abortableDelay(Math.min(8_000, 500 * 1.5 ** attempt), signal);
    }
    throw new Error('Timed out while waiting for OpenArt generation.');
  }

  private publish(snapshot: GenAiProviderSnapshot): void {
    this.snapshotValue = snapshot;
    for (const listener of this.listeners) listener(snapshot);
  }
}

const abortableDelay = (durationMs: number, signal?: AbortSignal): Promise<void> => new Promise((resolve, reject) => {
  if (signal?.aborted) { reject(signal.reason); return; }
  const timeout = setTimeout(resolve, durationMs);
  signal?.addEventListener('abort', () => {
    clearTimeout(timeout);
    reject(signal.reason);
  }, { once: true });
});

const findHistoryId = (value: unknown, depth = 0): string | null => {
  if (depth > 6 || !value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  for (const key of ['historyId', 'history_id', 'jobId', 'job_id', 'id']) {
    if (typeof record[key] === 'string' && record[key]) return record[key] as string;
  }
  for (const nested of Object.values(record)) {
    const found = findHistoryId(nested, depth + 1);
    if (found) return found;
  }
  return null;
};

const findString = (value: unknown, keys: readonly string[], depth = 0): string | null => {
  if (depth > 8 || value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const source = value.trim();
    if ((source.startsWith('{') && source.endsWith('}')) || (source.startsWith('[') && source.endsWith(']'))) {
      try { return findString(JSON.parse(source), keys, depth + 1); } catch { return null; }
    }
    return null;
  }
  if (Array.isArray(value)) {
    for (const item of value) { const found = findString(item, keys, depth + 1); if (found) return found; }
    return null;
  }
  if (typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  for (const key of keys) if (typeof record[key] === 'string' && record[key]) return record[key] as string;
  for (const item of Object.values(record)) { const found = findString(item, keys, depth + 1); if (found) return found; }
  return null;
};

const findBestHttpUrl = (value: unknown, depth = 0): string | null => {
  if (depth > 8 || value === null || value === undefined) return null;
  if (typeof value === 'string') {
    if (/^https?:\/\//iu.test(value)) return value;
    const source = value.trim();
    if ((source.startsWith('{') && source.endsWith('}')) || (source.startsWith('[') && source.endsWith(']'))) {
      try { return findBestHttpUrl(JSON.parse(source), depth + 1); } catch { return null; }
    }
    return null;
  }
  if (Array.isArray(value)) {
    for (const item of value) { const found = findBestHttpUrl(item, depth + 1); if (found) return found; }
    return null;
  }
  if (typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  for (const key of ['resourceUrl', 'resource_url', 'outputUrl', 'output_url', 'url']) {
    if (typeof record[key] === 'string' && /^https?:\/\//iu.test(record[key])) return record[key] as string;
  }
  for (const item of Object.values(record)) { const found = findBestHttpUrl(item, depth + 1); if (found) return found; }
  return null;
};
