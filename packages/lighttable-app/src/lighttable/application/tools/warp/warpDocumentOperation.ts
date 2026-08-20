import { setRasterLayerAdjustmentStack } from '../../../editor/document/documentCommands';
import type { ImageDocument, RasterLayer } from '../../../editor/document/documentTypes';
import { findRasterLayer } from '../../../editor/document/layerTree';
import type { AdjustmentStack } from '../../../processing/adjustmentStack';
import {
  addWarpNodeToStack,
  createWarpModuleInstance,
  findWarpModuleInstance,
  readWarpNodeSettings,
  setWarpNodeSettings,
  type WarpStroke
} from '../../../effects/warp/warpTypes';

export interface WarpDocumentIdSource {
  createId(kind: 'stack' | 'module'): string;
}

const emptyStack = (ids: WarpDocumentIdSource): AdjustmentStack => ({
  id: ids.createId('stack'),
  revision: 0,
  modules: []
});

/** Applies one finished, layer-source Warp recipe without invoking interactive preview machinery. */
export const applyWarpStrokeToDocument = (
  document: ImageDocument,
  layerId: RasterLayer['id'],
  stroke: WarpStroke,
  ids: WarpDocumentIdSource
): ImageDocument => {
  const layer = findRasterLayer(document, layerId);
  if (!layer) throw new Error('The Warp target layer no longer exists.');
  let stack = layer.adjustmentStack ? structuredClone(layer.adjustmentStack) : emptyStack(ids);
  let instance = findWarpModuleInstance(stack);
  if (!instance) {
    instance = createWarpModuleInstance(ids.createId('module'));
    stack = addWarpNodeToStack(stack, instance);
  }
  const current = readWarpNodeSettings(findWarpModuleInstance(stack)!);
  const strokes = current.strokes.filter(({ id }) => id !== stroke.id);
  return setRasterLayerAdjustmentStack(document, layerId, setWarpNodeSettings(stack, {
    ...current,
    strokes: [...strokes, structuredClone(stroke)]
  }));
};
