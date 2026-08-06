import { describe, expect, it } from 'vitest';
import { readPsd, writePsdUint8Array } from 'ag-psd';
import { createDefaultTextLayerData } from '@lighttable/text-core';
import { createVectorLiveShape } from '@lighttable/vector-core';
import {
  createGroupLayer,
  createImageDocument,
  createTextLayerNode,
  createVectorLayer,
  type LayerId
} from '../../editor/document/documentTypes';
import { createDefaultLayerStyle } from '../../editor/styles/layerStyleDefaults';
import { projectDocumentToPsd } from './psdExportProjection';
import { readPsdColorProfile } from '../../image-io/psdColorProfile';
import { appendPsdImageResource } from './psdImageResourceWriter';
import { srgbIccProfileBytes } from '../../editor/color/srgbIccProfile';

const pixels = (width: number, height: number, rgba = [0, 0, 0, 0]) => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < data.length; offset += 4) data.set(rgba, offset);
  return { width, height, data };
};

describe('PSD export projection', () => {
  it('roundtrips groups, raster metadata, editable text, vectors and effects through ag-psd', () => {
    const document = createImageDocument('Roundtrip', 320, 240, 'background');
    const raster = document.layers[0]!;
    if (raster.type !== 'raster') throw new Error('Expected raster fixture.');
    raster.name = 'Pixels';
    raster.opacity = 0.75;
    raster.fillOpacity = 0.6;
    raster.clipping = true;
    const shadow = createDefaultLayerStyle('drop-shadow');
    if (shadow.kind !== 'drop-shadow') throw new Error('Expected shadow fixture.');
    shadow.distance = 12;
    shadow.size = 18;
    shadow.spread = 0.5;
    shadow.opacity = 0.5;
    raster.styleStack.effects = [shadow];
    const text = createTextLayerNode(createDefaultTextLayerData(), 'Editable text');
    text.transform = { a: 0, b: -1, c: 1, d: 0, tx: 180, ty: 90 };
    const shape = createVectorLiveShape('rectangle', {
      kind: 'rectangle', width: 80, height: 45,
      cornerRadii: [4, 4, 4, 4], linkedCorners: true
    });
    shape.style = {
      fill: { type: 'solid', color: [0.1, 0.8, 0.2, 1] },
      stroke: {
        paint: { type: 'solid', color: [1, 0, 0, 1] },
        width: 3, cap: 'round', join: 'round', miterLimit: 4,
        dash: [], dashOffset: 0
      },
      opacity: 1
    };
    const vector = createVectorLayer([shape], 'Editable shape');
    vector.transform = { a: 1, b: 0, c: 0, d: 1, tx: 35, ty: 55 };
    const group = createGroupLayer('Artwork');
    group.children = [text, vector];
    document.layers.push(group);

    const projection = projectDocumentToPsd(document, pixels(320, 240, [255, 255, 255, 255]), [{
      layerId: raster.id,
      pixels: pixels(raster.width, raster.height, [10, 20, 30, 255])
    }]);
    expect(projection.warnings).toEqual([]);
    expect(projection.editableTextLayers).toBe(1);
    expect(projection.editableVectorLayers).toBe(1);

    const encoded = appendPsdImageResource(writePsdUint8Array(projection.psd, {
      noBackground: true, trimImageData: true, invalidateTextLayers: false
    }), 1039, srgbIccProfileBytes());
    const encodedBuffer = encoded.buffer.slice(
      encoded.byteOffset,
      encoded.byteOffset + encoded.byteLength
    ) as ArrayBuffer;
    expect(readPsdColorProfile(encodedBuffer)).toMatchObject({
      disposition: 'embedded', name: 'uRGB'
    });
    const decoded = readPsd(encoded, {
      useImageData: true, skipLayerImageData: true,
      skipCompositeImageData: true, skipThumbnail: true
    });
    const decodedRaster = decoded.children?.[0];
    const decodedGroup = decoded.children?.[1];
    expect(decodedRaster).toMatchObject({ name: 'Pixels', clipping: true });
    expect(decodedRaster?.opacity).toBeCloseTo(0.75, 2);
    expect(decodedRaster?.fillOpacity).toBeCloseTo(0.6, 2);
    expect(decodedRaster?.effects?.dropShadow?.[0]).toMatchObject({
      enabled: true, distance: { units: 'Pixels', value: 12 },
      size: { units: 'Pixels', value: 18 }, opacity: 0.5,
      choke: { units: 'Pixels', value: 50 },
      contour: { curve: [{ x: 0, y: 0 }, { x: 255, y: 255 }] }
    });
    expect(decodedGroup?.name).toBe('Artwork');
    expect(decodedGroup?.children?.[0]?.text).toMatchObject({
      text: 'Text', shapeType: 'point', transform: [0, -1, 1, 0, 180, 90]
    });
    expect(decodedGroup?.children?.[1]?.vectorMask?.paths.length).toBeGreaterThan(0);
    expect(decodedGroup?.children?.[1]?.vectorStroke).toMatchObject({
      strokeEnabled: true, fillEnabled: true,
      lineWidth: { units: 'Pixels', value: 3 }
    });
  });

  it('uses stable unique numeric ids', () => {
    const document = createImageDocument('IDs', 2, 2, 'background');
    const projection = projectDocumentToPsd(document, pixels(2, 2), [{
      layerId: document.layers[0]!.id as LayerId, pixels: pixels(2, 2)
    }]);
    expect(projection.psd.children?.[0]?.id).toBeTypeOf('number');
    expect(projection.psd.children?.[0]?.id).not.toBe(0);
  });

  it('keeps stroke-only vectors editable as Photoshop shape layers', () => {
    const document = createImageDocument('No fill', 100, 100, 'background');
    const shape = createVectorLiveShape('ellipse', { kind: 'ellipse', width: 40, height: 30 });
    shape.style = {
      fill: null,
      stroke: {
        paint: { type: 'solid', color: [1, 0, 0, 1] },
        width: 2, cap: 'round', join: 'round', miterLimit: 4,
        dash: [], dashOffset: 0
      },
      opacity: 1
    };
    document.layers.push(createVectorLayer([shape], 'Outline'));
    const projection = projectDocumentToPsd(document, pixels(100, 100), []);
    const encoded = writePsdUint8Array(projection.psd, {
      noBackground: true, trimImageData: true, invalidateTextLayers: false
    });
    const decoded = readPsd(encoded, {
      useImageData: true, skipLayerImageData: true,
      skipCompositeImageData: true, skipThumbnail: true
    });
    const outline = decoded.children?.[1];
    expect(outline?.vectorFill).toMatchObject({ type: 'color' });
    expect(outline?.vectorStroke).toMatchObject({
      strokeEnabled: true,
      fillEnabled: false
    });
    expect(outline?.vectorMask?.paths.length).toBeGreaterThan(0);
    expect(outline?.usingAlignedRendering).toBe(true);
  });

  it('reports Smart Objects instead of silently claiming editable parity', () => {
    const document = createImageDocument('Smart', 2, 2, 'background');
    const layer = document.layers[0]!;
    layer.photoshop = {
      sourceKind: 'smart-object', sourceBlendMode: 'normal',
      bounds: { x: 0, y: 0, width: 2, height: 2 },
      mask: null, effects: null, adjustment: null,
      preserved: {
        text: null, placedLayer: { id: 'smart-source' }, vectorFill: null,
        vectorMask: null, vectorStroke: null, realMask: null
      }
    };
    const projection = projectDocumentToPsd(document, pixels(2, 2), [{
      layerId: layer.id, pixels: pixels(2, 2)
    }]);
    expect(projection.warnings).toContain(
      'layers[0]: Smart Object source data is not embedded by the PSD writer yet.'
    );
  });
});
