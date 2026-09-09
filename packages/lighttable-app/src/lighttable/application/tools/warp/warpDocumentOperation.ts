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

export interface WarpDocumentRevisionTarget {
  readonly moduleId?: string;
  readonly moduleRevision?: number;
  readonly stackRevision?: number;
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
  ids: WarpDocumentIdSource,
  target: WarpDocumentRevisionTarget = {}
): ImageDocument => {
  const layer = findRasterLayer(document, layerId);
  if (!layer) throw new Error('The Warp target layer no longer exists.');
  let stack = layer.adjustmentStack ? structuredClone(layer.adjustmentStack) : emptyStack(ids);
  let instance = target.moduleId
    ? stack.modules.find(({ id }) => id === target.moduleId) ?? null
    : findWarpModuleInstance(stack);
  if (target.moduleId && instance?.type !== 'lt.warp') {
    throw new Error(`The Warp module ${target.moduleId} no longer exists.`);
  }
  if (!instance) {
    instance = createWarpModuleInstance(ids.createId('module'));
    stack = addWarpNodeToStack(stack, instance);
  }
  const current = readWarpNodeSettings(instance);
  const strokes = current.strokes.filter(({ id }) => id !== stroke.id);
  let nextStack = setWarpNodeSettings(stack, {
    ...current,
    strokes: [...strokes, structuredClone(stroke)]
  }, instance.id);
  if (target.moduleRevision !== undefined) {
    if (target.moduleRevision <= instance.revision) {
      throw new Error('Warp module revisions must increase monotonically.');
    }
    nextStack = {
      ...nextStack,
      modules: nextStack.modules.map((module) => module.id === instance!.id
        ? { ...module, revision: target.moduleRevision! }
        : module)
    };
  }
  if (target.stackRevision !== undefined) {
    if (target.stackRevision <= stack.revision) {
      throw new Error('Warp stack revisions must increase monotonically.');
    }
    nextStack = { ...nextStack, revision: target.stackRevision };
  }
  return setRasterLayerAdjustmentStack(document, layerId, nextStack);
};
