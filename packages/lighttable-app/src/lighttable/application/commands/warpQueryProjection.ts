import type { LayerId, RasterLayer } from '../../editor/document/documentTypes';
import { findWarpModuleInstance, readWarpNodeSettings, type WarpStroke
} from '../../effects/warp/warpTypes';

export interface WarpQueryResult {
  readonly layerId: LayerId;
  readonly revision: number;
  readonly enabled: boolean;
  readonly totalStrokes: number;
  readonly totalSamples: number;
  readonly truncated: boolean;
  readonly settings: {
    readonly opacity: number;
    readonly borderMode: string;
    readonly topologyMode: string;
    readonly edgePinning: number;
    readonly maskLinkMode: string;
  };
  readonly strokes: readonly WarpStroke[];
}

/** Bounded editable Warp projection: at most 64 strokes and 8192 samples. */
export const projectWarpQuery = (layer: RasterLayer): WarpQueryResult | null => {
  const instance = findWarpModuleInstance(layer.adjustmentStack);
  if (!instance) return null;
  const settings = readWarpNodeSettings(instance);
  const strokes: WarpStroke[] = []; let samples = 0;
  for (const stroke of settings.strokes) {
    if (strokes.length >= 64 || samples + stroke.samples.length > 8192) break;
    strokes.push(structuredClone(stroke)); samples += stroke.samples.length;
  }
  const totalSamples = settings.strokes.reduce((sum, stroke) => sum + stroke.samples.length, 0);
  return {
    layerId: layer.id,
    revision: instance.revision,
    enabled: instance.enabled,
    totalStrokes: settings.strokes.length,
    totalSamples,
    truncated: strokes.length !== settings.strokes.length || samples !== totalSamples,
    settings: {
      opacity: settings.opacity, borderMode: settings.borderMode,
      topologyMode: settings.topologyMode, edgePinning: settings.edgePinning,
      maskLinkMode: settings.maskLinkMode
    },
    strokes
  };
};
