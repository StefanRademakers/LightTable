import { describe, expect, it } from 'vitest';
import {
  createGroupLayer,
  createImageDocument,
  type GroupLayer,
  type RasterLayer
} from './documentTypes';
import {
  aroundPoint,
  identityAffineMatrix,
  multiplyMatrices,
  rotationMatrix,
  scaleMatrix,
  transformPoint,
  translationMatrix
} from '../geometry/affine';
import {
  buildSceneTransformIndex,
  documentPointToLocal,
  localPointToDocument,
  localTransformForReparent,
  requireSceneTransform
} from './sceneTransformGraph';

describe('scene transform graph', () => {
  it('accumulates nested local transforms in parent-to-child order', () => {
    const document = createImageDocument('nested', 100, 100, 'asset');
    const raster = document.layers[0] as RasterLayer;
    raster.transform = translationMatrix(8, 3);
    const inner = createGroupLayer('inner');
    inner.transform = scaleMatrix(2, 3);
    inner.children = [raster];
    const outer = createGroupLayer('outer');
    outer.transform = translationMatrix(20, -4);
    outer.children = [inner];
    document.layers = [outer];

    const resolved = requireSceneTransform(buildSceneTransformIndex(document), raster.id);
    expect(localPointToDocument(resolved, { x: 1, y: 2 })).toEqual({ x: 38, y: 11 });
    expect(documentPointToLocal(resolved, { x: 38, y: 11 })).toEqual({ x: 1, y: 2 });
  });

  it('preserves the world transform when reparenting', () => {
    const world = multiplyMatrices(
      translationMatrix(90, 40),
      aroundPoint(rotationMatrix(Math.PI / 5), { x: 12, y: 9 })
    );
    const newParentWorld = multiplyMatrices(translationMatrix(-20, 8), scaleMatrix(1.5, 0.75));
    const local = localTransformForReparent(world, newParentWorld);
    expect(local).not.toBeNull();
    const rebuiltWorld = multiplyMatrices(newParentWorld, local ?? identityAffineMatrix());
    const point = { x: 17, y: -6 };
    const expected = transformPoint(world, point);
    const actual = transformPoint(rebuiltWorld, point);
    expect(actual.x).toBeCloseTo(expected.x, 10);
    expect(actual.y).toBeCloseTo(expected.y, 10);
  });

  it('marks singular world transforms as non-invertible', () => {
    const document = createImageDocument('singular', 100, 100, 'asset');
    const group = createGroupLayer('singular') as GroupLayer;
    group.transform = scaleMatrix(0, 1);
    group.children = document.layers;
    document.layers = [group];

    const raster = group.children[0] as RasterLayer;
    const resolved = requireSceneTransform(buildSceneTransformIndex(document), raster.id);
    expect(resolved.documentToLocal).toBeNull();
    expect(documentPointToLocal(resolved, { x: 10, y: 10 })).toBeNull();
  });
});
