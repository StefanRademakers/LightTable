import type { ImageDocument, LayerId } from '../../editor/document/documentTypes';
import { layerIsLocked } from '../../editor/document/documentTypes';
import { findRasterLayer } from '../../editor/document/layerTree';
import { findWarpModuleInstance, type WarpStroke } from '../../effects/warp/warpTypes';
import { applyWarpStrokeToDocument } from '../tools/warp/warpDocumentOperation';
import type { SemanticWarpStrokeCommand } from './semanticWarpCommandContract';
import type { DocumentMutationController } from '../documents/useDocumentMutationController';

export interface SemanticWarpCommandDependencies {
  getDocument(): ImageDocument | null;
  changeDocument: DocumentMutationController['change'];
  createId(kind: 'stack' | 'module' | 'stroke'): string;
}

export const executeSemanticWarpStrokeCommand = (
  command: SemanticWarpStrokeCommand,
  dependencies: SemanticWarpCommandDependencies
): { readonly layerId: string; readonly strokeId: string; readonly sampleCount: number } | null => {
  const openingDocument = dependencies.getDocument();
  if (!openingDocument) throw new Error('The Warp target document does not exist.');
  const stroke: WarpStroke = {
    id: dependencies.createId('stroke'), mode: command.mode,
    settings: structuredClone(command.settings), samples: structuredClone(command.samples),
    startedAtMs: command.startedAtMs, durationMs: command.durationMs
  };
  let result: { readonly layerId: string; readonly strokeId: string; readonly sampleCount: number } | null = null;
  const changed = dependencies.changeDocument((before) => {
    if (before !== openingDocument) return before;
    const layer = findRasterLayer(before, command.layerId);
    if (!layer) throw new Error('The Warp target raster layer does not exist.');
    if (layerIsLocked(layer, 'pixels') || layerIsLocked(layer, 'position')) {
      throw new Error('Unlock the Warp target layer before editing it.');
    }
    const after = applyWarpStrokeToDocument(before, layer.id, stroke, dependencies);
    const terminalModule = findWarpModuleInstance(
      findRasterLayer(after, layer.id)?.adjustmentStack
    );
    if (!terminalModule) throw new Error('The Warp terminal recipe is missing.');
    result = { layerId: layer.id, strokeId: stroke.id, sampleCount: stroke.samples.length };
    return after;
  }, true, {
    label: 'Warp layer', type: 'layer.warp', layerIds: [command.layerId as LayerId]
  });
  return changed ? result : null;
};
