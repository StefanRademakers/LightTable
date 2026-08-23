import { describe, expect, it } from 'vitest';
import { createDefaultLayerStyle } from '../styles/layerStyleDefaults';
import {
  createAdjustmentLayer,
  createGroupLayer,
  createImageDocument,
  createVectorLayer,
  type LayerNode,
  type VectorLayer
} from '../document/documentTypes';
import { planRenderIslands } from './RenderIslandPlanner';

const vector = (name: string): VectorLayer => {
  const layer = createVectorLayer([], name);
  return layer;
};

describe('RenderIslandPlanner', () => {
  it('reduces 17 canonical vector layers to five true islands', () => {
    const direct = (count: number, prefix: string) => Array.from(
      { length: count }, (_, index) => vector(`${prefix}-${index}`)
    );
    const isolatedA = createGroupLayer('isolated-a');
    isolatedA.opacity = 0.55;
    isolatedA.children = direct(3, 'a');
    const isolatedB = createGroupLayer('isolated-b');
    isolatedB.opacity = 0.62;
    isolatedB.children = direct(2, 'b');
    const documentLayers: LayerNode[] = [
      ...direct(4, 'lower'), isolatedA,
      ...direct(4, 'middle'), isolatedB,
      ...direct(4, 'upper')
    ];

    const plan = planRenderIslands(documentLayers);

    expect(plan.canonicalVectorLayerCount).toBe(17);
    expect(plan.projectedSurfaceCount).toBe(5);
    expect(plan.islands.map(island => ({
      role: island.role,
      layers: island.canonicalLayerIds.length,
      owner: island.isolationOwnerId
    }))).toEqual([
      { role: 'direct-vector-run', layers: 4, owner: null },
      { role: 'isolated-vector-group', layers: 3, owner: isolatedA.id },
      { role: 'direct-vector-run', layers: 4, owner: null },
      { role: 'isolated-vector-group', layers: 2, owner: isolatedB.id },
      { role: 'direct-vector-run', layers: 4, owner: null }
    ]);
  });

  it('does not let visibility change retained island membership or identity', () => {
    const first = vector('first');
    const second = vector('second');
    const before = planRenderIslands([first, second]);
    second.visible = false;
    second.revision += 1;
    const hidden = planRenderIslands([first, second]);

    expect(hidden.islands.map(({ candidateKey }) => candidateKey)).toEqual(
      before.islands.map(({ candidateKey }) => candidateKey)
    );
    expect(hidden.islands[0].canonicalLayerIds).toEqual(before.islands[0].canonicalLayerIds);
    expect(hidden.islands[0].members[1].participates).toBe(false);
  });

  it('splits at raster, adjustment and text interleaves', () => {
    const rasterDocument = createImageDocument('raster', 32, 32, 'source');
    const raster = rasterDocument.layers[0];
    const adjustment = createAdjustmentLayer({ id: 'neutral', revision: 0, modules: [] });
    const text = { ...vector('placeholder'), type: 'text' } as unknown as LayerNode;
    const plan = planRenderIslands([
      vector('a'), raster, vector('b'), adjustment, vector('c'), text, vector('d')
    ]);

    expect(plan.islands.map(({ canonicalLayerIds }) => canonicalLayerIds.length)).toEqual([1, 1, 1, 1]);
  });

  it('isolates layer opacity, blend, mask, clipping and effects', () => {
    const opacity = vector('opacity'); opacity.opacity = 0.5;
    const blend = vector('blend'); blend.blendMode = 'multiply';
    const masked = vector('masked'); masked.mask = {
      id: 'mask', enabled: true, linked: true,
      transform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
      density: 1, feather: 0, revision: 0, pixelRevision: 0, dirtyBounds: null
    };
    const clipped = vector('clipped'); clipped.clipping = true;
    const styled = vector('styled');
    styled.styleStack.effects.push(createDefaultLayerStyle('drop-shadow'));

    const plan = planRenderIslands([opacity, blend, masked, clipped, styled]);

    expect(plan.islands).toHaveLength(5);
    expect(plan.islands.map(({ boundaryReasons }) => boundaryReasons)).toEqual([
      expect.arrayContaining(['layer-opacity']),
      expect.arrayContaining(['non-normal-blend']),
      expect.arrayContaining(['layer-mask']),
      expect.arrayContaining(['clipping-chain']),
      expect.arrayContaining(['layer-effects'])
    ]);
  });

  it('keeps pass-through vector groups mergeable and marks inverted clips Vello-ineligible', () => {
    const lower = vector('lower');
    const nested = vector('nested');
    nested.vectorClip = {
      id: 'clip', name: 'Clip', enabled: true, inverted: true, elements: [], revision: 0
    };
    const group = createGroupLayer('pass-through');
    group.children = [nested];
    const upper = vector('upper');

    const plan = planRenderIslands([lower, group, upper]);

    expect(plan.islands).toHaveLength(1);
    expect(plan.islands[0].canonicalLayerIds).toEqual([lower.id, nested.id, upper.id]);
    expect(plan.islands[0].backendEligibility).toEqual({ native: true, vello: false });
  });

  it('collapses unobservable isolated vector groups but preserves observable isolation', () => {
    const lower = vector('lower');
    const neutral = createGroupLayer('neutral isolated');
    neutral.compositing = 'isolated';
    neutral.children = [vector('inside')];
    const upper = vector('upper');

    expect(planRenderIslands([lower, neutral, upper]).projectedSurfaceCount).toBe(1);

    const blended = vector('blended');
    blended.blendMode = 'multiply';
    neutral.children = [blended];
    const observable = planRenderIslands([lower, neutral, upper]);
    expect(observable.projectedSurfaceCount).toBe(3);
    expect(observable.islands[1].boundaryReasons).toContain('non-normal-blend');
  });

  it('retains nested normal-opacity vectors inside an outer vector clip island', () => {
    const plain = vector('plain');
    const faded = createGroupLayer('faded');
    faded.opacity = 0.62;
    const fadedChild = vector('faded-child');
    faded.children = [fadedChild];
    const clipped = createGroupLayer('clipped');
    clipped.vectorClip = {
      id: 'outer-clip', name: 'Outer clip', enabled: true, inverted: false,
      elements: [], revision: 3
    };
    clipped.children = [plain, faded];

    const plan = planRenderIslands([clipped]);

    expect(plan.projectedSurfaceCount).toBe(1);
    expect(plan.islands[0].canonicalLayerIds).toEqual([plain.id, fadedChild.id]);
    expect(plan.islands[0].islandVectorClip?.stableId).toBe('outer-clip');
    expect(plan.islands[0].composition).toEqual([
      { kind: 'member', layerId: plain.id },
      {
        kind: 'opacity-group', stableId: faded.id, opacity: 0.62,
        children: [{ kind: 'member', layerId: fadedChild.id }]
      }
    ]);
    expect(plan.islands[0].backendEligibility.vello).toBe(true);
  });
});
