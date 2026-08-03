import { describe, expect, it } from 'vitest';
import {
  createDefaultTextLayerData,
  createPositionedTextFixture,
  type TextLayerData
} from '@lighttable/text-core';
import {
  createAnchor,
  createSubpath,
  createVectorLiveShape,
  createVectorPath
} from '@lighttable/vector-core';
import { createDefaultAdjustments } from '../../types';
import { createAdjustmentStackFromBasicAdjustments } from '../../processing/adjustmentStack';
import {
  createImageDocument,
  createVectorLayer,
  type DocumentFontAsset,
  type DocumentAssetId
} from '../document/documentTypes';
import {
  addLayerMask,
  createAdjustmentLayer,
  createGroupLayer,
  createRasterLayer,
  createTextLayer,
  moveLayerIntoGroup,
  replaceTextLayerWithVectorPaths,
  setLayerClipping,
  setLayerFillOpacity,
  setLayerLock,
  setLayerMaskProperties,
  setLayerTransform,
  setRasterLayerAdjustmentStack
} from '../document/documentCommands';
import { translationMatrix } from '../tools/transform/affine';
import { findDocumentLayer, findRasterLayer, walkRasterLayers } from '../document/layerTree';
import { buildLayeredDocumentFile, parseLayeredDocumentFile } from './layeredDocumentFormat';
import { addLayerStyle, updateLayerStyle } from '../styles/layerStyleCommands';
import { fingerprintFontBytes } from '../../text/fonts/DocumentFontRegistry';
import {
  addWarpNodeToStack,
  createWarpModuleInstance,
  findWarpModuleInstance,
  readWarpNodeSettings
} from '../../effects/warp/warpTypes';

const pngBytes = (base64: string) => Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
const PREVIEW_PNG = pngBytes('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVR4nGMQ0bD5D8IMMAYALyQF3SWgr78AAAAASUVORK5CYII=');
const BACKGROUND_PNG = pngBytes('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVR4nGO4I6fxH4QZYAwAS9AIhQrLPXUAAAAASUVORK5CYII=');
const OVERLAY_PNG = pngBytes('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVR4nGOQi/rQAMIMMAYAQToHoeVM9ZsAAAAASUVORK5CYII=');
const defaultStack = () => createAdjustmentStackFromBasicAdjustments(createDefaultAdjustments());

const readManifest = async (file: Blob): Promise<Record<string, unknown>> => {
  const footer = await file.slice(file.size - 12).arrayBuffer();
  const manifestLength = new DataView(footer).getUint32(8, true);
  const manifestStart = file.size - 12 - manifestLength;
  return JSON.parse(await file.slice(manifestStart, file.size - 12).text()) as Record<string, unknown>;
};

const rewriteManifest = async (
  file: Blob,
  change: (manifest: Record<string, unknown>) => void
): Promise<Blob> => {
  const footer = await file.slice(file.size - 12).arrayBuffer();
  const manifestLength = new DataView(footer).getUint32(8, true);
  const manifestStart = file.size - 12 - manifestLength;
  const manifest = await readManifest(file);
  change(manifest);
  const bytes = new TextEncoder().encode(JSON.stringify(manifest));
  const nextFooter = new Uint8Array(12);
  nextFooter.set(new TextEncoder().encode('LTBLDOC1'));
  new DataView(nextFooter.buffer).setUint32(8, bytes.byteLength, true);
  return new Blob([file.slice(0, manifestStart), bytes, nextFooter], { type: file.type });
};

describe('LightTable layered PNG format', () => {
  it('round-trips flow and positioned text, masks, nesting and compatible future fields', async () => {
    const baseFlow = createDefaultTextLayerData();
    if (baseFlow.source.kind !== 'flow') throw new Error('Expected flow text fixture.');
    const baseFlowSource = baseFlow.source;
    const complexSegments = [
      ['Arabic \u0645\u0631\u062d\u0628\u0627 | ', 'Noto Kufi Arabic'],
      ['Hebrew \u05e9\u05dc\u05d5\u05dd | ', 'Noto Sans Hebrew'],
      ['Devanagari \u0928\u092e\u0938\u094d\u0924\u0947 | ', 'Noto Sans Devanagari'],
      ['Thai \u0e20\u0e32\u0e29\u0e32\u0e44\u0e17\u0e22 | ', 'Noto Sans Thai'],
      ['CJK \u65e5\u672c\u8a9e\u4e2d\u6587 | ', 'Noto Sans CJK JP'],
      ['Emoji \ud83d\ude00 | ', 'Noto Emoji'],
      ['Combining A\u0301', 'Source Serif 4']
    ] as const;
    const complexText = complexSegments.map(([text]) => text).join('');
    let runStart = 0;
    const complexRuns = complexSegments.map(([text, family]) => {
      const run = {
        ...baseFlowSource.styleRuns[0]!,
        start: runStart,
        end: runStart + text.length,
        requestedFont: { families: [family] }
      };
      runStart = run.end;
      return run;
    });
    const flowFixture = {
      ...baseFlow,
      source: {
        ...baseFlowSource,
        text: complexText,
        styleRuns: complexRuns,
        layout: {
          mode: 'path' as const,
          pathLayerId: 'vector-layer',
          pathElementId: 'curve-a',
          pathSubpathId: 'contour-a',
          startOffset: 12,
          side: 'left' as const,
          upright: true
        },
        paragraphRuns: baseFlowSource.paragraphRuns.map((run) => ({
          ...run, start: 0, end: complexText.length
        }))
      },
      futureTextMetadata: { producer: 'future-compatible' }
    } as TextLayerData;
    const withFlow = createTextLayer(
      createImageDocument('Text fixture', 2, 2, 'source'),
      flowFixture,
      'Headline'
    );
    const flowId = withFlow.activeLayerId!;
    const masked = addLayerMask(withFlow, flowId);
    const positionedFixture = {
      ...createPositionedTextFixture(),
      interchange: {
        format: 'pdf' as const,
        sourceObjectId: 'page-1-object-7',
        preservedFields: { renderingIntent: 'relative-colorimetric' }
      }
    };
    const withPositioned = createTextLayer(masked, positionedFixture, 'Imported PDF text');
    const positionedId = withPositioned.activeLayerId!;
    const withGroup = createGroupLayer(withPositioned, 'Imported objects');
    const groupId = withGroup.activeLayerId!;
    const grouped = moveLayerIntoGroup(withGroup, positionedId, groupId);
    const document = {
      ...grouped,
      photoshopImportReport: {
        warnings: ['Original Photoshop font is not embedded.'],
        compatibility: [{
          path: 'layers[1]',
          feature: 'text' as const,
          support: 'approximate' as const,
          reason: 'Editable text uses a resolved substitute font.',
          layerId: positionedId,
          editable: true,
          parity: {
            visual: 'approximate' as const,
            semantic: 'editable' as const,
            structural: 'native' as const,
            roundTrip: 'unsupported' as const
          }
        }]
      }
    };

    const file = buildLayeredDocumentFile(
      new Blob([PREVIEW_PNG], { type: 'image/png' }),
      document,
      defaultStack(),
      [{
        layerId: document.layers[0].id,
        pixels: new Blob([BACKGROUND_PNG], { type: 'image/png' }),
        mask: null
      }, {
        layerId: flowId,
        pixels: new Blob(),
        mask: new Blob([OVERLAY_PNG], { type: 'image/png' })
      }],
      'text-fixture.png'
    );
    const parsed = await parseLayeredDocumentFile(file);
    const flow = findDocumentLayer(parsed!.document, flowId);
    const positioned = findDocumentLayer(parsed!.document, positionedId);

    expect(flow?.type).toBe('text');
    expect(flow?.type === 'text' ? flow.text : null).toEqual(flowFixture);
    expect((flow?.type === 'text' ? flow.text : null) as TextLayerData & { futureTextMetadata?: unknown })
      .toHaveProperty('futureTextMetadata.producer', 'future-compatible');
    expect(flow?.mask).not.toBeNull();
    expect(positioned?.type === 'text' ? positioned.text : null).toEqual(positionedFixture);
    expect(parsed?.document.photoshopImportReport).toEqual(document.photoshopImportReport);
    expect(findDocumentLayer(parsed!.document, positionedId)?.id).toBe(positionedId);
    expect(await parsed!.assets.find(({ layerId }) => layerId === flowId)?.mask?.arrayBuffer())
      .toEqual(OVERLAY_PNG.buffer);

    const manifestText = JSON.stringify(await readManifest(file));
    expect(manifestText).not.toContain('realizedLayout');
    expect(manifestText).not.toContain('atlas');
    expect(manifestText).not.toContain('workerState');
  });

  it('opens legacy v1 files and rejects future manifest or text schema versions', async () => {
    const document = createTextLayer(
      createImageDocument('Text versioning', 2, 2, 'source'),
      createDefaultTextLayerData(),
      'Versioned text'
    );
    const file = buildLayeredDocumentFile(
      new Blob([PREVIEW_PNG], { type: 'image/png' }),
      document,
      defaultStack(),
      [{
        layerId: document.layers[0].id,
        pixels: new Blob([BACKGROUND_PNG], { type: 'image/png' }),
        mask: null
      }],
      'versions.png'
    );
    const futureManifest = await rewriteManifest(file, (manifest) => { manifest.version = 4; });
    const futureText = await rewriteManifest(file, (manifest) => {
      const layers = (manifest.document as { layers: Array<Record<string, unknown>> }).layers;
      const text = layers.find((layer) => layer.type === 'text')!.text as Record<string, unknown>;
      text.schemaVersion = 2;
    });
    const duplicateIds = await rewriteManifest(file, (manifest) => {
      const layers = (manifest.document as { layers: Array<Record<string, unknown>> }).layers;
      layers[1].id = layers[0].id;
    });
    await expect(parseLayeredDocumentFile(futureManifest)).rejects.toThrow(/not supported/);
    await expect(parseLayeredDocumentFile(futureText)).rejects.toThrow(/schemaVersion/);
    await expect(parseLayeredDocumentFile(duplicateIds)).rejects.toThrow(/duplicate layer IDs/);
    const legacyDocument = createImageDocument('Legacy', 2, 2, 'source');
    const legacyFile = buildLayeredDocumentFile(
      new Blob([PREVIEW_PNG], { type: 'image/png' }),
      legacyDocument,
      defaultStack(),
      [{ layerId: legacyDocument.layers[0].id, pixels: new Blob([BACKGROUND_PNG]), mask: null }],
      'legacy.png'
    );
    const v1 = await rewriteManifest(legacyFile, (manifest) => { manifest.version = 1; });
    await expect(parseLayeredDocumentFile(v1)).resolves.not.toBeNull();
  });

  it('round-trips a text-only layered document without inventing raster assets', async () => {
    const withText = createTextLayer(
      createImageDocument('Text only', 2, 2, 'source'),
      createDefaultTextLayerData(),
      'Only layer'
    );
    const text = findDocumentLayer(withText, withText.activeLayerId);
    if (text?.type !== 'text') throw new Error('Expected text fixture.');
    const document = { ...withText, layers: [text] };
    const file = buildLayeredDocumentFile(
      new Blob([PREVIEW_PNG], { type: 'image/png' }),
      document,
      defaultStack(),
      [],
      'text-only.png'
    );

    const parsed = await parseLayeredDocumentFile(file);
    expect(parsed?.document.layers).toHaveLength(1);
    expect(parsed?.document.layers[0]?.type).toBe('text');
    expect(parsed?.assets).toEqual([]);
  });

  it('persists shared font bytes once per fingerprint and validates them on open', async () => {
    const document = createImageDocument('Fonts', 2, 2, 'source');
    const bytes = new Uint8Array([0, 1, 0, 0, 70, 79, 78, 84]);
    const fingerprintSha256 = await fingerprintFontBytes(bytes);
    const base: DocumentFontAsset = {
      assetId: 'font-face-0',
      faceIndex: 0,
      fingerprintSha256,
      source: 'document',
      container: 'sfnt',
      outline: 'truetype',
      postScriptName: 'FixtureSans-Regular',
      embedding: { level: 'editable', noSubsetting: false, bitmapOnly: false },
      familyNames: ['Fixture Sans'],
      styleName: 'Regular',
      weight: 400,
      stretch: 100,
      italic: false,
      byteLength: bytes.byteLength
    };
    document.assets.fonts.push(base, {
      ...base,
      assetId: 'font-face-1',
      faceIndex: 1,
      styleName: 'Bold',
      weight: 700
    });
    const file = buildLayeredDocumentFile(
      new Blob([PREVIEW_PNG], { type: 'image/png' }),
      document,
      defaultStack(),
      [
        { layerId: document.layers[0].id, pixels: new Blob([BACKGROUND_PNG]), mask: null },
        { fingerprintSha256, source: new Blob([bytes]) }
      ],
      'fonts.png'
    );

    const parsed = await parseLayeredDocumentFile(file);
    expect(parsed?.document.assets.fonts).toEqual(document.assets.fonts);
    expect(parsed?.fontAssets).toHaveLength(1);
    expect(new Uint8Array(await parsed!.fontAssets[0].source.arrayBuffer())).toEqual(bytes);
    const manifest = await readManifest(file);
    const fonts = (manifest.document as { fonts: Array<{ asset: { offset: number; length: number } }> }).fonts;
    expect(fonts[0].asset).toEqual(fonts[1].asset);

    const v2 = await rewriteManifest(file, (current) => { current.version = 2; });
    expect((await parseLayeredDocumentFile(v2))?.document.assets.fonts).toEqual([]);

    const oversized = await rewriteManifest(file, (current) => {
      const [font] = (current.document as { fonts: Array<Record<string, unknown>> }).fonts;
      font.byteLength = 64 * 1024 * 1024 + 1;
    });
    await expect(parseLayeredDocumentFile(oversized)).rejects.toThrow(/64 MiB font limit/);

    const cumulative = await rewriteManifest(file, (current) => {
      const documentManifest = current.document as { fonts: Array<Record<string, unknown>> };
      const baseFont = documentManifest.fonts[0];
      documentManifest.fonts = [1, 2, 3, 4, 5].map((value) => ({
        ...structuredClone(baseFont),
        assetId: `budget-face-${value}`,
        fingerprintSha256: String(value).repeat(64),
        byteLength: 60 * 1024 * 1024
      }));
    });
    await expect(parseLayeredDocumentFile(cumulative)).rejects.toThrow(/256 MiB font limit/);

    const offset = fonts[0].asset.offset;
    const corrupted = new Blob([
      file.slice(0, offset),
      new Uint8Array([bytes[0] ^ 0xff]),
      file.slice(offset + 1)
    ], { type: file.type });
    await expect(parseLayeredDocumentFile(corrupted)).rejects.toThrow(/SHA-256/);
  });

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
    let document = createRasterLayer(createImageDocument('Pixel roundtrip', 2, 2, 'source'));
    const localStack = defaultStack();
    const localLight = localStack.modules.find((module) => module.type === 'lt.light');
    if (!localLight) throw new Error('Light module missing');
    localLight.settings.exposureEV = 0.75;
    localLight.revision += 1;
    localStack.revision += 1;
    document = setRasterLayerAdjustmentStack(document, document.activeLayerId!, localStack);
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
    expect(findRasterLayer(parsed!.document, document.activeLayerId!)?.adjustmentStack)
      .toEqual(localStack);
  });

  it('round-trips a non-destructive Warp recipe without baking its pixels', async () => {
    let document = createImageDocument('Warp roundtrip', 2, 2, 'source');
    const layerId = document.activeLayerId!;
    const stack = addWarpNodeToStack(
      defaultStack(),
      createWarpModuleInstance('warp-module', {
        version: 1,
        opacity: 0.8,
        borderMode: 'mirror',
        topologyMode: 'protected',
        edgePinning: 0.25,
        maskLinkMode: 'linked',
        strokes: [{
          id: 'warp-stroke',
          mode: 'push',
          settings: {
            diameterPx: 180,
            strength: 0.42,
            hardness: 0.7,
            flow: 0.55,
            spacing: 0.08,
            pressureSize: true,
            pressureStrength: true
          },
          samples: [{
            positionPx: [0.5, 0.75],
            deltaPx: [0, 0],
            pressure: 0.6,
            tilt: [0.1, -0.2],
            timeMs: 10
          }, {
            positionPx: [1.25, 1.5],
            deltaPx: [0.75, 0.75],
            pressure: 0.8,
            tilt: [0.15, -0.1],
            timeMs: 24
          }],
          startedAtMs: 10,
          durationMs: 14
        }]
      })
    );
    document = setRasterLayerAdjustmentStack(document, layerId, stack);
    const file = buildLayeredDocumentFile(
      new Blob([PREVIEW_PNG], { type: 'image/png' }),
      document,
      defaultStack(),
      [{
        layerId,
        pixels: new Blob([BACKGROUND_PNG], { type: 'image/png' }),
        mask: null
      }],
      'warp-roundtrip.png'
    );

    const parsed = await parseLayeredDocumentFile(file);
    const parsedLayer = parsed && findRasterLayer(parsed.document, layerId);
    const parsedWarp = parsedLayer && findWarpModuleInstance(parsedLayer.adjustmentStack);

    expect(parsedWarp).not.toBeNull();
    expect(readWarpNodeSettings(parsedWarp!)).toEqual(
      readWarpNodeSettings(findWarpModuleInstance(stack)!)
    );
    expect(new Uint8Array(await parsed!.assets[0].pixels.arrayBuffer()))
      .toEqual(BACKGROUND_PNG);
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

  it('round-trips native vector layers without rasterizing paths or live shapes', async () => {
    const source = createImageDocument('Native vector', 2, 2, 'source');
    const path = createVectorPath('path-logo', 'Logo', [
      createSubpath('subpath-logo', [
        createAnchor('anchor-a', { x: 0.25, y: 0.25 }),
        createAnchor('anchor-b', { x: 1.75, y: 0.25 }),
        createAnchor('anchor-c', { x: 1, y: 1.75 })
      ], true)
    ]);
    path.style.fill = { type: 'solid', color: [0.1, 0.25, 0.8, 0.75] };
    path.transform = translationMatrix(3, -2);
    path.transformRevision = 1;
    const shape = createVectorLiveShape('shape-badge', {
      kind: 'rectangle',
      width: 1.5,
      height: 0.75,
      cornerRadii: [0.1, 0.2, 0.1, 0.2],
      linkedCorners: false
    }, 'Editable badge');
    shape.transform = translationMatrix(-1, 4);
    shape.transformRevision = 1;
    const vector = createVectorLayer([path, shape], 'Logo shape');
    vector.antiAlias = false;
    const document = {
      ...source,
      layers: [...source.layers, vector],
      activeLayerId: vector.id,
      revision: source.revision + 1
    };
    const file = buildLayeredDocumentFile(
      new Blob([PREVIEW_PNG], { type: 'image/png' }),
      document,
      defaultStack(),
      [{
        layerId: source.layers[0].id,
        pixels: new Blob([BACKGROUND_PNG], { type: 'image/png' }),
        mask: null
      }],
      'native-vector.png'
    );

    const parsed = await parseLayeredDocumentFile(file);
    const parsedVector = parsed?.document.layers.find((layer) => layer.id === vector.id);

    expect(parsedVector?.type).toBe('vector');
    expect(parsedVector?.type === 'vector' ? parsedVector.elements : null).toEqual([path, shape]);
    expect(parsedVector?.type === 'vector' ? parsedVector.elements[1]?.type : null)
      .toBe('live-shape');
    expect(parsedVector?.type === 'vector' ? parsedVector.antiAlias : null).toBe(false);
    expect(parsed?.assets.map((asset) => asset.layerId)).toEqual([source.layers[0].id]);
  });

  it('reopens converted text as editable glyph paths without restoring text semantics', async () => {
    const source = createImageDocument('Converted title', 2, 2, 'source');
    const withText = createTextLayer(
      source,
      createDefaultTextLayerData(),
      'Editable title'
    );
    const textLayerId = withText.activeLayerId!;
    const glyph = createVectorPath('glyph-title-a', 'A', [
      createSubpath('glyph-title-a-outer', [
        createAnchor('glyph-title-a-1', { x: 0.1, y: 1.8 }),
        createAnchor('glyph-title-a-2', { x: 1, y: 0.1 }),
        createAnchor('glyph-title-a-3', { x: 1.9, y: 1.8 })
      ], true)
    ]);
    glyph.style.fill = { type: 'solid', color: [0.85, 0.2, 0.4, 1] };
    glyph.style.stroke = {
      paint: { type: 'solid', color: [0.1, 0.05, 0.08, 1] },
      width: 0.08,
      cap: 'round',
      join: 'round',
      miterLimit: 4,
      dash: [],
      dashOffset: 0
    };
    const converted = replaceTextLayerWithVectorPaths(withText, textLayerId, [glyph]);
    const file = buildLayeredDocumentFile(
      new Blob([PREVIEW_PNG], { type: 'image/png' }),
      converted,
      defaultStack(),
      [{
        layerId: source.layers[0].id,
        pixels: new Blob([BACKGROUND_PNG], { type: 'image/png' }),
        mask: null
      }],
      'converted-title.png'
    );

    const parsed = await parseLayeredDocumentFile(file);
    const reopened = parsed ? findDocumentLayer(parsed.document, textLayerId) : null;

    expect(reopened?.type).toBe('vector');
    expect(reopened?.type === 'vector' ? reopened.elements : null).toEqual([glyph]);
    expect(reopened && 'text' in reopened).toBe(false);
    expect(parsed?.document.activeLayerId).toBe(textLayerId);
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
