import type { ImageDocument, LayerId, LayerNode } from '../../editor/document/documentTypes';
import { projectLayerQuery, type LayerQuerySummary } from './layerQueryProjection';
import type { AdjustmentStack } from '../../processing/adjustmentStack';
import { buildLayerGeometryIndex } from '../geometry/layerGeometryQuery';

interface ModuleSummary {
  readonly id: string; readonly type: string; readonly enabled: boolean; readonly revision: number;
}
interface StackSummary {
  readonly id: string; readonly revision: number; readonly moduleCount: number;
  readonly truncated: boolean; readonly modules: readonly ModuleSummary[];
}

export type LayerContentSummary =
  | { readonly kind: 'raster'; readonly pixelRevision: number;
      readonly source: { readonly kind: 'imported-image'; readonly assetId: string }
        | { readonly kind: 'runtime-raster' };
      readonly dirtyBounds: { readonly x: number; readonly y: number;
        readonly width: number; readonly height: number } | null;
      readonly localAdjustments: StackSummary | null;
      readonly attachedAdjustmentCount: number; readonly attachedAdjustmentsTruncated: boolean;
      readonly attachedAdjustments: readonly { readonly id: string; readonly name: string;
        readonly adjustmentKind: string; readonly enabled: boolean; readonly revision: number }[] }
  | { readonly kind: 'group'; readonly compositing: 'pass-through' | 'isolated';
      readonly childCount: number }
  | { readonly kind: 'adjustment'; readonly adjustmentKind: string | null;
      readonly adjustments: StackSummary }
  | { readonly kind: 'vector'; readonly role: 'artwork' | 'gradient-fill';
      readonly elementCount: number; readonly pathCount: number; readonly liveShapeCount: number;
      readonly anchorCount: number }
  | { readonly kind: 'text'; readonly sourceKind: 'flow' | 'positioned';
      readonly editable: boolean; readonly textLength: number; readonly styleRunCount: number;
      readonly paragraphRunCount: number; readonly layoutMode: string | null };

export interface LayerDetailQueryCompleted {
  readonly status: 'completed'; readonly documentId: string; readonly canonicalRevision: number;
  readonly resolvedFrom: 'active-layer' | 'explicit-layer'; readonly layer: LayerQuerySummary;
  readonly content: LayerContentSummary;
  readonly availableQueries: readonly string[];
}
export interface LayerDetailQueryRejected {
  readonly status: 'rejected';
  readonly code: 'invalid-request' | 'document-not-found' | 'layer-not-found'
    | 'no-active-layer' | 'stale-document-revision';
  readonly message: string; readonly currentRevision?: number;
}
export type LayerDetailQueryResult = LayerDetailQueryCompleted | LayerDetailQueryRejected;

const record = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);
const stackSummary = (stack: AdjustmentStack): StackSummary => ({
  id: stack.id, revision: stack.revision, moduleCount: stack.modules.length,
  truncated: stack.modules.length > 128,
  modules: stack.modules.slice(0, 128).map(({ id, type, enabled, revision }) => (
    { id, type, enabled, revision }
  ))
});

const findEntry = (nodes: readonly LayerNode[], layerId: LayerId) => {
  const stack = [...nodes].reverse().map((node) => (
    { node, parentId: null as LayerId | null, depth: 0 }
  ));
  while (stack.length) {
    const entry = stack.pop()!;
    if (entry.node.id === layerId) return entry;
    if (entry.node.type === 'group') for (let index = entry.node.children.length - 1; index >= 0; index -= 1) {
      stack.push({ node: entry.node.children[index]!, parentId: entry.node.id, depth: entry.depth + 1 });
    }
  }
  return null;
};

const summarizeContent = (layer: LayerNode): LayerContentSummary => {
  if (layer.type === 'raster') return {
    kind: 'raster', pixelRevision: layer.pixelRevision,
    source: layer.pixelSource.kind === 'imported-image'
      ? { kind: 'imported-image', assetId: layer.pixelSource.assetId }
      : { kind: 'runtime-raster' },
    dirtyBounds: layer.dirtyBounds ? { ...layer.dirtyBounds } : null,
    localAdjustments: layer.adjustmentStack ? stackSummary(layer.adjustmentStack) : null,
    attachedAdjustmentCount: layer.attachedAdjustments?.length ?? 0,
    attachedAdjustmentsTruncated: (layer.attachedAdjustments?.length ?? 0) > 128,
    attachedAdjustments: (layer.attachedAdjustments ?? []).slice(0, 128).map((item) => ({
      id: item.id, name: item.name, adjustmentKind: item.adjustmentKind,
      enabled: item.enabled, revision: item.revision
    }))
  };
  if (layer.type === 'group') return { kind: 'group', compositing: layer.compositing,
    childCount: layer.children.length };
  if (layer.type === 'adjustment') return { kind: 'adjustment',
    adjustmentKind: layer.adjustmentKind, adjustments: stackSummary(layer.adjustmentStack) };
  if (layer.type === 'vector') {
    let pathCount = 0; let liveShapeCount = 0; let anchorCount = 0;
    for (const element of layer.elements) {
      if (element.type === 'path') {
        pathCount += 1;
        for (const subpath of element.subpaths) anchorCount += subpath.anchors.length;
      } else liveShapeCount += 1;
    }
    return { kind: 'vector', role: layer.role ?? 'artwork', elementCount: layer.elements.length,
      pathCount, liveShapeCount, anchorCount };
  }
  const source = layer.text.source;
  const text = source.kind === 'flow' ? source.text : source.extractedText ?? '';
  return { kind: 'text', sourceKind: source.kind, editable: source.kind === 'flow',
    textLength: text.length, styleRunCount: source.kind === 'flow' ? source.styleRuns.length : 0,
    paragraphRunCount: source.kind === 'flow' ? source.paragraphRuns.length : 0,
    layoutMode: source.kind === 'flow' ? source.layout.mode : null };
};

const availableQueries = (layer: LayerNode): string[] => {
  const result = ['layer.effects'];
  if (layer.type !== 'adjustment') result.push('layer.palette');
  if (layer.mask) result.push('layer.preview:mask');
  if (layer.type === 'raster') result.push('layer.preview:pixels', 'warp.query', 'grade.queryBasic', 'adjustment.query');
  if (layer.type === 'text') result.push('text.query', 'layer.preview:pixels');
  if (layer.type === 'vector') result.push('vector.query');
  if (layer.type === 'adjustment') result.push('adjustment.query');
  if (layer.type === 'adjustment' && layer.adjustmentKind === 'grade') result.push('grade.queryBasic');
  return result;
};

/** Compact type-dispatched inspection; full editable payloads remain behind targeted queries. */
export const projectLayerDetailQuery = (documentId: string, document: ImageDocument,
  canonicalRevision: number, value: unknown): LayerDetailQueryResult => {
  if (!record(value)) return { status: 'rejected', code: 'invalid-request',
    message: 'Layer query parameters must be an object.' };
  const expected = value.expectedDocumentRevision;
  if (expected !== undefined && (!Number.isSafeInteger(expected) || (expected as number) < 0)) {
    return { status: 'rejected', code: 'invalid-request',
      message: 'expectedDocumentRevision must be a non-negative safe integer.' };
  }
  if (expected !== undefined && expected !== canonicalRevision) return { status: 'rejected',
    code: 'stale-document-revision', message: 'The expected document revision is stale.',
    currentRevision: canonicalRevision };
  if (value.layerId !== undefined && (typeof value.layerId !== 'string' || !value.layerId)) {
    return { status: 'rejected', code: 'invalid-request', message: 'layerId must be a non-empty string.' };
  }
  const explicit = typeof value.layerId === 'string';
  const layerId = (explicit ? value.layerId : document.activeLayerId) as LayerId | null;
  if (!layerId) return { status: 'rejected', code: 'no-active-layer',
    message: 'The document has no active layer; provide an explicit layerId.' };
  const entry = findEntry(document.layers, layerId);
  if (!entry) return { status: 'rejected', code: 'layer-not-found',
    message: 'The requested layer does not exist.' };
  const geometry = buildLayerGeometryIndex(document).byLayerId.get(entry.node.id) ?? null;
  return { status: 'completed', documentId, canonicalRevision,
    resolvedFrom: explicit ? 'explicit-layer' : 'active-layer',
    layer: projectLayerQuery(entry.node, entry.parentId, entry.depth, {
      includeVectorElements: false,
      geometry
    }),
    content: summarizeContent(entry.node), availableQueries: availableQueries(entry.node) };
};
