import { describe, expect, it } from 'vitest';
import { createImageDocument } from '../document/documentTypes';
import { setLayerTransform } from '../document/documentCommands';
import { findRasterLayer } from '../document/layerTree';
import { translationMatrix } from '../tools/transform/affine';
import { rasterRenderContract } from './renderContract';

describe('LightTable raster render contract', () => {
  it('exposes one explicit linear premultiplied source/geometry contract', () => {
    const base = createImageDocument('Image', 100, 50, 'asset');
    const document = setLayerTransform(base, base.layers[0].id, translationMatrix(8, 2));
    const texture = { id: 'texture' };
    const contract = rasterRenderContract(findRasterLayer(document, document.layers[0].id)!, texture);

    expect(contract).toMatchObject({
      texture,
      dimensions: { width: 100, height: 50 },
      bounds: { x: 0, y: 0, width: 100, height: 50 },
      colorSpace: 'linear-srgb',
      alphaMode: 'premultiplied',
      revision: { source: 0, geometry: 1 },
      transform: translationMatrix(8, 2)
    });
  });
});
