import { describe, expect, it } from 'vitest';
import { createDefaultAdjustments } from '../../types';
import { createAdjustmentStackFromBasicAdjustments } from '../../processing/adjustmentStack';
import { createImageDocument, type DocumentAssetId } from '../document/documentTypes';
import {
  addLayerMask,
  createAdjustmentLayer,
  createGroupLayer,
  createRasterLayer,
  moveLayerIntoGroup,
  setLayerClipping,
  setLayerFillOpacity,
  setLayerLock,
  setLayerMaskProperties,
  setLayerTransform
} from '../document/documentCommands';
import { translationMatrix } from '../tools/transform/affine';
import { findDocumentLayer, findRasterLayer, walkRasterLayers } from '../document/layerTree';
import { buildLayeredDocumentFile, parseLayeredDocumentFile } from './layeredDocumentFormat';
import { addLayerStyle, updateLayerStyle } from '../styles/layerStyleCommands';

const pngBytes = (base64: string) => Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
const PREVIEW_PNG = pngBytes('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVR4nGMQ0bD5D8IMMAYALyQF3SWgr78AAAAASUVORK5CYII=');
const BACKGROUND_PNG = pngBytes('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVR4nGO4I6fxH4QZYAwAS9AIhQrLPXUAAAAASUVORK5CYII=');
const OVERLAY_PNG = pngBytes('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVR4nGOQi/rQAMIMMAYAQToHoeVM9ZsAAAAASUVORK5CYII=');
const defaultStack = () => createAdjustmentStackFromBasicAdjustments(createDefaultAdjustments());

describe('LightTable layered PNG format', () => {
  it('retains the original Photoshop document byte-exact as a preserved source asset', async () => {
    const document = createImageDocument('PSD source', 2, 2, 'source');
    const sourceId = 'source-photoshop-1' as DocumentAssetId;
    const psdBytes = new Uint8Array([56, 66, 80, 83, 0, 1, 2, 3, 4]);
    document.assets.preservedSources.push({
      id: sourceId,
      kind: 'photoshop-document',
      name: 'fixture.psd',
      mediaType: 'image/vnd.adobe.photoshop',
      byteLength: psdBytes.byteLength
    });
    const file = buildLayeredDocumentFile(
      new Blob([PREVIEW_PNG], { type: 'image/png' }),
      document,
      defaultStack(),
      [
        {
          layerId: document.layers[0].id,
          pixels: new Blob([BACKGROUND_PNG], { type: 'image/png' }),
          mask: null
        },
        {
          sourceId,
          source: new Blob([psdBytes], { type: 'image/vnd.adobe.photoshop' })
        }
      ],
      'psd-source.png'
    );

    const parsed = await parseLayeredDocumentFile(file);

    expect(parsed?.document.assets.preservedSources).toEqual(document.assets.preservedSources);
    expect(parsed?.preservedSourceAssets).toHaveLength(1);
    expect(new Uint8Array(await parsed!.preservedSourceAssets[0].source.arrayBuffer()))
      .toEqual(psdBytes);
  });

  it('round-trips shared pattern registry metadata and source bytes', async () => {
    const document = createImageDocument('Pattern document', 2, 2, 'source');
    const patternId = 'pattern-native-1' as DocumentAssetId;
    document.assets.patterns.push({
      id: patternId,
      name: 'Woven',
      width: 2,
      height: 2,
      revision: 0
    });
    const patternSource = new Blob([OVERLAY_PNG], { type: 'image/png' });
    const file = buildLayeredDocumentFile(
      new Blob([PREVIEW_PNG], { type: 'image/png' }),
      document,
      defaultStack(),
      [
        {
          layerId: document.layers[0].id,
          pixels: new Blob([BACKGROUND_PNG], { type: 'image/png' }),
          mask: null
        },
        { patternId, source: patternSource }
      ],
      'pattern.png'
    );

    const parsed = await parseLayeredDocumentFile(file);

    expect(parsed?.document.assets.patterns).toEqual(document.assets.patterns);
    expect(parsed?.patternAssets).toHaveLength(1);
    expect(parsed?.patternAssets[0].patternId).toBe(patternId);
    expect(new Uint8Array(await parsed!.patternAssets[0].source.arrayBuffer())).toEqual(OVERLAY_PNG);
  });

  it('keeps a PNG preview and restores layer metadata and binary assets', async () => {
    let document = createRasterLayer(createImageDocument('Test', 64, 32, 'source'));
    const styledLayerId = document.activeLayerId!;
    document = addLayerStyle(document, styledLayerId, 'drop-shadow');
    const shadowId = findDocumentLayer(document, styledLayerId)!.styleStack.effects[0].id;
    document = updateLayerStyle(document, styledLayerId, shadowId, (effect) => ({
      ...effect,
      opacity: 0.42
    }));
    const assets = document.layers.map((layer, index) => ({
      layerId: layer.id,
      pixels: new Blob([new Uint8Array([index + 1, 2, 3])], { type: 'image/png' }),
      mask: null
    }));
    const preview = new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' });
    const adjustmentStack = defaultStack();
    const light = adjustmentStack.modules.find((module) => module.type === 'lt.light');
    if (!light) throw new Error('Light module missing');
    light.settings.exposureEV = 1.5;
    light.revision += 1;
    adjustmentStack.revision += 1;
    const file = buildLayeredDocumentFile(preview, document, adjustmentStack, assets, 'image.png');
    expect(file.name).toBe('image.lighttable.png');
    expect(new Uint8Array(await file.slice(0, 4).arrayBuffer())).toEqual(new Uint8Array([137, 80, 78, 71]));
    const parsed = await parseLayeredDocumentFile(file);
    expect(parsed?.document.layers.map((layer) => layer.name)).toEqual(document.layers.map((layer) => layer.name));
    expect(findDocumentLayer(parsed!.document, styledLayerId)?.styleStack.effects[0]).toMatchObject({
      id: shadowId,
      kind: 'drop-shadow',
      opacity: 0.42
    });
    expect(parsed?.adjustmentStack).toEqual(adjustmentStack);
    expect(parsed?.assets).toHaveLength(2);
    expect(new Uint8Array(await parsed!.assets[1].pixels.arrayBuffer())).toEqual(new Uint8Array([2, 2, 3]));
  });

  it('keeps distinct real PNG preview and layer payloads byte-exact', async () => {
    const document = createRasterLayer(createImageDocument('Pixel roundtrip', 2, 2, 'source'));
    const assets = [
      { layerId: document.layers[0].id, pixels: new Blob([BACKGROUND_PNG], { type: 'image/png' }), mask: null },
      { layerId: document.layers[1].id, pixels: new Blob([OVERLAY_PNG], { type: 'image/png' }), mask: null }
    ];
    const file = buildLayeredDocumentFile(
      new Blob([PREVIEW_PNG], { type: 'image/png' }),
      document,
      defaultStack(),
      assets,
      'pixel-roundtrip.png'
    );

    const parsed = await parseLayeredDocumentFile(file);

    expect(parsed).not.toBeNull();
    expect(new Uint8Array(await parsed!.preview.arrayBuffer())).toEqual(PREVIEW_PNG);
    expect(parsed!.assets.map((asset) => asset.layerId)).toEqual(document.layers.map((layer) => layer.id));
    expect(new Uint8Array(await parsed!.assets[0].pixels.arrayBuffer())).toEqual(BACKGROUND_PNG);
    expect(new Uint8Array(await parsed!.assets[1].pixels.arrayBuffer())).toEqual(OVERLAY_PNG);
    expect(parsed!.assets[0].pixels.size).toBe(BACKGROUND_PNG.byteLength);
    expect(parsed!.assets[1].pixels.size).toBe(OVERLAY_PNG.byteLength);
  });

  it('round-trips nested groups and their raster assets', async () => {
    const base = createImageDocument('Grouped', 2, 2, 'source');
    const withPaint = createRasterLayer(base, 'Paint');
    const paintId = withPaint.activeLayerId!;
    const withGroup = createGroupLayer(withPaint, 'Retouch');
    const groupId = withGroup.activeLayerId!;
    const document = moveLayerIntoGroup(withGroup, paintId, groupId);
    const assets = walkRasterLayers(document.layers).map(({ layer }, index) => ({
      layerId: layer.id,
      pixels: new Blob([index === 0 ? BACKGROUND_PNG : OVERLAY_PNG], { type: 'image/png' }),
      mask: null
    }));

    const file = buildLayeredDocumentFile(
      new Blob([PREVIEW_PNG], { type: 'image/png' }),
      document,
      defaultStack(),
      assets,
      'grouped.png'
    );
    const parsed = await parseLayeredDocumentFile(file);
    const group = parsed ? findDocumentLayer(parsed.document, groupId) : null;

    expect(group?.type).toBe('group');
    expect(group?.type === 'group' ? group.children.map((layer) => layer.id) : []).toEqual([paintId]);
    expect(parsed?.assets.map((asset) => asset.layerId)).toEqual(
      walkRasterLayers(document.layers).map(({ layer }) => layer.id)
    );
  });

  it('round-trips a group mask as a mask-only asset', async () => {
    const source = createImageDocument('Masked group', 2, 2, 'source');
    const withGroup = createGroupLayer(source, 'Masked');
    const groupId = withGroup.activeLayerId!;
    const document = setLayerMaskProperties(
      addLayerMask(withGroup, groupId),
      groupId,
      { density: 0.42, feather: 8.5 }
    );
    const mask = new Blob([OVERLAY_PNG], { type: 'image/png' });
    const file = buildLayeredDocumentFile(
      new Blob([PREVIEW_PNG], { type: 'image/png' }),
      document,
      defaultStack(),
      [
        {
          layerId: source.layers[0].id,
          pixels: new Blob([BACKGROUND_PNG], { type: 'image/png' }),
          mask: null
        },
        {
          layerId: groupId,
          pixels: new Blob(),
          mask
        }
      ],
      'masked-group.png'
    );

    const parsed = await parseLayeredDocumentFile(file);
    const parsedGroup = parsed ? findDocumentLayer(parsed.document, groupId) : null;
    const parsedAsset = parsed?.assets.find((asset) => asset.layerId === groupId);

    expect(parsedGroup?.type).toBe('group');
    expect(parsedGroup?.mask?.id).toBe(findDocumentLayer(document, groupId)?.mask?.id);
    expect(parsedGroup?.mask).toMatchObject({ density: 0.42, feather: 8.5 });
    expect(parsedAsset?.pixels.size).toBe(0);
    expect(new Uint8Array(await parsedAsset!.mask!.arrayBuffer())).toEqual(OVERLAY_PNG);
  });

  it('round-trips an adjustment-layer mask as a mask-only asset', async () => {
    const source = createImageDocument('Masked grade', 2, 2, 'source');
    const withGrade = createAdjustmentLayer(source, defaultStack(), 'Grade');
    const gradeId = withGrade.activeLayerId!;
    const document = addLayerMask(withGrade, gradeId);
    const mask = new Blob([OVERLAY_PNG], { type: 'image/png' });
    const file = buildLayeredDocumentFile(
      new Blob([PREVIEW_PNG], { type: 'image/png' }),
      document,
      defaultStack(),
      [
        {
          layerId: source.layers[0].id,
          pixels: new Blob([BACKGROUND_PNG], { type: 'image/png' }),
          mask: null
        },
        {
          layerId: gradeId,
          pixels: new Blob(),
          mask
        }
      ],
      'masked-grade.png'
    );

    const parsed = await parseLayeredDocumentFile(file);
    const parsedGrade = parsed ? findDocumentLayer(parsed.document, gradeId) : null;
    const parsedAsset = parsed?.assets.find((asset) => asset.layerId === gradeId);

    expect(parsedGrade?.type).toBe('adjustment');
    expect(parsedGrade?.mask?.id).toBe(findDocumentLayer(document, gradeId)?.mask?.id);
    expect(parsedAsset?.pixels.size).toBe(0);
    expect(new Uint8Array(await parsedAsset!.mask!.arrayBuffer())).toEqual(OVERLAY_PNG);
  });

  it('round-trips multiple independent adjustment stacks in layer order', async () => {
    const cool = createDefaultAdjustments();
    cool.temperature = -42;
    const warm = createDefaultAdjustments();
    warm.temperature = 61;
    const source = createImageDocument('Stacked grades', 2, 2, 'source');
    const withCool = createAdjustmentLayer(
      source,
      createAdjustmentStackFromBasicAdjustments(cool),
      'Cool'
    );
    const document = createAdjustmentLayer(
      withCool,
      createAdjustmentStackFromBasicAdjustments(warm),
      'Warm',
      withCool.activeLayerId ?? undefined
    );
    const file = buildLayeredDocumentFile(
      new Blob([PREVIEW_PNG], { type: 'image/png' }),
      document,
      defaultStack(),
      [{
        layerId: source.layers[0].id,
        pixels: new Blob([BACKGROUND_PNG], { type: 'image/png' }),
        mask: null
      }],
      'stacked-grades.png'
    );

    const parsed = await parseLayeredDocumentFile(file);
    const grades = parsed?.document.layers.filter((layer) => layer.type === 'adjustment') ?? [];

    expect(grades.map((layer) => layer.name)).toEqual(['Cool', 'Warm']);
    expect(grades[0]?.type === 'adjustment'
      ? grades[0].adjustmentStack.modules.find((module) => module.type === 'lt.white-balance')?.settings.temperature
      : null).toBe(-42);
    expect(grades[1]?.type === 'adjustment'
      ? grades[1].adjustmentStack.modules.find((module) => module.type === 'lt.white-balance')?.settings.temperature
      : null).toBe(61);
  });

  it('round-trips normalized high-precision import provenance', async () => {
    const document = createImageDocument('16-bit source', 2, 2, 'source', {
      decoder: 'wasm-vips',
      sourceBitDepth: 16,
      sourceFormat: 'ushort',
      sourceInterpretation: 'rgb16',
      sourceProfile: 'no embedded ICC; assumed sRGB',
      normalizedColorSpace: 'linear-srgb'
    });
    const file = buildLayeredDocumentFile(
      new Blob([PREVIEW_PNG], { type: 'image/png' }),
      document,
      defaultStack(),
      [{ layerId: document.layers[0].id, pixels: new Blob([BACKGROUND_PNG], { type: 'image/png' }), mask: null }],
      'precision-source.png'
    );

    const parsed = await parseLayeredDocumentFile(file);

    expect(parsed?.document.importProvenance).toEqual(document.importProvenance);
  });

  it('round-trips authoritative layer transforms and geometry revisions', async () => {
    const source = createImageDocument('Transformed', 2, 2, 'source');
    const document = setLayerTransform(source, source.layers[0].id, translationMatrix(14, -3));
    const file = buildLayeredDocumentFile(
      new Blob([PREVIEW_PNG], { type: 'image/png' }),
      document,
      defaultStack(),
      [{ layerId: document.layers[0].id, pixels: new Blob([BACKGROUND_PNG], { type: 'image/png' }), mask: null }],
      'transformed.png'
    );

    const parsed = await parseLayeredDocumentFile(file);

    expect(parsed?.document.layers[0].transform).toEqual(translationMatrix(14, -3));
    expect(parsed?.document.layers[0].geometryRevision).toBe(1);
    expect(parsed ? findRasterLayer(parsed.document, parsed.document.layers[0].id)?.pixelRevision : null).toBe(0);
  });

  it('round-trips fill opacity, clipping and structured locks', async () => {
    const source = createImageDocument('Layer semantics', 2, 2, 'source');
    const layerId = source.layers[0].id;
    const document = setLayerLock(
      setLayerClipping(setLayerFillOpacity(source, layerId, 0.42), layerId, true),
      layerId,
      'position',
      true
    );
    const file = buildLayeredDocumentFile(
      new Blob([PREVIEW_PNG], { type: 'image/png' }),
      document,
      defaultStack(),
      [{ layerId, pixels: new Blob([BACKGROUND_PNG], { type: 'image/png' }), mask: null }],
      'layer-semantics.png'
    );

    const parsed = await parseLayeredDocumentFile(file);

    expect(parsed?.document.layers[0]).toMatchObject({
      fillOpacity: 0.42,
      clipping: true,
      locks: { transparency: false, pixels: false, position: true, all: false }
    });
  });

  it('treats a regular PNG as a non-layered image', async () => {
    expect(await parseLayeredDocumentFile(new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }))).toBeNull();
  });
});
