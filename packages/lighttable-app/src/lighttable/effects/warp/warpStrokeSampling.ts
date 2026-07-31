import type { WarpBrushMode, WarpStroke } from './warpTypes';

export interface WarpGpuStamp {
  readonly centerPx: readonly [number, number];
  readonly deltaPx: readonly [number, number];
  readonly radiusPx: number;
  readonly strength: number;
  readonly hardness: number;
  readonly mode: WarpBrushMode;
}

const modeIndex = (mode: WarpBrushMode): number => ({
  push: 0,
  'twirl-cw': 1,
  'twirl-ccw': 2,
  pinch: 3,
  bloat: 4,
  smooth: 5,
  reconstruct: 6,
  freeze: 7,
  thaw: 8
})[mode];

const executableModes = new Set<WarpBrushMode>([
  'push',
  'twirl-cw',
  'twirl-ccw',
  'pinch',
  'bloat'
]);

const length = (x: number, y: number) => Math.hypot(x, y);

/**
 * Converts authored pointer samples into stable, distance-spaced GPU stamps.
 * Pointer event frequency therefore cannot change the visual result.
 */
export const createWarpGpuStamps = (
  strokes: readonly WarpStroke[],
  maximumStampCount = 16_384
): readonly WarpGpuStamp[] => {
  const stamps: WarpGpuStamp[] = [];
  for (const stroke of strokes) {
    if (!executableModes.has(stroke.mode)) {
      throw new Error(`Warp mode "${stroke.mode}" has no GPU executor yet.`);
    }
    const radiusPx = Math.max(0.5, stroke.settings.diameterPx * 0.5);
    const spacingPx = Math.max(0.5, stroke.settings.diameterPx * stroke.settings.spacing);
    for (const sample of stroke.samples) {
      const [dx, dy] = sample.deltaPx;
      const steps = Math.max(1, Math.ceil(length(dx, dy) / spacingPx));
      const pressure = Math.max(0, Math.min(1, sample.pressure));
      const pressureSize = stroke.settings.pressureSize ? pressure : 1;
      const pressureStrength = stroke.settings.pressureStrength ? pressure : 1;
      for (let step = 1; step <= steps; step += 1) {
        const t = step / steps;
        stamps.push({
          centerPx: [
            sample.positionPx[0] - dx * (1 - t),
            sample.positionPx[1] - dy * (1 - t)
          ],
          deltaPx: [dx / steps, dy / steps],
          radiusPx: radiusPx * pressureSize,
          strength: stroke.settings.strength * stroke.settings.flow * pressureStrength,
          hardness: stroke.settings.hardness,
          mode: stroke.mode
        });
        if (stamps.length > maximumStampCount) {
          throw new Error(`Warp stroke history exceeds ${maximumStampCount} GPU stamps.`);
        }
      }
    }
  }
  return stamps;
};

export const packWarpGpuStamps = (stamps: readonly WarpGpuStamp[]): Float32Array => {
  const packed = new Float32Array(stamps.length * 8);
  stamps.forEach((stamp, index) => {
    const offset = index * 8;
    packed.set([
      stamp.centerPx[0],
      stamp.centerPx[1],
      stamp.deltaPx[0],
      stamp.deltaPx[1],
      stamp.radiusPx,
      stamp.strength,
      stamp.hardness,
      modeIndex(stamp.mode)
    ], offset);
  });
  return packed;
};
