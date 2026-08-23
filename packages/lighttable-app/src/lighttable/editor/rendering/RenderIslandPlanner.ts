import type { LayerId, LayerNode, VectorLayer } from '../document/documentTypes';
import { layerStyleStackIsActive } from '../styles/layerStyleDefaults';

export type RenderIslandRole = 'direct-vector-run' | 'isolated-vector-group';

export type RenderIslandBoundaryReason =
  | 'adjustment'
  | 'clipping-chain'
  | 'derived-preview'
  | 'group-isolation'
  | 'layer-effects'
  | 'layer-mask'
  | 'layer-opacity'
  | 'non-normal-blend'
  | 'raster-interleave'
  | 'text-interleave';

export interface RenderIslandComplexity {
  readonly canonicalLayerCount: number;
  readonly vectorElementCount: number;
}

export interface RenderIslandBackendEligibility {
  /** Native remains the exact compatibility fallback for canonical vectors. */
  readonly native: true;
  /** Inverted vector clips are not yet supported by the retained Vello projection. */
  readonly vello: boolean;
}

/**
 * A render island is a projection over canonical layers, never a document edit.
 * `candidateKey` describes membership; the future runtime reconciler owns the
 * persistent resource ID so a planner split/merge does not rewrite document IDs.
 */
export interface RenderIslandPlanEntry {
  readonly candidateKey: string;
  readonly anchorLayerId: LayerId;
  readonly role: RenderIslandRole;
  readonly canonicalLayerIds: readonly LayerId[];
  readonly scopePath: readonly LayerId[];
  readonly isolationOwnerId: LayerId | null;
  readonly backendEligibility: RenderIslandBackendEligibility;
  readonly complexity: RenderIslandComplexity;
  readonly boundaryReasons: readonly RenderIslandBoundaryReason[];
}

export interface RenderIslandPlan {
  readonly islands: readonly RenderIslandPlanEntry[];
  readonly canonicalVectorLayerCount: number;
  readonly projectedSurfaceCount: number;
}

interface VectorToken {
  readonly kind: 'vector';
  readonly layer: VectorLayer;
  readonly scopePath: readonly LayerId[];
}

interface ForcedIslandToken {
  readonly kind: 'forced-island';
  readonly layers: readonly VectorLayer[];
  readonly scopePath: readonly LayerId[];
  readonly isolationOwnerId: LayerId;
  readonly reasons: readonly RenderIslandBoundaryReason[];
}

interface BarrierToken {
  readonly kind: 'barrier';
  readonly reason: RenderIslandBoundaryReason;
}

type IslandToken = VectorToken | ForcedIslandToken | BarrierToken;

const vectorBoundaryReasons = (layer: VectorLayer): readonly RenderIslandBoundaryReason[] => {
  const reasons: RenderIslandBoundaryReason[] = [];
  if (layer.clipping) reasons.push('clipping-chain');
  if (layer.opacity < 0.99999 || layer.fillOpacity < 0.99999) reasons.push('layer-opacity');
  if (layer.blendMode !== 'normal') reasons.push('non-normal-blend');
  if (layer.mask?.enabled) reasons.push('layer-mask');
  if (layerStyleStackIsActive(layer.styleStack)) reasons.push('layer-effects');
  if (layer.derivedPreview) reasons.push('derived-preview');
  return reasons;
};

const groupBoundaryReasons = (
  group: Extract<LayerNode, { type: 'group' }>
): readonly RenderIslandBoundaryReason[] => {
  const reasons: RenderIslandBoundaryReason[] = [];
  if (group.opacity < 0.99999) reasons.push('group-isolation');
  if (group.clipping) reasons.push('clipping-chain');
  if (group.blendMode !== 'normal') reasons.push('non-normal-blend');
  if (group.mask?.enabled) reasons.push('layer-mask');
  if (layerStyleStackIsActive(group.styleStack)) reasons.push('layer-effects');
  if (group.derivedPreview) reasons.push('derived-preview');
  return reasons;
};

const collectPureVectorLayers = (nodes: readonly LayerNode[]): VectorLayer[] | null => {
  const result: VectorLayer[] = [];
  for (const node of nodes) {
    if (node.type === 'vector') {
      // Nested layer isolation still needs its own boundary with today's
      // PaintScene contract; do not hide it inside a group-wide island.
      if (vectorBoundaryReasons(node).length > 0) return null;
      result.push(node);
      continue;
    }
    if (node.type !== 'group' || groupBoundaryReasons(node).length > 0) return null;
    const children = collectPureVectorLayers(node.children);
    if (!children) return null;
    result.push(...children);
  }
  return result;
};

const tokenize = (
  nodes: readonly LayerNode[],
  scopePath: readonly LayerId[],
  output: IslandToken[]
) => {
  for (const node of nodes) {
    if (node.type === 'vector') {
      const reasons = vectorBoundaryReasons(node);
      if (reasons.length === 0) {
        output.push({ kind: 'vector', layer: node, scopePath });
      } else {
        output.push({ kind: 'barrier', reason: reasons[0] });
        output.push({
          kind: 'forced-island', layers: [node], scopePath,
          isolationOwnerId: node.id, reasons
        });
        output.push({ kind: 'barrier', reason: reasons[0] });
      }
      continue;
    }
    if (node.type === 'group') {
      const childScope = [...scopePath, node.id];
      const vectorChildren = collectPureVectorLayers(node.children);
      const reasons = [
        ...groupBoundaryReasons(node),
        // Normal source-over is associative. An opacity-1 isolated group made
        // solely from otherwise direct vector content is not an observable
        // compositing boundary. Isolation becomes real when descendants need
        // scoped blend/processing semantics.
        ...(node.compositing === 'isolated' && !vectorChildren
          ? ['group-isolation' as const]
          : [])
      ];
      if (reasons.length === 0) {
        tokenize(node.children, childScope, output);
        continue;
      }
      output.push({ kind: 'barrier', reason: reasons[0] });
      if (vectorChildren?.length) {
        output.push({
          kind: 'forced-island', layers: vectorChildren, scopePath: childScope,
          isolationOwnerId: node.id, reasons
        });
      } else {
        tokenize(node.children, childScope, output);
      }
      output.push({ kind: 'barrier', reason: reasons[0] });
      continue;
    }
    output.push({
      kind: 'barrier',
      reason: node.type === 'raster'
        ? 'raster-interleave'
        : node.type === 'text'
          ? 'text-interleave'
          : 'adjustment'
    });
  }
};

const entry = (
  layers: readonly VectorLayer[],
  role: RenderIslandRole,
  scopePath: readonly LayerId[],
  isolationOwnerId: LayerId | null,
  reasons: readonly RenderIslandBoundaryReason[]
): RenderIslandPlanEntry => {
  const canonicalLayerIds = layers.map(({ id }) => id);
  return {
    candidateKey: [role, ...scopePath, ...canonicalLayerIds].join(':'),
    anchorLayerId: layers[0].id,
    role,
    canonicalLayerIds,
    scopePath,
    isolationOwnerId,
    backendEligibility: {
      native: true,
      vello: layers.every(layer => !layer.vectorClip?.inverted)
    },
    complexity: {
      canonicalLayerCount: layers.length,
      vectorElementCount: layers.reduce((count, layer) => count + layer.elements.length, 0)
    },
    boundaryReasons: [...new Set(reasons)]
  };
};

/**
 * Plans only semantic vector render islands. Visibility is deliberately absent:
 * hiding a layer changes participation, not retained island ownership.
 */
export const planRenderIslands = (nodes: readonly LayerNode[]): RenderIslandPlan => {
  const tokens: IslandToken[] = [];
  tokenize(nodes, [], tokens);
  const islands: RenderIslandPlanEntry[] = [];
  let run: VectorToken[] = [];
  const flush = (boundaryReasons: readonly RenderIslandBoundaryReason[] = []) => {
    if (run.length === 0) return;
    islands.push(entry(
      run.map(({ layer }) => layer),
      'direct-vector-run',
      run[0].scopePath,
      null,
      boundaryReasons
    ));
    run = [];
  };
  let pendingReasons: RenderIslandBoundaryReason[] = [];
  for (const token of tokens) {
    if (token.kind === 'barrier') {
      flush([...pendingReasons, token.reason]);
      pendingReasons = [token.reason];
      continue;
    }
    if (token.kind === 'forced-island') {
      flush(pendingReasons);
      islands.push(entry(
        token.layers, 'isolated-vector-group', token.scopePath,
        token.isolationOwnerId, token.reasons
      ));
      pendingReasons = [...token.reasons];
      continue;
    }
    // Pass-through groups do not create a true compositing boundary. Scope is
    // metadata only, so compatible runs may span them.
    run.push(token);
  }
  flush(pendingReasons);
  return {
    islands,
    canonicalVectorLayerCount: islands.reduce(
      (count, island) => count + island.canonicalLayerIds.length, 0
    ),
    projectedSurfaceCount: islands.length
  };
};
