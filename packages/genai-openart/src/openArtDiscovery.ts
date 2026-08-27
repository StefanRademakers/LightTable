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
import { canonicalOpenArtMode } from './openArtModes';
const OPENART_ID = 'openart';

const OPENART_FIELD_ROLES: Readonly<Record<string, GenAiFieldRole>> = {
  prompt: 'prompt',
  text: 'prompt',
  description: 'prompt',
  negativePrompt: 'negative-prompt',
  negative_prompt: 'negative-prompt',
  visualReferences: 'references',
  references: 'references',
  images: 'references',
  inputImages: 'references',
  startFrame: 'first-frame',
  start_frame: 'first-frame',
  firstFrame: 'first-frame',
  first_frame: 'first-frame',
  endFrame: 'last-frame',
  end_frame: 'last-frame',
  lastFrame: 'last-frame',
  last_frame: 'last-frame',
  aspectRatio: 'aspect-ratio',
  aspect_ratio: 'aspect-ratio',
  resolution: 'output-size',
  resolutionTier: 'output-size',
  outputResolution: 'output-size',
  output_resolution: 'output-size',
  quality: 'quality',
  imageCount: 'output-count',
  videoCount: 'output-count',
  outputCount: 'output-count',
  output_count: 'output-count',
  duration: 'duration',
  durationSeconds: 'duration',
  duration_seconds: 'duration',
  generateAudio: 'sound',
  generate_audio: 'sound',
  generateSound: 'sound',
  sound: 'sound',
  seed: 'seed',
  width: 'width',
  height: 'height'
};

const mapOpenArtFieldRoles = (fields: readonly GenAiFieldDefinition[]): readonly GenAiFieldDefinition[] => {
  const mapped = fields.map((field) => {
    const role = OPENART_FIELD_ROLES[field.key];
    return role ? {
      ...field,
      role,
      ...((role === 'first-frame' || role === 'last-frame') ? { kind: 'asset' as const } : {})
    } : field;
  });
  const hasFrameSlots = mapped.some(({ role }) => role === 'first-frame' || role === 'last-frame');
  return hasFrameSlots
    ? mapped.map((field) => field.role === 'references' ? { ...field, required: false } : field)
    : mapped;
};

const object = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;

const mergeSchemas = (
  left: Readonly<Record<string, unknown>>,
  right: Readonly<Record<string, unknown>>
): Record<string, unknown> => ({
  ...left,
  ...right,
  properties: { ...(object(left.properties) ?? {}), ...(object(right.properties) ?? {}) },
  required: [...new Set([
    ...(Array.isArray(left.required) ? left.required.filter((key): key is string => typeof key === 'string') : []),
    ...(Array.isArray(right.required) ? right.required.filter((key): key is string => typeof key === 'string') : [])
  ])]
});

const resolveJsonPointer = (root: Readonly<Record<string, unknown>>, pointer: string): unknown => {
  if (!pointer.startsWith('#/')) return undefined;
  return pointer.slice(2).split('/').reduce<unknown>((current, segment) => object(current)?.[
    segment.replace(/~1/gu, '/').replace(/~0/gu, '~')
  ], root);
};

const dereferenceSchema = (
  value: unknown,
  root: Readonly<Record<string, unknown>>,
  seen: ReadonlySet<string> = new Set()
): Record<string, unknown> => {
  const source = object(value) ?? {};
  const reference = typeof source.$ref === 'string' ? source.$ref : undefined;
  let resolved = { ...source };
  if (reference && !seen.has(reference)) {
    resolved = mergeSchemas(
      dereferenceSchema(resolveJsonPointer(root, reference), root, new Set([...seen, reference])),
      Object.fromEntries(Object.entries(source).filter(([key]) => key !== '$ref'))
    );
  }
  const properties = object(resolved.properties);
  if (properties) resolved.properties = Object.fromEntries(
    Object.entries(properties).map(([key, field]) => [key, dereferenceSchema(field, root, seen)])
  );
  if (resolved.items) resolved.items = dereferenceSchema(resolved.items, root, seen);
  return resolved;
};

const branchScore = (schema: Readonly<Record<string, unknown>>, canonicalMode: string): number => {
  const properties = object(schema.properties) ?? {};
  const keys = new Set(Object.keys(properties));
  const creationMode = object(properties.creationMode)?.const;
  if (canonicalMode === 'frames2video') {
    return ['startFrame', 'start_frame', 'firstFrame', 'first_frame']
      .some((key) => keys.has(key)) ? 100 : -10;
  }
  if (canonicalMode === 'references2video') {
    return (['visualReferences', 'references', 'images', 'inputImages'].some((key) => keys.has(key)) ? 60 : 0)
      + (creationMode === 'element' ? 40 : 0);
  }
  if (canonicalMode === 'text2video') return creationMode === 'text' ? 100
    : [...keys].some((key) => /reference|frame|image/iu.test(key)) ? -20 : 20;
  return 0;
};

const normalizeOpenArtFormSchema = (schema: Record<string, unknown>, requestedMode: string) => {
  const canonicalMode = canonicalOpenArtMode(requestedMode);
  const visit = (value: unknown): Record<string, unknown> => {
    let resolved = dereferenceSchema(value, schema);
    const allOf = Array.isArray(resolved.allOf) ? resolved.allOf : [];
    delete resolved.allOf;
    for (const branch of allOf) resolved = mergeSchemas(resolved, visit(branch));
    for (const keyword of ['oneOf', 'anyOf'] as const) {
      const branches = Array.isArray(resolved[keyword]) ? resolved[keyword] : [];
      delete resolved[keyword];
      const selected = branches.map((branch) => dereferenceSchema(branch, schema))
        .sort((left, right) => branchScore(right, canonicalMode) - branchScore(left, canonicalMode))[0];
      if (selected) resolved = mergeSchemas(resolved, visit(selected));
    }
    return resolved;
  };
  return visit(schema);
};

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
    const modes = [...new Set(modesOf(model).map(canonicalOpenArtMode))];
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
    const fields = mapOpenArtFieldRoles(normalizeGenAiJsonSchema(
      normalizeOpenArtFormSchema(possibleSchema, requestedMode), defaults
    ));
    if (fields.length > (best?.fields.length ?? 0)) best = { form: possibleForm, fields };
  }
  if (!best?.fields.length) throw new Error('OpenArt returned a model form without usable fields.');
  const { form, fields } = best;
  const model = typeof form.model === 'string' ? form.model : requestedModel;
  const mode = canonicalOpenArtMode(typeof form.mode === 'string' ? form.mode : requestedMode);
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
