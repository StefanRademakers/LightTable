import type { LayerId } from '../../editor/document/documentTypes';
import type { WarpBrushMode, WarpBrushSettingsSnapshot, WarpInputSample,
  WarpStroke } from '../../effects/warp/warpTypes';

export interface SemanticWarpStrokeCommand {
  readonly layerId: LayerId;
  readonly mode: WarpBrushMode;
  readonly settings: WarpBrushSettingsSnapshot;
  readonly samples: readonly WarpInputSample[];
  readonly startedAtMs: number;
  readonly durationMs: number;
}

const MODES = new Set<WarpBrushMode>([
  'push', 'twirl-cw', 'twirl-ccw', 'pinch', 'bloat', 'smooth',
  'reconstruct', 'freeze', 'thaw'
]);
const record = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);
const finite = (value: unknown, min: number, max: number): value is number => (
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
);
const pair = (value: unknown, min: number, max: number): value is readonly [number, number] => (
  Array.isArray(value) && value.length === 2
  && finite(value[0], min, max) && finite(value[1], min, max)
);
const validSettings = (value: unknown): value is WarpBrushSettingsSnapshot => record(value)
  && finite(value.diameterPx, 1, 2000)
  && finite(value.strength, 0.01, 2) && finite(value.hardness, 0, 1)
  && finite(value.flow, 0.01, 1) && finite(value.spacing, 0.01, 1)
  && finite(value.smooth, 0, 2)
  && typeof value.pressureSize === 'boolean'
  && typeof value.pressureStrength === 'boolean';
const validSample = (value: unknown): value is WarpInputSample => record(value)
  && pair(value.positionPx, -10_000_000, 10_000_000)
  && pair(value.deltaPx, -10_000_000, 10_000_000)
  && finite(value.pressure, 0, 1) && pair(value.tilt, -90, 90)
  && finite(value.timeMs, 0, Number.MAX_SAFE_INTEGER);

export const parseSemanticWarpStrokeCommand = (
  value: unknown
): SemanticWarpStrokeCommand | { readonly message: string } => {
  if (!record(value) || typeof value.layerId !== 'string' || !value.layerId
    || !MODES.has(value.mode as WarpBrushMode) || !validSettings(value.settings)
    || !Array.isArray(value.samples) || value.samples.length < 1 || value.samples.length > 4096
    || !value.samples.every(validSample)
    || !finite(value.startedAtMs, 0, Number.MAX_SAFE_INTEGER)
    || !finite(value.durationMs, 0, 3_600_000)) {
    return { message: 'Warp stroke requires a target, valid mode/settings and 1-4096 bounded layer-source samples.' };
  }
  let bytes = Number.POSITIVE_INFINITY;
  try { bytes = new TextEncoder().encode(JSON.stringify(value)).byteLength; } catch { /* rejected below */ }
  if (bytes > 240 * 1024) return { message: 'Warp stroke exceeds the 240 KiB Actions boundary.' };
  return structuredClone(value) as unknown as SemanticWarpStrokeCommand;
};

export const semanticWarpStrokeFromCommitted = (
  layerId: LayerId,
  stroke: WarpStroke
): SemanticWarpStrokeCommand => ({
  layerId,
  mode: stroke.mode,
  settings: structuredClone(stroke.settings),
  samples: structuredClone(stroke.samples),
  startedAtMs: stroke.startedAtMs,
  durationMs: stroke.durationMs
});
