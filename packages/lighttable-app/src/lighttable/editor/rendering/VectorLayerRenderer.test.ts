import { describe, expect, it } from 'vitest';
import {
  createVectorLiveShape,
  createVectorPath,
  createSubpath,
  createAnchor,
  translationMatrix
} from '@lighttable/vector-core';
import { createVectorLayer } from '../document/documentTypes';
import {
  compileVelloVectorLayerScene,
  compileVelloVectorIslandScene,
  compileRetainedVelloVectorIslandScene,
  maximumAffineScale,
  vectorGeometryTolerance,
  vectorSurfaceBytes,
  vectorSurfaceSampleCount,
  VectorGeometryRealizationCache,
  VectorLayerRenderer
} from './VectorLayerRenderer';
import { planRenderIslands } from './RenderIslandPlanner';
import { RetainedRenderIslandRegistry } from './RetainedRenderIslandRegistry';

describe('adaptive vector tessellation', () => {
  it('measures the largest affine scale including rotation and non-uniform scale', () => {
    expect(maximumAffineScale({ a: 0, b: 3, c: -2, d: 0, tx: 10, ty: 20 })).toBeCloseTo(3);
    expect(maximumAffineScale({ a: 1, b: 0, c: 1, d: 1, tx: 0, ty: 0 })).toBeCloseTo(1.6180339887);
  });

  it('adapts to authored document transforms without coupling geometry to viewport zoom', () => {
    expect(vectorGeometryTolerance({ a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 })).toBe(0.25);
    expect(vectorGeometryTolerance({ a: 4, b: 0, c: 0, d: 4, tx: 0, ty: 0 })).toBe(0.0625);
    expect(vectorGeometryTolerance({ a: 0.25, b: 0, c: 0, d: 0.25, tx: 0, ty: 0 })).toBe(1);
  });

  it('drops multisampling before a large vector surface exceeds its budget', () => {
    expect(vectorSurfaceBytes(10_000, 10_000, 4)).toBe(5_600_000_000);
    expect(vectorSurfaceBytes(10_000, 10_000, 1)).toBe(1_200_000_000);
    expect(vectorSurfaceSampleCount(1_000, 1_000, true)).toBe(4);
    expect(vectorSurfaceSampleCount(10_000, 10_000, true)).toBe(1);
    expect(vectorSurfaceSampleCount(1_000, 1_000, false)).toBe(1);
  });
});

describe('Vello paint-scene projection', () => {
  it('evicts a hidden warm texture before an active one and keeps the resource cold', () => {
    const activeLayer = createVectorLayer([], 'active');
    const hiddenLayer = createVectorLayer([], 'hidden');
    hiddenLayer.opacity = 0.5;
    hiddenLayer.visible = false;
    const registry = new RetainedRenderIslandRegistry();
    const islands = registry.reconcile(planRenderIslands([activeLayer, hiddenLayer])).islands;
    const active = islands.find(island => island.members.some(member => member.participates))!;
    const hidden = islands.find(island => island.members.every(member => !member.participates))!;
    const renderer = new VectorLayerRenderer({} as GPUDevice, 100);
    const disposed: string[] = [];
    const resources = (renderer as unknown as {
      velloSurfaces: Map<string, {
        surface: { estimatedBytes: number; dispose: () => void } | null;
        renderedSceneKey: string | null;
        renderedDependency: null;
        renderedIslandDependency: null;
        retainedIslandProjection: null;
        lastTouched: number;
      }>;
    }).velloSurfaces;
    const resource = (id: string, lastTouched: number) => ({
      surface: { estimatedBytes: 80, dispose: () => disposed.push(id) },
      renderedSceneKey: 'ready', renderedDependency: null,
      renderedIslandDependency: null, retainedIslandProjection: null, lastTouched
    });
    resources.set(active.resourceId, resource(active.resourceId, 2));
    resources.set(hidden.resourceId, resource(hidden.resourceId, 1));

    renderer.prepareIslandFrame(islands);

    expect(disposed).toEqual([hidden.resourceId]);
    expect(resources.get(active.resourceId)?.surface).not.toBeNull();
    expect(resources.get(hidden.resourceId)).toMatchObject({
      surface: null, renderedSceneKey: null
    });
    expect(renderer.backendDiagnostics()).toMatchObject({
      velloSurfaces: 1, velloWarmSurfaces: 0,
      velloColdResources: 1, velloSurfaceEvictions: 1
    });
  });

  it('retains layer-qualified fragments while visibility mutates only island composition', () => {
    const first = createVectorLayer([createVectorLiveShape('first', {
      kind: 'ellipse', width: 40, height: 20
    })]);
    const second = createVectorLayer([createVectorLiveShape('second', {
      kind: 'ellipse', width: 20, height: 10
    })]);
    const registry = new RetainedRenderIslandRegistry();
    const visibleIsland = registry.reconcile(planRenderIslands([first, second])).islands[0];
    const visible = compileVelloVectorIslandScene(visibleIsland);
    second.visible = false;
    const hiddenIsland = registry.reconcile(planRenderIslands([first, second])).islands[0];
    const hidden = compileVelloVectorIslandScene(hiddenIsland);

    expect(visible.scene.fragments).toHaveLength(2);
    expect(hidden.scene.fragments.map(({ stableId }) => stableId)).toEqual(
      visible.scene.fragments.map(({ stableId }) => stableId)
    );
    expect(visible.scene.composition).toHaveLength(2);
    expect(hidden.scene.composition).toHaveLength(1);
    expect(hidden.sceneKey).not.toBe(visible.sceneKey);
    expect(hiddenIsland.resourceId).toBe(visibleIsland.resourceId);
  });

  it('reprojects only the changed member while Rust-facing fragments stay retained', () => {
    const first = createVectorLayer([
      createVectorLiveShape('first', { kind: 'ellipse', width: 40, height: 20 }),
      createVectorLiveShape('first-2', { kind: 'ellipse', width: 10, height: 10 })
    ]);
    const second = createVectorLayer([createVectorLiveShape('second', {
      kind: 'ellipse', width: 20, height: 10
    })]);
    const registry = new RetainedRenderIslandRegistry();
    let island = registry.reconcile(planRenderIslands([first, second])).islands[0];
    const initialPhases: string[] = [];
    const initial = compileRetainedVelloVectorIslandScene(
      island, null, (phase) => initialPhases.push(phase)
    );
    expect(initial.compiledMemberCount).toBe(2);
    expect(initial.compiledFragmentCount).toBe(3);
    expect(initialPhases.filter(phase => phase === 'paint-scene-validation')).toHaveLength(2);

    second.elements[0].transform = translationMatrix(2, 0);
    second.elements[0].transformRevision += 1;
    island = registry.reconcile(planRenderIslands([first, second])).islands[0];
    const edited = compileRetainedVelloVectorIslandScene(island, initial.projection);

    expect(edited.compiledMemberCount).toBe(1);
    expect(edited.compiledFragmentCount).toBe(1);
    expect(edited.projection.members.get(first.id)?.compiled.result).toBe(
      initial.projection.members.get(first.id)?.compiled.result
    );
    expect(edited.scene.fragments).toHaveLength(3);
  });

  it('combines inherited, layer and exact path transforms without mutating authority', () => {
    const path = createVectorPath('path', 'Path', [createSubpath('outline', [
      createAnchor('a', { x: 0, y: 0 }),
      createAnchor('b', { x: 20, y: 10 })
    ], false)]);
    path.transform = translationMatrix(3, 4);
    const layer = createVectorLayer([path], 'Vello layer');
    layer.transform = translationMatrix(10, 20);

    const compiled = compileVelloVectorLayerScene(layer, translationMatrix(100, 200));

    expect(compiled.status).toBe('ready');
    const command = compiled.scene.fragments[0].commands[0];
    expect(command?.kind).toBe('fill-path');
    expect(command && command.kind !== 'pop-clip' ? command.transform : null).toEqual([
      1, 0, 0, 1, 113, 224
    ]);
    expect(layer.transform).toEqual(translationMatrix(10, 20));
    expect(layer.elements[0].transform).toEqual(translationMatrix(3, 4));
  });

  it('changes the bounded scene revision for authored or inherited geometry state', () => {
    const layer = createVectorLayer([createVectorLiveShape('shape', {
      kind: 'rectangle',
      width: 40,
      height: 20,
      cornerRadii: [0, 0, 0, 0],
      linkedCorners: true
    })]);
    const first = compileVelloVectorLayerScene(layer, translationMatrix(0, 0));
    const moved = compileVelloVectorLayerScene(layer, translationMatrix(1, 0));
    layer.elements[0].styleRevision += 1;
    const restyled = compileVelloVectorLayerScene(layer, translationMatrix(0, 0));

    expect(first.sceneKey).not.toBe(moved.sceneKey);
    expect(first.scene.fragments[0]?.revisionKey)
      .not.toBe(moved.scene.fragments[0]?.revisionKey);
    expect(first.sceneKey).not.toBe(restyled.sceneKey);
    expect(first.sceneKey.length).toBeLessThan(128);
  });

  it('keeps presentation-only visibility and opacity out of the retained scene revision', () => {
    const layer = createVectorLayer([createVectorLiveShape('shape', {
      kind: 'ellipse', width: 40, height: 20
    })]);
    const first = compileVelloVectorLayerScene(layer, translationMatrix(0, 0));
    layer.visible = false;
    layer.opacity = 0.25;
    layer.revision += 2;
    const presentationOnly = compileVelloVectorLayerScene(layer, translationMatrix(0, 0));

    expect(presentationOnly.sceneKey).toBe(first.sceneKey);
  });

  it('projects a canonical vector clip into Vello composition without mutating it', () => {
    const artwork = createVectorLiveShape('art', {
      kind: 'rectangle', width: 100, height: 80,
      cornerRadii: [0, 0, 0, 0], linkedCorners: true
    });
    const mask = createVectorLiveShape('mask-shape', {
      kind: 'ellipse', width: 60, height: 40
    });
    mask.transform = translationMatrix(20, 15);
    const layer = createVectorLayer([artwork], 'Clipped vector');
    layer.vectorClip = {
      id: 'clip', name: 'Clip', enabled: true, inverted: false,
      elements: [mask], revision: 2
    };
    const compiled = compileVelloVectorLayerScene(layer, translationMatrix(5, 7));
    expect(compiled.status).toBe('ready');
    expect(compiled.scene.composition).toEqual([{
      kind: 'clip', stableId: 'clip',
      children: [{ kind: 'fragment', stableId: 'art' }]
    }]);
    expect(compiled.scene.clips[0]?.path.commands[0]).toMatchObject({
      kind: 'move', x: 55, y: 22
    });
    expect(mask.transform).toEqual(translationMatrix(20, 15));
  });
});

describe('VectorGeometryRealizationCache', () => {
  it('reuses flattened path geometry across paint and transform revisions', () => {
    const cache = new VectorGeometryRealizationCache();
    const path = createVectorPath('path', 'Path', [createSubpath('outline', [
      createAnchor('a', { x: 0, y: 0 }),
      createAnchor('b', { x: 100, y: 100 })
    ], false)]);
    const first = cache.realize(path, 0.25);
    path.transformRevision += 1;
    path.styleRevision += 1;
    const second = cache.realize(path, 0.25);

    expect(second.realized).toBe(first.realized);
    expect(cache.metrics()).toMatchObject({ entries: 1, hits: 1, misses: 1 });
  });

  it('invalidates changed geometry and refreshes live-shape paint on cache hits', () => {
    const cache = new VectorGeometryRealizationCache();
    const shape = createVectorLiveShape('shape', {
      kind: 'ellipse', width: 100, height: 80
    });
    const first = cache.realize(shape, 0.25);
    shape.style.opacity = 0.5;
    shape.styleRevision += 1;
    const restyled = cache.realize(shape, 0.25);
    expect(restyled.realized).toBe(first.realized);
    expect(restyled.path.style.opacity).toBe(0.5);

    if (shape.geometry.kind !== 'ellipse') throw new Error('Expected ellipse geometry.');
    shape.geometry.width = 120;
    shape.geometryRevision += 1;
    const changed = cache.realize(shape, 0.25);
    expect(changed.realized).not.toBe(first.realized);
    expect(cache.metrics()).toMatchObject({ entries: 2, hits: 1, misses: 2 });
  });
});
