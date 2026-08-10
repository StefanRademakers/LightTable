import type { ImageDocument, LayerNode } from './documentTypes';
import { findLayerNode } from './layerTree';
import type { SampledBrushMode, SampledBrushSource } from '../tools/paint/sampledBrushTypes';

const branchAtPath = (
  nodes: readonly LayerNode[],
  path: readonly number[],
  depth: number,
  includeBelow: boolean
): LayerNode[] => {
  const index = path[depth];
  if (index === undefined || !nodes[index]) return [];
  const result = includeBelow ? nodes.slice(0, index) : [];
  const selected = nodes[index]!;
  if (depth === path.length - 1) {
    result.push(selected);
    return result;
  }
  if (selected.type !== 'group') return [];
  const children = branchAtPath(selected.children, path, depth + 1, includeBelow);
  result.push({ ...selected, children });
  return result;
};

/** Builds the compositor view requested by a sampled paint operation. */
export const sampledBrushSourceDocument = (
  document: ImageDocument,
  source: SampledBrushSource,
  mode: SampledBrushMode
): ImageDocument | null => {
  if (source.documentId !== document.id) return null;
  if (mode === 'all') return document;
  const entry = findLayerNode(document.layers, source.anchorLayerId);
  if (!entry) return null;
  const layers = branchAtPath(
    document.layers,
    entry.path,
    0,
    mode === 'current-and-below'
  );
  return layers.length ? {
    ...document,
    layers,
    activeLayerId: source.anchorLayerId
  } : null;
};
