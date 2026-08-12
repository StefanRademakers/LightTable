import {
  normalizeGenAiJsonSchema,
  type GenAiCostEstimate,
  type GenAiFieldDefinition,
  type GenAiFieldRole,
  type GenAiModelId,
  type GenAiModelSummary,
  type GenAiProviderId,
  type GenAiWorkflowDefinition,
  type GenAiWorkflowId
} from '@lighttable/genai-core';
const OPENART_ID = 'openart';

const OPENART_FIELD_ROLES: Readonly<Record<string, GenAiFieldRole>> = {
  prompt: 'prompt',
  visualReferences: 'references',
  references: 'references',
  images: 'references',
  inputImages: 'references',
  aspectRatio: 'aspect-ratio',
  resolution: 'output-size',
  resolutionTier: 'output-size',
  quality: 'quality',
  imageCount: 'output-count'
};

const mapOpenArtFieldRoles = (fields: readonly GenAiFieldDefinition[]): readonly GenAiFieldDefinition[] =>
  fields.map((field) => {
    const role = OPENART_FIELD_ROLES[field.key];
    return role ? { ...field, role } : field;
  });

const object = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;

const parseJsonObjects = (value: unknown): unknown[] => {
  const results: unknown[] = [];
  const visit = (entry: unknown, depth = 0): void => {
    if (depth > 8 || entry === null || entry === undefined) return;
    if (typeof entry === 'string') {
      const source = entry.trim();
      if ((source.startsWith('{') && source.endsWith('}')) || (source.startsWith('[') && source.endsWith(']'))) {
        try { visit(JSON.parse(source), depth + 1); } catch { /* Provider text may not be JSON. */ }
      }
      return;
    }
    results.push(entry);
    if (Array.isArray(entry)) for (const item of entry) visit(item, depth + 1);
    else {
      const record = object(entry);
      if (record) for (const item of Object.values(record)) visit(item, depth + 1);
    }
  };
  visit(value);
  return results;
};

const findDefaults = (value: unknown): Record<string, unknown> => {
  for (const candidate of parseJsonObjects(value)) {
    const defaults = object(object(candidate)?.defaults);
    if (defaults) return defaults;
  }
  return {};
};

export const mcpToolPayload = (result: {
  readonly structuredContent?: unknown;
  readonly content?: readonly unknown[];
}): unknown => {
  if (result.structuredContent !== undefined) return result.structuredContent;
  for (const entry of result.content ?? []) {
    const item = object(entry);
    if (item?.type !== 'text' || typeof item.text !== 'string') continue;
    try { return JSON.parse(item.text); } catch { /* Continue to a later structured text block. */ }
  }
  throw new Error('OpenArt returned no machine-readable result.');
};

const modesOf = (candidate: Record<string, unknown>): readonly string[] => {
  if (Array.isArray(candidate.modes)) {
    return candidate.modes.filter((mode): mode is string => typeof mode === 'string');
  }
  const modes = object(candidate.modes);
  if (!modes) return [];
  return Object.values(modes).flatMap((value) => Array.isArray(value)
    ? value.map((entry) => object(entry)?.mode).filter((mode): mode is string => typeof mode === 'string')
    : []);
};

export const normalizeOpenArtModels = (payload: unknown): readonly GenAiModelSummary[] => {
  const root = object(payload);
  const nested = object(root?.result) ?? object(root?.data);
  const candidates = Array.isArray(payload)
    ? payload
    : Array.isArray(root?.models)
      ? root.models
      : Array.isArray(nested?.models)
        ? nested.models
        : [];
  return candidates.flatMap((raw) => {
    const model = object(raw);
    if (!model || typeof model.id !== 'string') return [];
    const modes = modesOf(model);
    return [{
      id: model.id as GenAiModelId,
      providerId: OPENART_ID as GenAiProviderId,
      label: typeof model.displayName === 'string' ? model.displayName : model.id,
      ...(typeof model.description === 'string' ? { description: model.description } : {}),
      capabilities: modes
    }];
  });
};

export const normalizeOpenArtWorkflow = (
  payload: unknown,
  requestedModel: string,
  requestedMode: string
): GenAiWorkflowDefinition => {
  let best: {
    readonly form: Record<string, unknown>;
    readonly fields: readonly GenAiFieldDefinition[];
  } | null = null;
  for (const candidate of parseJsonObjects(payload)) {
    const root = object(candidate);
    const envelope = object(root?.result) ?? object(root?.data) ?? root;
    const possibleForm = object(envelope?.form) ?? envelope;
    const possibleSchema = object(possibleForm?.schemaCore)
      ?? object(possibleForm?.jsonSchema)
      ?? object(possibleForm?.schema);
    if (!possibleForm || !possibleSchema) continue;
    const defaults = object(possibleForm.defaults) ?? findDefaults(payload);
    const fields = mapOpenArtFieldRoles(normalizeGenAiJsonSchema(possibleSchema, defaults));
    if (fields.length > (best?.fields.length ?? 0)) best = { form: possibleForm, fields };
  }
  if (!best?.fields.length) throw new Error('OpenArt returned a model form without usable fields.');
  const { form, fields } = best;
  const model = typeof form.model === 'string' ? form.model : requestedModel;
  const mode = typeof form.mode === 'string' ? form.mode : requestedMode;
  return {
    id: `${OPENART_ID}:${model}:${mode}` as GenAiWorkflowId,
    providerId: OPENART_ID as GenAiProviderId,
    modelId: model as GenAiModelId,
    label: mode === 'text2image' ? 'Text to image' : mode,
    mode,
    fields
  };
};

export const normalizeOpenArtCost = (payload: unknown): GenAiCostEstimate | null => {
  for (const candidate of parseJsonObjects(payload)) {
    const value = object(candidate);
    if (!value) continue;
    const amount = ['credits', 'cost', 'totalCredits', 'total_credits']
      .map((key) => value[key]).find((entry): entry is number => typeof entry === 'number' && Number.isFinite(entry));
    if (amount === undefined) continue;
    const unit = typeof value.unit === 'string' ? value.unit : 'credits';
    return { amount, unit, label: `${amount} ${unit}` };
  }
  return null;
};
