import { describe, expect, it } from 'vitest';
import { createVectorLiveShape } from '@lighttable/vector-core';
import { compileVectorPaintSceneIsland } from './compileVectorPaintScene';

const identity = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };

describe('compileVectorPaintSceneIsland', () => {
  it('keeps cross-layer fragments stable, qualified and in canonical paint order', () => {
    const first = createVectorLiveShape('shape', {
      kind: 'rectangle', width: 10, height: 10,
      cornerRadii: [0, 0, 0, 0], linkedCorners: true
    });
    const second = { ...first, name: 'same canonical element id in another layer' };
    const result = compileVectorPaintSceneIsland('island-1', 'revision-1', [
      { layerId: 'layer-a', sourceRevision: '1', elements: [first], parentTransform: identity },
      { layerId: 'layer-b', sourceRevision: '1', elements: [second], parentTransform: identity }
    ]);

    expect(result.status).toBe('ready');
    expect(result.scene.fragments.map(({ stableId }) => stableId)).toEqual([
      `layer-a:${first.id}`, `layer-b:${first.id}`
    ]);
    expect(result.scene.composition).toEqual([
      { kind: 'fragment', stableId: `layer-a:${first.id}` },
      { kind: 'fragment', stableId: `layer-b:${first.id}` }
    ]);
  });

  it('projects nested opacity without merging canonical fragments', () => {
    const first = createVectorLiveShape('first', {
      kind: 'rectangle', width: 10, height: 10,
      cornerRadii: [0, 0, 0, 0], linkedCorners: true
    });
    const second = createVectorLiveShape('second', {
      kind: 'ellipse', width: 10, height: 10
    });
    const result = compileVectorPaintSceneIsland('island-1', 'revision-1', [
      { layerId: 'layer-a', sourceRevision: '1', elements: [first], parentTransform: identity },
      { layerId: 'layer-b', sourceRevision: '1', elements: [second], parentTransform: identity }
    ], {
      composition: [
        { kind: 'member', layerId: 'layer-a' },
        {
          kind: 'opacity-group', opacity: 0.4,
          children: [{ kind: 'member', layerId: 'layer-b' }]
        }
      ]
    });

    expect(result.status).toBe('ready');
    expect(result.scene.fragments).toHaveLength(2);
    expect(result.scene.composition).toEqual([
      { kind: 'fragment', stableId: `layer-a:${first.id}` },
      {
        kind: 'opacity-group', opacity: 0.4,
        children: [{ kind: 'fragment', stableId: `layer-b:${second.id}` }]
      }
    ]);

    const hidden = compileVectorPaintSceneIsland('island-1', 'revision-2', [
      { layerId: 'layer-a', sourceRevision: '1', elements: [first], parentTransform: identity },
      {
        layerId: 'layer-b', sourceRevision: '1', elements: [second],
        parentTransform: identity, participates: false
      }
    ], {
      composition: [{
        kind: 'opacity-group', opacity: 0.4,
        children: [{ kind: 'member', layerId: 'layer-b' }]
      }, { kind: 'member', layerId: 'layer-a' }]
    });
    expect(hidden.scene.fragments).toHaveLength(2);
    expect(hidden.scene.composition).toEqual([
      { kind: 'fragment', stableId: `layer-a:${first.id}` }
    ]);
  });
});
