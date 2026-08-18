import type {
  GenAiAssetId,
  GenAiCostEstimate,
  GenAiGenerationRequest,
  GenAiWorkflowDefinition
} from '@lighttable/genai-core';

export interface HiggsfieldResolvedReference {
  readonly assetId: GenAiAssetId;
  readonly providerAssetId?: string;
  readonly url?: string;
  readonly mediaType: string;
  readonly purpose?: string;
}

const object = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

const visit = (value: unknown, callback: (record: Record<string, unknown>) => void, depth = 0): void => {
  if (depth > 8 || value === null || value === undefined) return;
  if (typeof value === 'string') {
    const source = value.trim();
    if ((source.startsWith('{') && source.endsWith('}')) || (source.startsWith('[') && source.endsWith(']'))) {
      try { visit(JSON.parse(source), callback, depth + 1); } catch { /* not JSON */ }
    }
    return;
  }
  if (Array.isArray(value)) { for (const item of value) visit(item, callback, depth + 1); return; }
  const record = object(value);
  if (!record) return;
  callback(record);
  for (const nested of Object.values(record)) visit(nested, callback, depth + 1);
};

const ROLE_MAP: Readonly<Record<string, string>> = {
  visual_reference: 'image', style_reference: 'image', character_reference: 'image',
  composition_reference: 'image', base_image: 'image', first_frame: 'start_image',
  last_frame: 'end_image', source_video: 'video', source_audio: 'audio', element: 'element'
};

export const buildHiggsfieldGenerationParams = (
  request: GenAiGenerationRequest,
  workflow: GenAiWorkflowDefinition,
  references: readonly HiggsfieldResolvedReference[]
): Readonly<Record<string, unknown>> => {
  const params: Record<string, unknown> = {
    model: request.modelId,
    count: request.output?.count ?? 1,
    get_cost: false
  };
  const promptField = workflow.fields.find(({ role }) => role === 'prompt');
  params[promptField?.key ?? 'prompt'] = request.providerPrompt || request.prompt;
  for (const field of workflow.fields) {
    if (field.role === 'prompt' || field.role === 'references' || field.kind === 'asset') continue;
    if (request.fields[field.key] !== undefined) params[field.key] = request.fields[field.key];
  }
  if (references.length) params.medias = references.map((reference, index) => {
    const canonical = request.references.find(({ id }) => id === reference.assetId);
    const purpose = reference.purpose ?? canonical?.purpose ?? (request.workflowId.includes('frames2video')
      ? index === 0 ? 'first_frame' : 'last_frame' : 'visual_reference');
    const value = reference.providerAssetId ?? reference.url;
    if (!value) throw new Error(`Higgsfield reference ${reference.assetId} has no prepared transport identity.`);
    return { role: ROLE_MAP[purpose] ?? purpose, value };
  });
  return params;
};

export const extractHiggsfieldGenerationId = (payload: unknown): string => {
  const explicitCandidates = new Set<string>();
  const fallbackCandidates = new Set<string>();
  visit(payload, (record) => {
    for (const key of ['generation_id', 'generationId', 'job_id', 'jobId']) {
      const value = record[key];
      if (typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{5,255}$/u.test(value)) explicitCandidates.add(value);
    }
    for (const key of ['ids', 'generation_ids', 'generationIds']) {
      const value = record[key];
      if (Array.isArray(value)) for (const id of value) {
        if (typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{5,255}$/u.test(id)) explicitCandidates.add(id);
      }
    }
    const fallback = record.id;
    if (typeof fallback === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{5,255}$/u.test(fallback)) fallbackCandidates.add(fallback);
  });
  const candidates = explicitCandidates.size ? explicitCandidates : fallbackCandidates;
  if (candidates.size !== 1) {
    throw new Error(candidates.size
      ? 'Higgsfield returned multiple conflicting generation identifiers.'
      : 'Higgsfield returned no unambiguous generation identifier.');
  }
  return [...candidates][0]!;
};

export const normalizeHiggsfieldCost = (payload: unknown): GenAiCostEstimate | null => {
  let estimate: GenAiCostEstimate | null = null;
  visit(payload, (record) => {
    if (estimate) return;
    const amount = ['credits_exact', 'credits', 'amount', 'cost']
      .map((key) => record[key]).find((value): value is number => typeof value === 'number' && Number.isFinite(value));
    if (amount === undefined) return;
    const unit = typeof record.unit === 'string' ? record.unit : 'credits';
    estimate = { amount, unit, label: `${amount} ${unit}` };
  });
  return estimate;
};

export interface HiggsfieldCompletion {
  readonly state: 'running' | 'succeeded' | 'failed' | 'cancelled';
  readonly urls: readonly string[];
  readonly error?: string;
}

export const normalizeHiggsfieldCompletion = (payload: unknown): HiggsfieldCompletion => {
  let status = '';
  let error: string | undefined;
  const urls = new Set<string>();
  visit(payload, (record) => {
    if (!status) {
      const value = record.status ?? record.state;
      if (typeof value === 'string') status = value.toLocaleLowerCase('en-US');
    }
    if (!error) {
      const value = record.error_message ?? record.error ?? record.message;
      if (typeof value === 'string') error = value;
    }
    for (const key of ['resource_url', 'resourceUrl', 'output_url', 'outputUrl', 'url']) {
      const value = record[key];
      if (typeof value === 'string' && /^https:\/\//iu.test(value)) urls.add(value);
    }
  });
  if (['failed', 'error'].includes(status)) return { state: 'failed', urls: [], ...(error ? { error } : {}) };
  if (['cancelled', 'canceled'].includes(status)) return { state: 'cancelled', urls: [] };
  if (['completed', 'complete', 'succeeded', 'success', 'done', 'finished'].includes(status)
    || (!status && urls.size)) {
    return { state: 'succeeded', urls: [...urls] };
  }
  return { state: 'running', urls: [] };
};
