import { describe, expect, it } from 'vitest';
import {
  createAnchor,
  createSubpath,
  createVectorPath,
  rotationMatrix,
  scaleMatrix,
  translationMatrix
} from '@lighttable/vector-core';
import {
  createGroupLayer,
  createImageDocument,
  createVectorLayer
} from '../../editor/document/documentTypes';
import {
  hitTestVectorDocument,
  vectorAnchorsInDocumentRect,
  vectorPathDocumentBounds,
  vectorPathsTopmostFirst
} from './vectorSceneQueries';

const square = (id: string, size = 10) => createVectorPath(id, id, [
  createSubpath(`${id}-subpath`, [
    createAnchor(`${id}-a`, { x: 0, y: 0 }),
    createAnchor(`${id}-b`, { x: size, y: 0 }),
    createAnchor(`${id}-c`, { x: size, y: size }),
    createAnchor(`${id}-d`, { x: 0, y: size })
  ], true)
]);

describe('vector scene queries', () => {
  it('resolves nested layer and path transforms into document space', () => {
    const document = createImageDocument('scene', 200, 200, 'asset');
    const path = square('nested');
    path.transform = translationMatrix(3, 4);
    const vector = createVectorLayer([path]);
    vector.transform = scaleMatrix(2, 3);
    const group = createGroupLayer('parent');
    group.transform = translationMatrix(20, 30);
    group.children = [vector];
    document.layers = [group];

    expect(hitTestVectorDocument(document, {
      documentPoint: { x: 26, y: 42 },
      radius: 0.1
    })?.target).toEqual({
      kind: 'anchor',
      subpathId: 'nested-subpath',
      anchorId: 'nested-a'
    });
  });

  it('returns the visually topmost path and excludes hidden descendants', () => {
    const document = createImageDocument('order', 100, 100, 'asset');
    const bottom = createVectorLayer([square('bottom')], 'Bottom');
    const top = createVectorLayer([square('top-a'), square('top-b')], 'Top');
    document.layers = [bottom, top];

    expect(hitTestVectorDocument(document, {
      documentPoint: { x: 5, y: 5 },
      radius: 0.1
    })?.pathId).toBe('top-b');

    top.visible = false;
    expect(hitTestVectorDocument(document, {
      documentPoint: { x: 5, y: 5 },
      radius: 0.1
    })?.pathId).toBe('bottom');

    const hiddenGroup = createGroupLayer('hidden');
    hiddenGroup.visible = false;
    hiddenGroup.children = [bottom];
    document.layers = [hiddenGroup];
    expect(vectorPathsTopmostFirst(document)).toEqual([]);
  });

  it('computes exact rotated cubic bounds instead of rotating an AABB', () => {
    const document = createImageDocument('bounds', 100, 100, 'asset');
    const path = square('rotated', 10);
    path.transform = rotationMatrix(Math.PI / 4);
    const vector = createVectorLayer([path]);
    vector.transform = translationMatrix(20, 30);
    document.layers = [vector];

    const bounds = vectorPathDocumentBounds(document, vector.id, path.id);
    expect(bounds?.x).toBeCloseTo(20 - Math.sqrt(50), 8);
    expect(bounds?.y).toBeCloseTo(30, 8);
    expect(bounds?.width).toBeCloseTo(Math.sqrt(200), 8);
    expect(bounds?.height).toBeCloseTo(Math.sqrt(200), 8);
  });

  it('queries anchors in document space through nested transforms', () => {
    const document = createImageDocument('marquee', 200, 200, 'asset');
    const path = square('nested');
    path.transform = translationMatrix(3, 4);
    const vector = createVectorLayer([path]);
    vector.transform = scaleMatrix(2, 3);
    const group = createGroupLayer('parent');
    group.transform = translationMatrix(20, 30);
    group.children = [vector];
    document.layers = [group];

    expect(vectorAnchorsInDocumentRect(document, {
      x: 27,
      y: 43,
      width: -2,
      height: -2
    }).map(({ anchorId }) => anchorId)).toEqual(['nested-a']);
  });
});
