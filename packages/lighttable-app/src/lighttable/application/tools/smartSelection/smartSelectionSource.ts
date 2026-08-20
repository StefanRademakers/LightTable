import type { ImageDocument, LayerId } from '../../../editor/document/documentTypes';
import { walkLayerTree } from '../../../editor/document/layerTree';
import type { SmartSelectionSource } from './SmartSelectionBackend';

export interface SmartSelectionSourceRenderer {
  exportPng(options?: { excludedLayerIds?: readonly LayerId[] }): Promise<Blob>;
}

const isPathPrefix = (prefix: readonly number[], path: readonly number[]) =>
  prefix.length <= path.length && prefix.every((value, index) => path[index] === value);

/**
 * Keeps the active subtree and its transform-bearing ancestors. Everything
 * else is excluded from the one-off inference render without mutating layer
 * visibility or the editor document.
 */
export const smartSelectionExcludedLayerIds = (
  document: ImageDocument,
  sampleAllLayers: boolean,
  sourceLayerId: LayerId | null = document.activeLayerId
): readonly LayerId[] => {
  if (sampleAllLayers) return [];
  const entries = walkLayerTree(document.layers);
  const active = entries.find(({ node }) => node.id === sourceLayerId);
  if (!active) return entries.map(({ node }) => node.id);
  return entries
    .filter(({ path }) => !isPathPrefix(path, active.path) && !isPathPrefix(active.path, path))
    .map(({ node }) => node.id);
};

export const createSmartSelectionSource = async (
  document: ImageDocument,
  renderer: SmartSelectionSourceRenderer,
  sampleAllLayers: boolean,
  sourceLayerId: LayerId | null = document.activeLayerId
): Promise<SmartSelectionSource> => {
  const excludedLayerIds = smartSelectionExcludedLayerIds(document, sampleAllLayers, sourceLayerId);
  const image = await renderer.exportPng({ excludedLayerIds });
  return {
    key: [
      document.id,
      document.revision,
      sampleAllLayers ? 'composite' : sourceLayerId
    ].join(':'),
    documentRevision: document.revision,
    width: document.width,
    height: document.height,
    image
  };
};
