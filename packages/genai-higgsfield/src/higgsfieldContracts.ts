export interface HiggsfieldToolDescription {
  readonly name: string;
  readonly inputSchema?: {
    readonly properties?: Readonly<Record<string, unknown>>;
    readonly required?: readonly string[];
  };
}

export type HiggsfieldContractFamily = 'native-v1' | 'catalog-v1' | 'unsupported';

export interface HiggsfieldCapabilities {
  readonly family: HiggsfieldContractFamily;
  readonly tools: ReadonlyMap<string, HiggsfieldToolDescription>;
  readonly canDiscover: boolean;
  readonly canGenerateImage: boolean;
  readonly canGenerateVideo: boolean;
  readonly canPublishBytes: boolean;
  readonly canPoll: boolean;
  readonly canEstimateImage: boolean;
  readonly canEstimateVideo: boolean;
  readonly fingerprint: string;
}

const asTools = (value: unknown): readonly HiggsfieldToolDescription[] => {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : null;
  const candidates = Array.isArray(value) ? value : Array.isArray(record?.tools) ? record.tools : [];
  return candidates.filter((tool): tool is HiggsfieldToolDescription => Boolean(
    tool && typeof tool === 'object' && typeof (tool as { name?: unknown }).name === 'string'
  ));
};

const stableHash = (source: string): string => {
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

export const classifyHiggsfieldContract = (catalog: unknown): HiggsfieldCapabilities => {
  const tools = new Map(asTools(catalog).map((tool) => [tool.name, tool]));
  const native = ['models_explore', 'generate_image', 'generate_video', 'media_upload', 'media_confirm', 'job_status']
    .every((name) => tools.has(name));
  const catalogFamily = ['models_list', 'models_get', 'generate_image', 'generate_video']
    .every((name) => tools.has(name));
  const family: HiggsfieldContractFamily = native ? 'native-v1' : catalogFamily ? 'catalog-v1' : 'unsupported';
  const shape = [...tools.values()].map((tool) => ({
    name: tool.name,
    fields: Object.keys(tool.inputSchema?.properties ?? {}).sort(),
    required: [...(tool.inputSchema?.required ?? [])].sort()
  })).sort((a, b) => a.name.localeCompare(b.name));
  return {
    family,
    tools,
    canDiscover: native || catalogFamily,
    canGenerateImage: tools.has('generate_image') && (tools.has('job_status') || tools.has('show_generations')),
    canGenerateVideo: tools.has('generate_video') && (tools.has('job_status') || tools.has('show_generations')),
    canPublishBytes: tools.has('media_upload') && tools.has('media_confirm'),
    canPoll: tools.has('job_status'),
    canEstimateImage: tools.has('estimate_image_cost'),
    canEstimateVideo: tools.has('estimate_video_cost'),
    fingerprint: `higgsfield:${family}:${stableHash(JSON.stringify(shape))}`
  };
};

export const requireHiggsfieldCapability = (
  capabilities: HiggsfieldCapabilities,
  capability: keyof Pick<HiggsfieldCapabilities, 'canDiscover' | 'canGenerateImage' | 'canGenerateVideo' | 'canPublishBytes' | 'canPoll'>
): void => {
  if (!capabilities[capability]) {
    throw new Error(`The connected Higgsfield contract does not safely support ${capability}.`);
  }
};
