interface GeneratedNormalizerModule {
  default: (input?: { module_or_path?: RequestInfo | URL | Response | BufferSource | WebAssembly.Module }) => Promise<unknown>;
  normalize_svg(
    source: string,
    maxInputBytes: number,
    maxOutputBytes: number,
    maxElements: number,
    maxDepth: number
  ): string;
  normalizer_version(): string;
}

export interface SvgNormalizationLimits {
  readonly maxInputBytes: number;
  readonly maxOutputBytes: number;
  readonly maxElements: number;
  readonly maxDepth: number;
}

export interface NormalizedSvgResult {
  readonly svg: string;
  readonly inputBytes: number;
  readonly outputBytes: number;
  readonly elementCount: number;
  readonly maxDepth: number;
  readonly normalizerVersion: string;
}

export const DEFAULT_SVG_NORMALIZATION_LIMITS: SvgNormalizationLimits = Object.freeze({
  maxInputBytes: 16 * 1024 * 1024,
  maxOutputBytes: 32 * 1024 * 1024,
  maxElements: 250_000,
  maxDepth: 256
});

let runtime: GeneratedNormalizerModule | null = null;
let pending: Promise<GeneratedNormalizerModule> | null = null;

const requestRuntime = async (): Promise<GeneratedNormalizerModule> => {
  if (runtime) return runtime;
  pending ??= import('./generated/vector_svg_normalizer_wasm.js')
    .then(async (generated) => {
      const module = generated as GeneratedNormalizerModule;
      await module.default();
      runtime = module;
      return module;
    })
    .finally(() => {
      pending = null;
    });
  return pending;
};

export const normalizeSvg = async (
  source: string,
  limits: SvgNormalizationLimits = DEFAULT_SVG_NORMALIZATION_LIMITS
): Promise<NormalizedSvgResult> => {
  const module = await requestRuntime();
  return JSON.parse(module.normalize_svg(
    source,
    limits.maxInputBytes,
    limits.maxOutputBytes,
    limits.maxElements,
    limits.maxDepth
  )) as NormalizedSvgResult;
};

export const svgNormalizerVersion = async (): Promise<string> =>
  (await requestRuntime()).normalizer_version();

