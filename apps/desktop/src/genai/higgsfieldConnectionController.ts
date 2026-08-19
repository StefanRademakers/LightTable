import { randomBytes } from 'node:crypto';
import type {
  GenAiAssetPayload,
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
  HIGGSFIELD_MCP_URL,
  HIGGSFIELD_PROVIDER_ID,
  HiggsfieldConnection,
  buildHiggsfieldGenerationParams,
  classifyHiggsfieldContract,
  extractHiggsfieldGenerationId,
  higgsfieldToolPayload,
  normalizeHiggsfieldCompletion,
  normalizeHiggsfieldCost,
  normalizeHiggsfieldModels,
  normalizeHiggsfieldWorkflow,
  requireHiggsfieldCapability,
  type HiggsfieldCapabilities,
  type HiggsfieldConnectionHost,
  type HiggsfieldCredentialStore,
  type HiggsfieldResolvedReference,
  type HiggsfieldToolDescription
} from '@lighttable/genai-higgsfield';
import { abortableDelay } from './abortableDelay';
import type { DesktopGenAiProviderController } from './providerRegistry';

const providerId = HIGGSFIELD_PROVIDER_ID as GenAiProviderId;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SUPPORTED_MODEL_IDS = new Set([
  'nano_banana_2',
  'flux_2',
  'seedance_2_0',
  'seedance_2_5',
  'kling3_0',
  'flux_3_video'
]);
const object = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

const findNamedString = (value: unknown, names: readonly string[], depth = 0): string | null => {
  if (depth > 8 || value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const source = value.trim();
    if ((source.startsWith('{') && source.endsWith('}')) || (source.startsWith('[') && source.endsWith(']'))) {
      try { return findNamedString(JSON.parse(source), names, depth + 1); } catch { return null; }
    }
    return null;
  }
  if (Array.isArray(value)) {
    for (const item of value) { const found = findNamedString(item, names, depth + 1); if (found) return found; }
    return null;
  }
  const record = object(value);
  if (!record) return null;
  for (const name of names) if (typeof record[name] === 'string' && record[name]) return record[name] as string;
  for (const item of Object.values(record)) { const found = findNamedString(item, names, depth + 1); if (found) return found; }
  return null;
};

const buildArguments = (
  tool: HiggsfieldToolDescription,
  semantic: Readonly<Record<string, unknown>>
): Readonly<Record<string, unknown>> => {
  const properties = tool.inputSchema?.properties ?? {};
  const args: Record<string, unknown> = {};
  const aliases: Readonly<Record<string, readonly string[]>> = {
    filename: ['filename', 'file_name', 'name'], contentType: ['content_type', 'contentType', 'mime_type'],
    mediaId: ['media_id', 'mediaId', 'id'], mediaType: ['type', 'media_type', 'mediaType'],
    jobId: ['jobId', 'job_id', 'id'], modelId: ['model_id', 'modelId', 'id'],
    rawData: ['raw_data', 'rawData']
  };
  for (const [key, value] of Object.entries(semantic)) {
    if (value === undefined) continue;
    const field = (aliases[key] ?? [key]).find((candidate) => candidate in properties);
    if (field) args[field] = value;
  }
  const missing = (tool.inputSchema?.required ?? []).filter((field) => !(field in args));
  if (missing.length) throw new Error(`${tool.name} requires unsupported discovered field(s): ${missing.join(', ')}.`);
  return args;
};

export class HiggsfieldConnectionController implements DesktopGenAiProviderController {
  readonly providerId = providerId;
  private snapshotValue: GenAiProviderSnapshot = { id: providerId, label: 'Higgsfield', status: 'disconnected' };
  private readonly listeners = new Set<(snapshot: GenAiProviderSnapshot) => void>();
  private readonly connection: HiggsfieldConnection;
  private capabilities: HiggsfieldCapabilities | null = null;
  private models: readonly GenAiModelSummary[] | null = null;
  private readonly modelPayloads = new Map<string, unknown>();
  private readonly workflows = new Map<string, GenAiWorkflowDefinition>();

  constructor(options: { readonly version: string; readonly store: HiggsfieldCredentialStore; readonly host: HiggsfieldConnectionHost }) {
    this.connection = new HiggsfieldConnection({
      endpoint: HIGGSFIELD_MCP_URL, appVersion: options.version, store: options.store, host: options.host,
      createState: () => randomBytes(32).toString('base64url')
    });
  }

  snapshot() { return this.snapshotValue; }
  subscribe(listener: (snapshot: GenAiProviderSnapshot) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  async connect() {
    this.publish(transitionGenAiProvider(this.snapshotValue, 'connecting', { message: 'Complete sign-in in your browser.' }));
    try {
      await this.connection.resetInteractiveConnection();
      await this.connection.connect();
      await this.refreshCapabilities();
      this.publish(transitionGenAiProvider(this.snapshotValue, 'connected', { connectedAt: Date.now(), message: undefined }));
    } catch (reason) {
      this.publish(transitionGenAiProvider(this.snapshotValue, 'error', { message: reason instanceof Error ? reason.message : String(reason) }));
    }
    return this.snapshotValue;
  }
  async restore() {
    const result = await this.connection.restore().catch(() => 'expired' as const);
    if (result === 'connected') {
      try {
        await this.refreshCapabilities();
        this.publish(transitionGenAiProvider(this.snapshotValue, 'connecting'));
        this.publish(transitionGenAiProvider(this.snapshotValue, 'connected', { connectedAt: Date.now() }));
      } catch (reason) {
        this.publish(transitionGenAiProvider(this.snapshotValue, 'error', { message: reason instanceof Error ? reason.message : String(reason) }));
      }
    } else if (result === 'expired') {
      this.publish(transitionGenAiProvider(this.snapshotValue, 'connecting'));
      this.publish(transitionGenAiProvider(this.snapshotValue, 'expired', { message: 'Your Higgsfield session expired. Connect again.' }));
    }
    return this.snapshotValue;
  }
  async disconnect() {
    await this.connection.disconnect(true);
    this.capabilities = null; this.models = null; this.modelPayloads.clear(); this.workflows.clear();
    this.publish(transitionGenAiProvider(this.snapshotValue, 'disconnected', { message: undefined }));
    return this.snapshotValue;
  }

  async listModels(): Promise<readonly GenAiModelSummary[]> {
    if (this.models) return this.models;
    const capabilities = this.requireCapabilities();
    requireHiggsfieldCapability(capabilities, 'canDiscover');
    let discovered: readonly GenAiModelSummary[];
    if (capabilities.tools.has('models_list')) {
      const collected: GenAiModelSummary[] = [];
      let after: string | null = null;
      for (let page = 0; page < 10; page += 1) {
        const payload = higgsfieldToolPayload(await this.connection.callTool('models_list', {
          limit: 100, ...(after ? { after } : {})
        }) as Parameters<typeof higgsfieldToolPayload>[0]);
        collected.push(...normalizeHiggsfieldModels(payload));
        const next = findNamedString(payload, ['next_page_token', 'nextPageToken', 'next_cursor', 'nextCursor']);
        if (!next || next === after) break;
        after = next;
      }
      discovered = collected;
    } else {
      const tool = capabilities.tools.get('models_explore')!;
      const payloads = await Promise.all([...SUPPORTED_MODEL_IDS].map(async (modelId) => {
        try {
          return higgsfieldToolPayload(await this.connection.callTool(tool.name,
            buildArguments(tool, { action: 'get', modelId })) as Parameters<typeof higgsfieldToolPayload>[0]);
        } catch { return null; }
      }));
      discovered = payloads.flatMap((payload) => payload ? normalizeHiggsfieldModels(payload) : []);
    }
    this.models = discovered.filter(({ id }) => SUPPORTED_MODEL_IDS.has(String(id)));
    if (!this.models.length) throw new Error('Higgsfield returned no supported image or video models.');
    return this.models;
  }

  async loadWorkflow(modelId: GenAiModelId, mode: string): Promise<GenAiWorkflowDefinition> {
    const key = `${modelId}:${mode}`;
    const cached = this.workflows.get(key);
    if (cached) return cached;
    const payload = await this.loadModelPayload(modelId);
    const workflow = normalizeHiggsfieldWorkflow(payload, modelId, mode);
    this.workflows.set(key, workflow);
    return workflow;
  }

  async estimateCost(modelId: GenAiModelId, mode: string, fields: Readonly<Record<string, unknown>>): Promise<GenAiCostEstimate | null> {
    const capabilities = this.requireCapabilities();
    const video = mode.includes('video');
    const toolName = video ? 'estimate_video_cost' : 'estimate_image_cost';
    if (video ? !capabilities.canEstimateVideo : !capabilities.canEstimateImage) return null;
    const result = await this.connection.callTool(toolName, { model: modelId, ...fields });
    return normalizeHiggsfieldCost(higgsfieldToolPayload(result as Parameters<typeof higgsfieldToolPayload>[0]));
  }

  async uploadReference(asset: GenAiAssetPayload): Promise<{ readonly providerAssetId: string; readonly mediaType: string }> {
    const capabilities = this.requireCapabilities();
    requireHiggsfieldCapability(capabilities, 'canPublishBytes');
    const uploadTool = capabilities.tools.get('media_upload')!;
    const mediaType = asset.mediaType.startsWith('video/') ? 'video' : asset.mediaType.startsWith('audio/') ? 'audio' : 'image';
    const uploadPayload = higgsfieldToolPayload(await this.connection.callTool(uploadTool.name, buildArguments(uploadTool, {
      method: 'upload_url', filename: asset.name, contentType: asset.mediaType
    })) as Parameters<typeof higgsfieldToolPayload>[0]);
    const uploadUrl = findNamedString(uploadPayload, ['upload_url', 'uploadUrl', 'presigned_url', 'signedUrl']);
    const mediaId = findNamedString(uploadPayload, ['media_id', 'mediaId', 'media_input_id', 'id']);
    if (!uploadUrl || !/^https:\/\//iu.test(uploadUrl) || !mediaId || !UUID_PATTERN.test(mediaId)) {
      throw new Error('Higgsfield returned no complete signed upload target.');
    }
    const response = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': asset.mediaType }, body: Buffer.from(asset.bytes) });
    if (!response.ok) throw new Error(`Higgsfield reference upload failed (${response.status}).`);
    const confirmTool = capabilities.tools.get('media_confirm')!;
    const confirmed = higgsfieldToolPayload(await this.connection.callTool(confirmTool.name, buildArguments(confirmTool, {
      mediaType, mediaId
    })) as Parameters<typeof higgsfieldToolPayload>[0]);
    const confirmedId = findNamedString(confirmed, ['media_id', 'mediaId', 'media_input_id', 'id']);
    return { providerAssetId: confirmedId && UUID_PATTERN.test(confirmedId) ? confirmedId : mediaId, mediaType: asset.mediaType };
  }

  async submitGeneration(request: GenAiGenerationRequest, references: readonly HiggsfieldResolvedReference[], jobId: GenAiJobId): Promise<GenAiGenerationSubmission> {
    const capabilities = this.requireCapabilities();
    const video = request.kind === 'video' || request.workflowId.includes('video');
    requireHiggsfieldCapability(capabilities, video ? 'canGenerateVideo' : 'canGenerateImage');
    const mode = request.workflowId.split(':').at(-1) ?? (video ? 'text2video' : 'text2image');
    const workflow = this.workflows.get(`${request.modelId}:${mode}`) ?? await this.loadWorkflow(request.modelId, mode);
    const result = await this.connection.callTool(video ? 'generate_video' : 'generate_image', {
      params: buildHiggsfieldGenerationParams(request, workflow, references)
    });
    const providerJobId = extractHiggsfieldGenerationId(higgsfieldToolPayload(result as Parameters<typeof higgsfieldToolPayload>[0]));
    return { jobId, providerJobId, status: 'submitted' };
  }

  async waitForGeneration(providerJobId: string, expectedKind: 'image' | 'video', signal?: AbortSignal) {
    const capabilities = this.requireCapabilities();
    requireHiggsfieldCapability(capabilities, 'canPoll');
    const tool = capabilities.tools.get('job_status')!;
    let transientFailures = 0;
    for (let attempt = 0; attempt < 240; attempt += 1) {
      signal?.throwIfAborted();
      let payload: unknown;
      try {
        payload = higgsfieldToolPayload(await this.connection.callTool(tool.name,
          buildArguments(tool, { jobId: providerJobId })) as Parameters<typeof higgsfieldToolPayload>[0]);
        transientFailures = 0;
      } catch (reason) {
        signal?.throwIfAborted();
        transientFailures += 1;
        if (transientFailures >= 8) throw reason;
        await this.waitBeforePoll(attempt, signal);
        continue;
      }
      let completion = normalizeHiggsfieldCompletion(payload);
      if (completion.state === 'failed') throw new Error(completion.error ?? 'Higgsfield generation failed.');
      if (completion.state === 'cancelled') throw new Error('Higgsfield generation was cancelled.');
      if (completion.state === 'succeeded') {
        if (!completion.urls.length && 'raw_data' in (tool.inputSchema?.properties ?? {})) {
          const raw = higgsfieldToolPayload(await this.connection.callTool(tool.name,
            buildArguments(tool, { jobId: providerJobId, rawData: true })) as Parameters<typeof higgsfieldToolPayload>[0]);
          completion = normalizeHiggsfieldCompletion(raw);
        }
        if (!completion.urls.length) {
          const displayTool = capabilities.tools.get('job_display');
          if (displayTool) {
            const display = higgsfieldToolPayload(await this.connection.callTool(displayTool.name,
              buildArguments(displayTool, { jobId: providerJobId })) as Parameters<typeof higgsfieldToolPayload>[0]);
            completion = normalizeHiggsfieldCompletion(display);
          }
        }
        if (!completion.urls.length) throw new Error('Higgsfield completed without an output URL.');
        return { urls: completion.urls, mediaType: expectedKind === 'video' ? 'video/mp4' : 'image/png' };
      }
      await this.waitBeforePoll(attempt, signal);
    }
    throw new Error('Timed out while waiting for Higgsfield generation.');
  }

  private async loadModelPayload(modelId: GenAiModelId): Promise<unknown> {
    if (this.modelPayloads.has(modelId)) return this.modelPayloads.get(modelId);
    const capabilities = this.requireCapabilities();
    const tool = capabilities.tools.get('models_get') ?? capabilities.tools.get('models_explore');
    if (!tool) throw new Error('Higgsfield exposes no model detail capability.');
    const args = tool.name === 'models_get'
      ? buildArguments(tool, { modelId })
      : buildArguments(tool, { action: 'get', modelId });
    const payload = higgsfieldToolPayload(await this.connection.callTool(tool.name, args) as Parameters<typeof higgsfieldToolPayload>[0]);
    this.modelPayloads.set(modelId, payload);
    return payload;
  }
  private async waitBeforePoll(attempt: number, signal?: AbortSignal): Promise<void> {
    await abortableDelay(Math.min(8_000, 500 * 1.35 ** attempt), signal);
  }
  private async refreshCapabilities() {
    this.capabilities = classifyHiggsfieldContract(await this.connection.listTools());
    if (!this.capabilities.canDiscover) throw new Error('The connected Higgsfield MCP contract is incomplete or unsupported.');
  }
  private requireCapabilities() {
    if (!this.capabilities) throw new Error('Connect Higgsfield before using its capabilities.');
    return this.capabilities;
  }
  private publish(snapshot: GenAiProviderSnapshot) { this.snapshotValue = snapshot; for (const listener of this.listeners) listener(snapshot); }
}
