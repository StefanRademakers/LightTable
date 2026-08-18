import type {
  GenAiFieldDefinition,
  GenAiFieldKind,
  GenAiFieldRole,
  GenAiModelId,
  GenAiModelSummary,
  GenAiProviderId,
  GenAiWorkflowDefinition,
  GenAiWorkflowId
} from '@lighttable/genai-core';

const PROVIDER = 'higgsfield' as GenAiProviderId;
const object = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

export const higgsfieldToolPayload = (result: {
  readonly structuredContent?: unknown;
  readonly content?: readonly unknown[];
}): unknown => {
  if (result.structuredContent !== undefined) return result.structuredContent;
  for (const entry of result.content ?? []) {
    const item = object(entry);
    if (item?.type !== 'text' || typeof item.text !== 'string') continue;
    try { return JSON.parse(item.text); } catch { /* inspect the next structured block */ }
  }
  throw new Error('Higgsfield returned no machine-readable result.');
};

const collectRecords = (payload: unknown): readonly Record<string, unknown>[] => {
  const root = object(payload);
  const nested = object(root?.result) ?? object(root?.data);
  const values = Array.isArray(payload) ? payload
    : Array.isArray(root?.items) ? root.items
      : Array.isArray(root?.models) ? root.models
        : Array.isArray(nested?.items) ? nested.items
          : Array.isArray(nested?.models) ? nested.models : [];
  return values.map(object).filter((entry): entry is Record<string, unknown> => Boolean(entry));
};

const outputType = (model: Record<string, unknown>): string => String(
  model.output_type ?? model.outputType ?? model.type ?? ''
).toLocaleLowerCase('en-US');

const modelModes = (model: Record<string, unknown>): readonly string[] => {
  const type = outputType(model);
  const medias = Array.isArray(model.medias) ? model.medias.map(object).filter(Boolean) : [];
  const roles = medias.flatMap((media) => Array.isArray(media?.roles) ? media.roles : [])
    .filter((role): role is string => typeof role === 'string');
  if (type === 'video') {
    const modes = ['text2video'];
    if (roles.length) modes.push(roles.some((role) => role.includes('start') || role.includes('end')) ? 'frames2video' : 'references2video');
    return modes;
  }
  if (type === 'image') return roles.length ? ['text2image', 'image2image'] : ['text2image'];
  return [];
};

export const normalizeHiggsfieldModels = (payload: unknown): readonly GenAiModelSummary[] =>
  collectRecords(payload).flatMap((model) => {
    const id = model.id ?? model.model_id ?? model.modelId;
    const modes = modelModes(model);
    if (typeof id !== 'string' || !id || !modes.length) return [];
    return [{
      id: id as GenAiModelId,
      providerId: PROVIDER,
      label: typeof model.name === 'string' ? model.name
        : typeof model.displayName === 'string' ? model.displayName : id,
      ...(typeof model.description === 'string' ? { description: model.description } : {}),
      capabilities: modes
    }];
  });

const FIELD_ROLES: Readonly<Record<string, GenAiFieldRole>> = {
  prompt: 'prompt', aspect_ratio: 'aspect-ratio', aspectRatio: 'aspect-ratio',
  resolution: 'output-size', quality: 'quality', count: 'output-count',
  duration: 'duration', duration_seconds: 'duration', generate_audio: 'sound', sound: 'sound',
  input_variant: 'input-variant', start_image: 'first-frame', first_frame: 'first-frame',
  end_image: 'last-frame', last_frame: 'last-frame', video: 'source-video', audio: 'source-audio'
};

const kindOf = (parameter: Record<string, unknown>): GenAiFieldKind => {
  const type = String(parameter.type ?? parameter.kind ?? '').toLocaleLowerCase('en-US');
  if (['bool', 'boolean'].includes(type)) return 'boolean';
  if (['int', 'integer'].includes(type)) return 'integer';
  if (['float', 'double', 'number'].includes(type)) return 'number';
  if (Array.isArray(parameter.options) || Array.isArray(parameter.enum)) return 'enum';
  return 'string';
};

const optionsOf = (parameter: Record<string, unknown>) => {
  const options = Array.isArray(parameter.options) ? parameter.options
    : Array.isArray(parameter.enum) ? parameter.enum : [];
  return options.flatMap((entry) => {
    if (typeof entry === 'string' || typeof entry === 'number') {
      return [{ value: String(entry), label: String(entry) }];
    }
    const item = object(entry);
    const value = item?.value ?? item?.id;
    return typeof value === 'string'
      ? [{ value, label: typeof item?.label === 'string' ? item.label : value }] : [];
  });
};

const fieldOf = (parameter: Record<string, unknown>): GenAiFieldDefinition | null => {
  const key = parameter.name ?? parameter.key ?? parameter.id;
  if (typeof key !== 'string' || !key) return null;
  const kind = kindOf(parameter);
  const options = optionsOf(parameter);
  const minimum = parameter.min ?? parameter.minimum;
  const maximum = parameter.max ?? parameter.maximum;
  return {
    key,
    ...(FIELD_ROLES[key] ? { role: FIELD_ROLES[key] } : {}),
    label: typeof parameter.label === 'string' ? parameter.label
      : key.replaceAll('_', ' ').replace(/^./u, (letter) => letter.toUpperCase()),
    kind: options.length ? 'enum' : kind,
    required: parameter.required === true || parameter.required === 'required',
    advanced: parameter.advanced === true,
    ...(typeof parameter.description === 'string' ? { description: parameter.description } : {}),
    ...(parameter.default !== undefined ? { defaultValue: parameter.default } : {}),
    ...(typeof minimum === 'number' ? { minimum } : {}),
    ...(typeof maximum === 'number' ? { maximum } : {}),
    ...(typeof parameter.step === 'number' ? { step: parameter.step } : {}),
    ...(options.length ? { options } : {}),
    sourceSchema: { ...parameter }
  };
};

const unwrapModel = (payload: unknown): Record<string, unknown> => {
  const root = object(payload);
  const nested = object(root?.result) ?? object(root?.data) ?? object(root?.model);
  if (nested && typeof (nested.id ?? nested.model_id) === 'string') return nested;
  if (root && typeof (root.id ?? root.model_id) === 'string') return root;
  const candidates = collectRecords(payload);
  if (candidates.length === 1) return candidates[0]!;
  throw new Error('Higgsfield returned no unambiguous model schema.');
};

export const normalizeHiggsfieldWorkflow = (
  payload: unknown,
  requestedModelId: string,
  requestedMode: string
): GenAiWorkflowDefinition => {
  const model = unwrapModel(payload);
  const modelId = String(model.id ?? model.model_id ?? requestedModelId);
  const parameters = Array.isArray(model.parameters) ? model.parameters.map(object).filter(Boolean) : [];
  const fields = parameters.map((parameter) => fieldOf(parameter!)).filter((field): field is GenAiFieldDefinition => Boolean(field));
  if (!fields.some(({ role }) => role === 'prompt')) fields.unshift({
    key: 'prompt', role: 'prompt', label: 'Prompt', kind: 'string', required: true,
    advanced: false, sourceSchema: { type: 'string' }
  });
  const ratios = Array.isArray(model.aspect_ratios) ? model.aspect_ratios
    : Array.isArray(model.aspectRatios) ? model.aspectRatios : [];
  if (ratios.length && !fields.some(({ role }) => role === 'aspect-ratio')) fields.push({
    key: 'aspect_ratio', role: 'aspect-ratio', label: 'Aspect ratio', kind: 'enum', required: false,
    advanced: false, defaultValue: ratios[0],
    options: ratios.filter((value): value is string => typeof value === 'string').map((value) => ({ value, label: value })),
    sourceSchema: { enum: ratios }
  });
  const medias = Array.isArray(model.medias) ? model.medias : [];
  if (medias.length) fields.push({
    key: 'references', role: 'references', label: requestedMode.includes('frame') ? 'Frames' : 'References',
    kind: 'asset', required: false, advanced: false,
    sourceSchema: { type: 'array', medias }
  });
  return {
    id: `higgsfield:${modelId}:${requestedMode}` as GenAiWorkflowId,
    providerId: PROVIDER,
    modelId: modelId as GenAiModelId,
    label: requestedMode,
    mode: requestedMode,
    fields,
    sourceVersion: typeof model.updated_at === 'string' ? model.updated_at : undefined
  };
};
