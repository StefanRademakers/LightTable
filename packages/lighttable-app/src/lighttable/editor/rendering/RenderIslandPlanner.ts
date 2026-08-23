import type { LayerId, LayerNode, VectorLayer } from '../document/documentTypes';
import { layerStyleStackIsActive } from '../styles/layerStyleDefaults';
import {
  identityAffineMatrix,
  multiplyMatrices,
  type AffineMatrix
} from '@lighttable/vector-core';

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
  | 'text-interleave'
  | 'interaction-preview';

export interface RenderIslandPlanningOptions {
  /** Vector layers rendered through a transient compositor-owned preview. */
  readonly transientVectorBarriers?: ReadonlySet<LayerId>;
}

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

export type RenderIslandCompositionNode =
  | { readonly kind: 'member'; readonly layerId: LayerId }
  | {
    readonly kind: 'opacity-group';
    readonly stableId: LayerId;
    readonly opacity: number;
    readonly children: readonly RenderIslandCompositionNode[];
  };

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
  readonly members: readonly {
    readonly layer: VectorLayer;
    readonly layerToDocument: AffineMatrix;
    readonly participates: boolean;
  }[];
  /** Backend-neutral ordering/isolation over the independently editable members. */
  readonly composition: readonly RenderIslandCompositionNode[];
  readonly scopePath: readonly LayerId[];
  readonly isolationOwnerId: LayerId | null;
  readonly islandVectorClip: {
    readonly stableId: string;
    readonly revisionKey: string;
    readonly elements: readonly import('@lighttable/vector-core').VectorElement[];
    readonly parentTransform: AffineMatrix;
    readonly inverted: boolean;
  } | null;
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
  readonly layerToDocument: AffineMatrix;
  readonly participates: boolean;
}

interface ForcedIslandToken {
  readonly kind: 'forced-island';
  readonly members: readonly VectorToken[];
  readonly composition: readonly RenderIslandCompositionNode[];
  readonly scopePath: readonly LayerId[];
  readonly isolationOwnerId: LayerId;
  readonly reasons: readonly RenderIslandBoundaryReason[];
  readonly islandVectorClip: RenderIslandPlanEntry['islandVectorClip'];
  readonly forcedVelloEligible: boolean;
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
  if (group.vectorClip?.enabled) reasons.push('layer-mask');
  if (layerStyleStackIsActive(group.styleStack)) reasons.push('layer-effects');
  if (group.derivedPreview) reasons.push('derived-preview');
  return reasons;
};

interface CollectedVectorSubtree {
  readonly members: VectorToken[];
  readonly composition: RenderIslandCompositionNode[];
}

const collectPureVectorSubtree = (
  nodes: readonly LayerNode[],
  inheritedTransform: AffineMatrix,
  scopePath: readonly LayerId[],
  inheritedVisible: boolean,
  transientVectorBarriers: ReadonlySet<LayerId>
): CollectedVectorSubtree | null => {
  const members: VectorToken[] = [];
  const composition: RenderIslandCompositionNode[] = [];
  for (const node of nodes) {
    if (node.type === 'vector') {
      if (transientVectorBarriers.has(node.id)) return null;
      // Nested layer isolation still needs its own boundary with today's
      // PaintScene contract; do not hide it inside a group-wide island.
      if (vectorBoundaryReasons(node).length > 0) return null;
      members.push({
        kind: 'vector', layer: node, scopePath,
        layerToDocument: multiplyMatrices(inheritedTransform, node.transform),
        participates: inheritedVisible && node.visible && node.opacity > 0
      });
      composition.push({ kind: 'member', layerId: node.id });
      continue;
    }
    if (node.type !== 'group') return null;
    // Normal source-over opacity is representable as a retained PaintScene
    // subtree. Every other group feature remains a semantic island boundary.
    const unsupportedReasons = groupBoundaryReasons(node).filter(
      reason => reason !== 'group-isolation'
    );
    if (unsupportedReasons.length > 0) return null;
    const childScope = [...scopePath, node.id];
    const children = collectPureVectorSubtree(
      node.children,
      multiplyMatrices(inheritedTransform, node.transform),
      childScope,
      inheritedVisible && node.visible && node.opacity > 0,
      transientVectorBarriers
    );
    if (!children) return null;
    members.push(...children.members);
    composition.push(...(node.opacity < 0.99999 && children.composition.length > 0 ? [{
      kind: 'opacity-group' as const,
      stableId: node.id,
      opacity: node.opacity,
      children: children.composition
    }] : children.composition));
  }
  return { members, composition };
};

const tokenize = (
  nodes: readonly LayerNode[],
  scopePath: readonly LayerId[],
  inheritedTransform: AffineMatrix,
  inheritedVisible: boolean,
  output: IslandToken[],
  transientVectorBarriers: ReadonlySet<LayerId>
) => {
  for (const node of nodes) {
    if (node.type === 'vector') {
      if (transientVectorBarriers.has(node.id)) {
        output.push({ kind: 'barrier', reason: 'interaction-preview' });
        continue;
      }
      const reasons = vectorBoundaryReasons(node);
      if (reasons.length === 0) {
        output.push({
          kind: 'vector', layer: node, scopePath,
          layerToDocument: multiplyMatrices(inheritedTransform, node.transform),
          participates: inheritedVisible && node.visible && node.opacity > 0
        });
      } else {
        output.push({ kind: 'barrier', reason: reasons[0] });
        output.push({
          kind: 'forced-island', members: [{
            kind: 'vector', layer: node, scopePath,
            layerToDocument: multiplyMatrices(inheritedTransform, node.transform),
            participates: inheritedVisible && node.visible && node.opacity > 0
          }], composition: [{ kind: 'member', layerId: node.id }], scopePath,
          isolationOwnerId: node.id, reasons, islandVectorClip: null,
          forcedVelloEligible: true
        });
        output.push({ kind: 'barrier', reason: reasons[0] });
      }
      continue;
    }
    if (node.type === 'group') {
      const childScope = [...scopePath, node.id];
      const childTransform = multiplyMatrices(inheritedTransform, node.transform);
      const childVisible = inheritedVisible && node.visible && node.opacity > 0;
      const vectorChildren = collectPureVectorSubtree(
        node.children, childTransform, childScope, childVisible,
        transientVectorBarriers
      );
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
        tokenize(
          node.children, childScope, childTransform, childVisible, output,
          transientVectorBarriers
        );
        continue;
      }
      output.push({ kind: 'barrier', reason: reasons[0] });
      if (vectorChildren?.members.length) {
        output.push({
          kind: 'forced-island', members: vectorChildren.members,
          composition: vectorChildren.composition, scopePath: childScope,
          isolationOwnerId: node.id, reasons,
          islandVectorClip: node.vectorClip?.enabled ? {
            stableId: node.vectorClip.id,
            revisionKey: `${node.vectorClip.revision}:${node.vectorClip.elements.map(element => [
              element.id, element.geometryRevision, element.transformRevision
            ].join(':')).join('|')}`,
            elements: node.vectorClip.elements,
            parentTransform: childTransform,
            inverted: node.vectorClip.inverted
          } : null,
          forcedVelloEligible: !node.mask?.enabled
        });
      } else {
        tokenize(
          node.children, childScope, childTransform, childVisible, output,
          transientVectorBarriers
        );
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
  members: readonly VectorToken[],
  role: RenderIslandRole,
  scopePath: readonly LayerId[],
  isolationOwnerId: LayerId | null,
  reasons: readonly RenderIslandBoundaryReason[],
  islandVectorClip: RenderIslandPlanEntry['islandVectorClip'] = null,
  forcedVelloEligible = true,
  composition: readonly RenderIslandCompositionNode[] = members.map(
    ({ layer }) => ({ kind: 'member' as const, layerId: layer.id })
  )
): RenderIslandPlanEntry => {
  const layers = members.map(({ layer }) => layer);
  const canonicalLayerIds = layers.map(({ id }) => id);
  return {
    candidateKey: [role, ...scopePath, ...canonicalLayerIds].join(':'),
    anchorLayerId: layers[0].id,
    role,
    canonicalLayerIds,
    members: members.map(({ layer, layerToDocument, participates }) => ({
      layer, layerToDocument, participates
    })),
    composition,
    scopePath,
    isolationOwnerId,
    islandVectorClip,
    backendEligibility: {
      native: true,
      vello: layers.every(layer => !layer.vectorClip?.inverted)
        && !islandVectorClip?.inverted
        && forcedVelloEligible
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
export const planRenderIslands = (
  nodes: readonly LayerNode[],
  options: RenderIslandPlanningOptions = {}
): RenderIslandPlan => {
  const tokens: IslandToken[] = [];
  tokenize(
    nodes, [], identityAffineMatrix(), true, tokens,
    options.transientVectorBarriers ?? new Set()
  );
  const islands: RenderIslandPlanEntry[] = [];
  let run: VectorToken[] = [];
  const flush = (boundaryReasons: readonly RenderIslandBoundaryReason[] = []) => {
    if (run.length === 0) return;
    islands.push(entry(
      run,
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
        token.members, 'isolated-vector-group', token.scopePath,
        token.isolationOwnerId, token.reasons, token.islandVectorClip,
        token.forcedVelloEligible, token.composition
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
