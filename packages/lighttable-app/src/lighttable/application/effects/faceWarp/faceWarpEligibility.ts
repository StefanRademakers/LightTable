import type { ImageDocument, LayerId, RasterLayer } from '../../../editor/document/documentTypes';
import { layerIsLocked } from '../../../editor/document/documentTypes';
import { findRasterLayer } from '../../../editor/document/layerTree';
import {
  findFaceWarpModuleInstance,
  readFaceWarpNodeSettings,
  type FaceWarpNodeSettings
} from '../../../effects/faceWarp/faceWarpTypes';

export type FaceWarpEligibility = {
  readonly ok: true;
  readonly layer: RasterLayer;
  readonly settings: FaceWarpNodeSettings;
} | {
  readonly ok: false;
  readonly reason: string;
};

/** Shared UI/Action/MCP admission against the exact pixels used for detection. */
export const resolveFaceWarpEligibility = (
  document: ImageDocument,
  layerId: LayerId
): FaceWarpEligibility => {
  const layer = findRasterLayer(document, layerId);
  if (!layer) return { ok: false, reason: 'Face Warp requires a pixel layer.' };
  if (layerIsLocked(layer)) return { ok: false, reason: 'Unlock the pixel layer before using Face Warp.' };
  const instance = findFaceWarpModuleInstance(layer.adjustmentStack);
  if (!instance) return { ok: false, reason: 'Detect and accept a face mesh before editing it.' };
  const settings = readFaceWarpNodeSettings(instance);
  if (settings.sourceRevision !== layer.pixelRevision) {
    return {
      ok: false,
      reason: 'The layer pixels changed after face detection. Detect faces again.'
    };
  }
  return { ok: true, layer, settings };
};
