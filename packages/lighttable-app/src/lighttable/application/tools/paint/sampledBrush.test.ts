import { describe, expect, it } from 'vitest';
import {
  createGroupLayer,
  createImageDocument,
  type RasterLayer
} from '../../../editor/document/documentTypes';
import { SampledBrushSourceController } from './sampledBrush';
import { sampledBrushSourceDocument } from '../../../editor/document/sampledBrushSourceDocument';
import { clampHealingDiffusion } from '../../../editor/tools/paint/sampledBrushTypes';

describe('SampledBrushSourceController', () => {
  const raster = (name: string): RasterLayer => ({
    ...(createImageDocument(name, 100, 80, name).layers[0] as RasterLayer),
    name
  });

  it('retains the Alt-click layer while painting to another layer', () => {
    const sourceLayer = raster('Source');
    const targetLayer = raster('Target');
    const document = { ...createImageDocument('Document', 100, 80, 'background'), layers: [sourceLayer, targetLayer] };
    const controller = new SampledBrushSourceController();
    controller.setSource(document, sourceLayer, { x: 12, y: 18 });
    const plan = controller.beginStroke('clone-stamp', document, { x: 40, y: 50 }, {
      aligned: true,
      sampleMode: 'current',
      diffusion: 5,
      healingHardness: 0,
      healingOpacity: 1
    });
    expect(plan).toMatchObject({
      source: { anchorLayerId: sourceLayer.id },
      sourceOffset: { x: -28, y: -32 }
    });
  });

  it('retains an aligned offset and resets an unaligned stroke to its source', () => {
    const layer = raster('Source');
    const document = { ...createImageDocument('Document', 100, 80, 'background'), layers: [layer] };
    const controller = new SampledBrushSourceController();
    controller.setSource(document, layer, { x: 10, y: 20 });
    expect(controller.beginStroke('clone-stamp', document, { x: 30, y: 40 }, {
      aligned: true, sampleMode: 'current', diffusion: 5,
      healingHardness: 0, healingOpacity: 1
    })?.sourceOffset).toEqual({ x: -20, y: -20 });
    expect(controller.beginStroke('clone-stamp', document, { x: 70, y: 60 }, {
      aligned: true, sampleMode: 'current', diffusion: 5,
      healingHardness: 0, healingOpacity: 1
    })?.sourceOffset).toEqual({ x: -20, y: -20 });
    expect(controller.beginStroke('clone-stamp', document, { x: 70, y: 60 }, {
      aligned: false, sampleMode: 'current', diffusion: 5,
      healingHardness: 0, healingOpacity: 1
    })?.sourceOffset).toEqual({ x: -60, y: -40 });
  });
});

describe('Healing Brush diffusion', () => {
  it('keeps the public control on the discrete Photoshop-compatible 1-7 scale', () => {
    expect(clampHealingDiffusion(-10)).toBe(1);
    expect(clampHealingDiffusion(4.6)).toBe(5);
    expect(clampHealingDiffusion(99)).toBe(7);
    expect(clampHealingDiffusion(Number.NaN)).toBe(5);
  });
});

describe('sampledBrushSourceDocument', () => {
  const raster = (name: string): RasterLayer => ({
    ...(createImageDocument(name, 100, 80, name).layers[0] as RasterLayer),
    name
  });

  it('preserves ancestry for Current and includes lower siblings for Current & Below', () => {
    const lower = raster('Lower');
    const source = raster('Source');
    const upper = raster('Upper');
    const group = { ...createGroupLayer('Group'), children: [lower, source, upper] };
    const rootBelow = raster('Root below');
    const rootAbove = raster('Root above');
    const document = {
      ...createImageDocument('Document', 100, 80, 'background'),
      layers: [rootBelow, group, rootAbove]
    };
    const descriptor = {
      documentId: document.id,
      anchorLayerId: source.id,
      point: { x: 1, y: 2 }
    };
    const current = sampledBrushSourceDocument(document, descriptor, 'current');
    expect(current?.layers).toHaveLength(1);
    expect(current?.layers[0]?.type === 'group' ? current.layers[0].children.map(({ name }) => name) : [])
      .toEqual(['Source']);
    const below = sampledBrushSourceDocument(document, descriptor, 'current-and-below');
    expect(below?.layers.map(({ name }) => name)).toEqual(['Root below', 'Group']);
    expect(below?.layers[1]?.type === 'group' ? below.layers[1].children.map(({ name }) => name) : [])
      .toEqual(['Lower', 'Source']);
  });
});
