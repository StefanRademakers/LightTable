import { describe, expect, it } from 'vitest';
import { createImageDocument, type RasterLayer } from '../../../editor/document/documentTypes';
import { buildLayerSnapTargets, layerDocumentSnapBounds } from './layerSnapGeometry';

const raster = (name: string, width: number, height: number): RasterLayer => {
  const document = createImageDocument(name, width, height, `${name}-asset`);
  return { ...(document.layers[0] as RasterLayer), name, width, height };
};

describe('layer snap geometry', () => {
  it('uses retained raster geometry and its scene transform without readback', () => {
    const document = createImageDocument('test', 200, 100, 'asset');
    const layer = raster('runtime', 20, 10);
    layer.transform = { a: 1, b: 0, c: 0, d: 1, tx: 30, ty: 40 };
    document.layers = [layer];
    expect(layerDocumentSnapBounds(document, layer)).toEqual({ x: 30, y: 40, width: 20, height: 10 });
  });

  it('excludes every moving member and retains strict document edges', () => {
    const document = createImageDocument('test', 200, 100, 'asset');
    const first = raster('first', 20, 10);
    const second = raster('second', 30, 15);
    second.id = `${second.id}-second` as typeof second.id;
    second.transform = { a: 1, b: 0, c: 0, d: 1, tx: 70, ty: 40 };
    document.layers = [first, second];
    const targets = buildLayerSnapTargets(document, { excludedLayerIds: new Set([first.id]) });
    expect(targets.some((target) => target.sourceId === first.id)).toBe(false);
    expect(targets.filter((target) => target.sourceId === second.id)).toHaveLength(6);
    expect(targets.filter((target) => target.source === 'canvas')).toHaveLength(4);
  });

  it('publishes persisted guide lines on their correct axes', () => {
    const document = {
      ...createImageDocument('Snap', 300, 200, 'asset'),
      guides: [
        { id: 'vertical', orientation: 'vertical' as const, position: 40 },
        { id: 'horizontal', orientation: 'horizontal' as const, position: 70 }
      ]
    };
    const targets = buildLayerSnapTargets(document, {
      includeCanvas: false,
      includeLayers: false,
      includeGuides: true
    });
    expect(targets).toEqual(expect.arrayContaining([
      expect.objectContaining({ axis: 'x', position: 40, source: 'guide', sourceId: 'vertical' }),
      expect.objectContaining({ axis: 'y', position: 70, source: 'guide', sourceId: 'horizontal' })
    ]));
  });

  it('materializes only nearby mathematical grid candidates', () => {
    const document = createImageDocument('Snap', 300, 200, 'asset');
    const targets = buildLayerSnapTargets(document, {
      includeCanvas: false,
      includeLayers: false,
      includeGuides: false,
      includeGrid: true,
      gridSpacing: 10,
      movingBounds: { x: 16, y: 23, width: 28, height: 14 }
    });
    expect(targets.filter(({ source }) => source === 'grid')).toHaveLength(6);
    expect(targets).toEqual(expect.arrayContaining([
      expect.objectContaining({ axis: 'x', position: 20, source: 'grid' }),
      expect.objectContaining({ axis: 'y', position: 20, source: 'grid' })
    ]));
  });
});
