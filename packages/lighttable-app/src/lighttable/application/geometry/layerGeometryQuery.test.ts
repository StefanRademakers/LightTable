import { describe, expect, it } from 'vitest';
import { createVectorLiveShape, translationMatrix } from '@lighttable/vector-core';
import { createDefaultFlowTextSource, createDefaultTextLayerData } from '@lighttable/text-core';
import {
  createGroupLayer,
  createImageDocument,
  createTextLayerNode,
  createVectorLayer
} from '../../editor/document/documentTypes';
import { buildLayerGeometryIndex, pointInBounds } from './layerGeometryQuery';

describe('layer geometry query', () => {
  it('retains one revision-correct index per immutable document snapshot', () => {
    const document = createImageDocument('Geometry', 100, 80, 'source');
    expect(buildLayerGeometryIndex(document)).toBe(buildLayerGeometryIndex(document));

    const next = { ...document, revision: document.revision + 1 };
    expect(buildLayerGeometryIndex(next)).not.toBe(buildLayerGeometryIndex(document));
  });

  it('projects semantic vector paint through rotation, skew and nested group transforms', () => {
    const shape = createVectorLiveShape('shape', {
      kind: 'rectangle', width: 20, height: 10,
      cornerRadii: [0, 0, 0, 0], linkedCorners: true
    });
    shape.transform = translationMatrix(5, 7);
    const vector = createVectorLayer([shape]);
    vector.transform = { a: 0, b: 1, c: -1, d: 0, tx: 30, ty: 40 };
    const group = createGroupLayer('Group');
    group.transform = { a: 1, b: 0.25, c: 0.5, d: 1, tx: 100, ty: 50 };
    group.children = [vector];
    const document = { ...createImageDocument('Geometry', 300, 200, 'source'), layers: [group] };

    const geometry = buildLayerGeometryIndex(document);
    expect(geometry.byLayerId.get(vector.id)).toMatchObject({
      documentBounds: { x: 135.5, y: 98.25, width: 20, height: 22.5 },
      visualBounds: { x: 135.5, y: 98.25, width: 20, height: 22.5 },
      source: 'vector-paint'
    });
    expect(geometry.byLayerId.get(group.id)).toMatchObject({
      documentBounds: { x: 135.5, y: 98.25, width: 20, height: 22.5 },
      source: 'group-union'
    });
  });

  it('treats bounds as rejection-only geometry', () => {
    const bounds = { x: 10, y: 20, width: 30, height: 40 };
    expect(pointInBounds({ x: 25, y: 30 }, bounds)).toBe(true);
    expect(pointInBounds({ x: 9, y: 30 }, bounds)).toBe(false);
    expect(pointInBounds({ x: 9, y: 30 }, bounds, 1)).toBe(true);
  });

  it('does not reject hits from text that may visibly overflow its authored frame', () => {
    const data = createDefaultTextLayerData();
    const source = createDefaultFlowTextSource('Overflowing text');
    const text = createTextLayerNode({
      ...data,
      source: {
        ...source,
        layout: {
          mode: 'paragraph', frame: { x: 10, y: 20, width: 30, height: 40 },
          overflow: 'visible', writingMode: 'horizontal-tb'
        }
      }
    });
    const document = { ...createImageDocument('Text', 100, 80, 'source'), layers: [text] };
    expect(buildLayerGeometryIndex(document).byLayerId.get(text.id)).toMatchObject({
      documentBounds: { x: 10, y: 20, width: 30, height: 40 },
      visualBounds: null,
      source: 'text-frame'
    });
  });
});
