export interface LightTableStartupTimings {
  webGpuMs?: number;
  downloadMs?: number;
  layeredProbeMs?: number;
  sourceDecodeMs?: number;
  decodeAndUploadMs?: number;
  documentInitMs?: number;
  firstFrameMs?: number;
  scopesMs?: number;
}

const STARTUP_TIMING_LABELS: ReadonlyArray<
  readonly [keyof LightTableStartupTimings, string]
> = [
  ['webGpuMs', 'WebGPU'],
  ['downloadMs', 'download'],
  ['layeredProbeMs', 'document probe'],
  ['sourceDecodeMs', 'source decode'],
  ['decodeAndUploadMs', 'decode/upload'],
  ['documentInitMs', 'layers'],
  ['firstFrameMs', 'first frame'],
  ['scopesMs', 'deferred scopes']
];

export const formatStartupTimings = (
  timings: LightTableStartupTimings | null
): string => {
  if (!timings) return '';
  return STARTUP_TIMING_LABELS
    .filter(([key]) => timings[key] !== undefined)
    .map(([key, label]) => `${label}: ${Math.round(timings[key] ?? 0)} ms`)
    .join(' · ');
};

export const formatGpuMemory = (bytes: number): string => (
  bytes >= 1024 * 1024 * 1024
    ? `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
    : `${Math.round(bytes / (1024 * 1024))} MB`
);
