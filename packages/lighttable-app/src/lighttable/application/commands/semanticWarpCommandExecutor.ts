import type { ImageDocument } from '../../editor/document/documentTypes';
import { layerIsLocked } from '../../editor/document/documentTypes';
import { findRasterLayer } from '../../editor/document/layerTree';
import type { WarpStroke } from '../../effects/warp/warpTypes';
import { applyWarpStrokeToDocument } from '../tools/warp/warpDocumentOperation';
import type { SemanticWarpStrokeCommand } from './semanticWarpCommandContract';

export interface SemanticWarpCommandDependencies {
  getDocument(): ImageDocument | null;
  applyDocument(document: ImageDocument): void;
  recordHistory(before: ImageDocument, after: ImageDocument): void;
  createId(kind: 'stack' | 'module' | 'stroke'): string;
}

export const executeSemanticWarpStrokeCommand = (
  command: SemanticWarpStrokeCommand,
  dependencies: SemanticWarpCommandDependencies
): { readonly layerId: string; readonly strokeId: string; readonly sampleCount: number } | null => {
  const before = dependencies.getDocument();
  const layer = before ? findRasterLayer(before, command.layerId) : null;
  if (!before || !layer) throw new Error('The Warp target raster layer does not exist.');
  if (layerIsLocked(layer, 'pixels') || layerIsLocked(layer, 'position')) {
    throw new Error('Unlock the Warp target layer before editing it.');
  }
  const stroke: WarpStroke = {
    id: dependencies.createId('stroke'), mode: command.mode,
    settings: structuredClone(command.settings), samples: structuredClone(command.samples),
    startedAtMs: command.startedAtMs, durationMs: command.durationMs
  };
  const after = applyWarpStrokeToDocument(before, layer.id, stroke, dependencies);
  dependencies.applyDocument(after);
  dependencies.recordHistory(before, after);
  return { layerId: layer.id, strokeId: stroke.id, sampleCount: stroke.samples.length };
};
