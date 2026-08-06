import {
  CONTRACT_FIXTURE_FONT_INSTANCE,
  TEXT_LAYOUT_SCHEMA_VERSION,
  createDefaultTextLayerData
} from '@lighttable/text-core';
import { describe, expect, it, vi } from 'vitest';
import {
  createImageDocument,
  createTextLayerNode,
  createVectorLayer,
  semanticLayerDependencyKey,
  type DocumentFontAsset
} from '../../editor/document/documentTypes';
import { createAnchor, createSubpath, createVectorPath } from '@lighttable/vector-core';
import { TextLayerRenderCoordinator, type TextFontRuntimePort } from './TextLayerRenderCoordinator';
import type { TextSourceCostSample } from './TextSourceCostModel';
import {
  setFlowTextContent,
  setFlowTextRuns,
  setTextLayerTransform
} from '../../editor/document/textLayerCommands';

const asset: DocumentFontAsset = {
  assetId: 'font-1',
  fingerprintSha256: 'a'.repeat(64),
  faceIndex: 0,
  postScriptName: 'Inter-Regular',
  source: 'document',
  container: 'sfnt',
  outline: 'truetype',
  embedding: { level: 'installable', noSubsetting: false, bitmapOnly: false },
  familyNames: ['Inter'],
  styleName: 'Regular',
  weight: 400,
  stretch: 100,
  italic: false,
  byteLength: 4
};

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

const harness = () => {
  let costObserver: ((sample: TextSourceCostSample) => void) | null = null;
  let tightSourcePublished = false;
  const publish = vi.fn(() => ({}));
  const discard = vi.fn();
  const prepareTightSource = vi.fn((_layout?: unknown, _layer?: unknown) => ({
    publish: () => { tightSourcePublished = true; return publish(); }, discard
  }));
  const prepareAtlasSource = vi.fn((_layout?: unknown, _layer?: unknown) => ({
    publish: () => { tightSourcePublished = false; return publish(); }, discard
  }));
  const renderer = {
    sync: vi.fn(),
    setVisibleLayerIds: vi.fn(),
    snapshot: vi.fn(() => ({
      publicationRevision: 0,
      textureBytes: 0,
      cacheBudgetBytes: 256 * 1024 * 1024
    })),
    dispose: vi.fn(),
    resolve: vi.fn(() => ({})),
    hasExactSource: vi.fn(() => true),
    isTransparent: vi.fn(() => false),
    markTransparent: vi.fn(() => false),
    release: vi.fn(() => false),
    publish: vi.fn(() => { tightSourcePublished = true; return true; }),
    thumbnailSource: vi.fn((_layerId?: unknown) => tightSourcePublished ? ({ texture: {} }) : null),
    setCostObserver: vi.fn((observer: ((sample: TextSourceCostSample) => void) | null) => {
      costObserver = observer;
    }),
    prepareAtlasSource,
    prepareTightSource
  };
  const client = {
    registerFontDetailed: vi.fn(async () => ({ metrics: {} })),
    realizeTextDetailed: vi.fn(async (_request?: unknown) => ({
      layout: { key: 'layout', glyphRuns: [] },
      metrics: {}, roundTripDurationMs: 0, responseTransferBytes: 0
    })),
    rasterizeGlyph: vi.fn(),
    releaseSession: vi.fn(async () => undefined)
  };
  const backend = {
    lookupGlyph: vi.fn(),
    prepareGlyph: vi.fn(),
    encode: vi.fn(),
    retainGlyphs: vi.fn(() => vi.fn()),
    metrics: vi.fn(() => ({
      allocatedBytes: 0, hits: 0, misses: 0, evictions: 0
    })),
    retireSubmittedResources: vi.fn(async () => undefined),
    dispose: vi.fn()
  };
  const outlineRepository = {
    resolve: vi.fn(async () => ({
      source: 'worker',
      outline: {
        unitsPerEm: 1_000,
        verbs: new Uint8Array([0, 1, 1, 4]),
        coordinates: new Float32Array([0, 0, 500, 1_000, 1_000, 0]),
        bounds: new Float32Array([0, 0, 1_000, 1_000])
      }
    })),
    clear: vi.fn()
  };
  const outlineSurface = {
    texture: {} as GPUTexture, width: 20, height: 20,
    sourceBounds: { x: 0, y: 0, width: 20, height: 20 },
    byteLength: 20 * 20 * 8,
    dispose: vi.fn()
  };
  const outlineBackend = {
    encodeTight: vi.fn(() => outlineSurface),
    notifySubmitted: vi.fn(async () => undefined),
    cacheMetrics: vi.fn(() => ({ entries: 1 })),
    dispose: vi.fn()
  };
  const submit = vi.fn();
  const onError = vi.fn();
  const coordinator = new TextLayerRenderCoordinator({
    device: {
      createCommandEncoder: vi.fn(() => ({ finish: vi.fn(() => ({})) })),
      queue: { submit }
    } as unknown as GPUDevice,
    renderer: renderer as never,
    requestRender: vi.fn(),
    onError,
    loadDependencies: vi.fn(async () => ({ client, backend } as never)),
    createOutlineRepository: vi.fn(() => outlineRepository as never),
    createOutlineBackend: vi.fn(() => outlineBackend as never)
  });
  const port: TextFontRuntimePort = {
    revision: 1,
    assets: [asset],
    bytes: vi.fn(async () => new Uint8Array([1, 2, 3, 4])),
    subscribe: vi.fn(() => () => undefined)
  };
  return {
    coordinator, renderer, client, backend, outlineRepository, outlineBackend,
    outlineSurface, submit, port, publish, discard, onError,
    observeCost: (sample: TextSourceCostSample) => costObserver?.(sample)
  };
};

describe('TextLayerRenderCoordinator', () => {
  it('feeds renderer work samples into the document-local source policy', () => {
    const state = harness();
    state.observeCost({
      phase: 'atlas-composite', durationMs: 0.5, glyphCount: 10, pixelCount: 100
    });
    expect(state.coordinator.snapshot().sourceDecisionMeasurements).toBe(1);
  });

  it('is inert without visible canonical text', async () => {
    const state = harness();
    state.coordinator.configureFonts(state.port);
    state.coordinator.sync(createImageDocument('Raster', 32, 24, 'source'));
    await flush();

    expect(state.client.registerFontDetailed).not.toHaveBeenCalled();
    expect(state.submit).not.toHaveBeenCalled();
  });

  it('shapes once and reprojects rigid glyphs when a referenced path changes', async () => {
    const state = harness();
    state.client.realizeTextDetailed.mockResolvedValue({
      layout: {
        schemaVersion: TEXT_LAYOUT_SCHEMA_VERSION,
        key: 'path-shaped',
        glyphRuns: [{
          font: CONTRACT_FIXTURE_FONT_INSTANCE, fontSize: 20,
          fontResolution: { kind: 'positioned-exact', sourceRunIndex: 0 },
          paint: { fill: { kind: 'solid', color: { colorSpace: 'srgb', r: 0, g: 0, b: 0, a: 1 } } },
          renderingMode: 'fill', direction: 'ltr',
          glyphIds: new Uint32Array([7]), clusters: new Uint32Array([0]),
          geometry: new Float32Array([0, 0, 10, 0])
        }],
        lines: [{
          start: 0, end: 1, baseline: 0, ascent: 16, descent: 4,
          bounds: { x: 0, y: -16, width: 10, height: 20 }
        }],
        caretStops: [
          { textOffset: 0, x: 0, y: -16, height: 20, affinity: 'downstream' },
          { textOffset: 1, x: 10, y: -16, height: 20, affinity: 'upstream' }
        ],
        selectionGeometry: [{
          start: 0, end: 1, bounds: { x: 0, y: -16, width: 10, height: 20 }
        }],
        clusterMap: [],
        inkBounds: { x: 0, y: -16, width: 10, height: 20 },
        logicalBounds: { x: 0, y: -16, width: 10, height: 20 }, warnings: []
      }, metrics: {}, roundTripDurationMs: 1, responseTransferBytes: 0
    } as never);
    const path = createVectorPath('path', 'Path', [createSubpath('contour', [
      createAnchor('start', { x: 0, y: 0 }),
      createAnchor('end', { x: 100, y: 0 })
    ])]);
    const vector = createVectorLayer([path], 'Path');
    vector.transform = { ...vector.transform, tx: 20 };
    const text = createTextLayerNode(createDefaultTextLayerData(), 'Path text');
    if (text.text.source.kind !== 'flow') throw new Error('Expected flow text fixture.');
    text.text = {
      ...text.text,
      source: {
        ...text.text.source,
        layout: {
          mode: 'path', pathLayerId: vector.id, pathElementId: 'path',
          pathSubpathId: 'contour', startOffset: 10, endOffset: 90,
          side: 'left', upright: true
        }
      }
    };
    const document = createImageDocument('Path text', 240, 120, 'source');
    document.layers = [vector, text];
    state.coordinator.configureFonts(state.port);
    state.coordinator.sync(document);
    await state.coordinator.waitForSettledSource(text.id);

    expect(state.client.realizeTextDetailed).toHaveBeenCalledWith(
      expect.objectContaining({
        pathDependencyRevision: 0,
        layer: expect.objectContaining({
          source: expect.objectContaining({
            layout: { mode: 'point', origin: { x: 0, y: 0 }, writingMode: 'horizontal-tb' }
          })
        })
      }),
      expect.any(AbortSignal)
    );
    const first = state.coordinator.editingLayout(text.id);
    expect(first?.path?.table.length).toBe(100);
    expect(first?.layout.glyphRuns[0]?.transforms).toEqual(new Float32Array([
      1, 0, 30, 0, 1, 0, 0, 0, 1
    ]));
    expect(state.renderer.publish).toHaveBeenCalledWith(expect.objectContaining({
      layerId: text.id, mode: 'cached', sourceKey: expect.stringContaining(':path:')
    }));

    const canonicalPath = vector.elements[0];
    if (canonicalPath?.type !== 'path') throw new Error('Expected path fixture.');
    canonicalPath.subpaths[0]!.anchors[1]!.position.x = 200;
    canonicalPath.geometryRevision += 1;
    state.coordinator.sync(document);
    await state.coordinator.waitForSettledSource(text.id);

    expect(state.client.realizeTextDetailed).toHaveBeenCalledOnce();
    expect(state.coordinator.editingLayout(text.id)?.path?.table.length).toBe(200);
    expect(state.outlineBackend.encodeTight).toHaveBeenCalledTimes(2);
  });

  it('fails unresolved path text before worker shaping instead of drawing a linear fallback', async () => {
    const state = harness();
    const text = createTextLayerNode(createDefaultTextLayerData(), 'Broken path text');
    if (text.text.source.kind !== 'flow') throw new Error('Expected flow text fixture.');
    text.text = {
      ...text.text,
      source: {
        ...text.text.source,
        layout: {
          mode: 'path', pathLayerId: 'deleted-path', pathElementId: 'path',
          pathSubpathId: 'contour', startOffset: 0,
          side: 'left', upright: true
        }
      }
    };
    const document = createImageDocument('Broken path text', 120, 80, 'source');
    document.layers = [text];
    state.coordinator.configureFonts(state.port);
    state.coordinator.sync(document);
    await flush();
    await flush();

    expect(state.client.realizeTextDetailed).not.toHaveBeenCalled();
    expect(state.renderer.prepareAtlasSource).not.toHaveBeenCalled();
    expect(state.renderer.publish).not.toHaveBeenCalled();
    expect(state.onError).toHaveBeenCalledWith(expect.stringContaining('missing-layer'));
  });

  it('isolates an unsupported imported layer behind its current derived preview', async () => {
    const state = harness();
    const broken = createTextLayerNode(createDefaultTextLayerData(), 'Preview-backed path');
    if (broken.text.source.kind !== 'flow') throw new Error('Expected flow text fixture.');
    broken.text = {
      ...broken.text,
      source: {
        ...broken.text.source,
        layout: {
          mode: 'path', pathLayerId: 'deleted-path', pathElementId: 'path',
          pathSubpathId: 'contour', startOffset: 0,
          side: 'left', upright: true
        }
      }
    };
    broken.derivedPreview = {
      width: 32,
      height: 16,
      transform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
      dependencyKey: semanticLayerDependencyKey(broken)!,
      source: 'photoshop-layer-preview'
    };
    const healthy = createTextLayerNode(createDefaultTextLayerData(), 'Healthy text');
    const document = createImageDocument('Isolated fallback', 120, 80, 'source');
    document.layers = [broken, healthy];

    state.coordinator.configureFonts(state.port);
    state.coordinator.sync(document);
    await flush();
    await flush();

    expect(state.client.realizeTextDetailed).toHaveBeenCalledOnce();
    expect(state.onError).not.toHaveBeenCalled();
    expect(state.coordinator.snapshot()).toMatchObject({
      preparationStage: 'idle',
      lastPreparationError: expect.stringContaining('retained its derived preview')
    });
    await expect(state.coordinator.waitForFinalOutputSources()).resolves.toBe(true);
  });

  it('does no worker or GPU work while suspended and resumes the latest document', async () => {
    const state = harness();
    const document = createImageDocument('Background text', 32, 24, 'source');
    document.layers = [createTextLayerNode(createDefaultTextLayerData(), 'Text')];
    state.coordinator.setActive(false);
    state.coordinator.configureFonts(state.port);
    state.coordinator.sync(document);
    await flush();
    expect(state.client.registerFontDetailed).not.toHaveBeenCalled();
    expect(state.client.realizeTextDetailed).not.toHaveBeenCalled();
    expect(state.submit).not.toHaveBeenCalled();

    state.coordinator.setActive(true);
    await flush();
    expect(state.client.realizeTextDetailed).toHaveBeenCalledOnce();
    expect(state.submit).toHaveBeenCalledOnce();
  });

  it('prepares one atomic source and deduplicates unchanged documents', async () => {
    const state = harness();
    const document = createImageDocument('Text', 32, 24, 'source');
    document.layers = [createTextLayerNode(createDefaultTextLayerData(), 'Text')];
    state.coordinator.configureFonts(state.port);
    state.coordinator.sync(document);
    await flush();

    expect(state.client.registerFontDetailed).toHaveBeenCalledOnce();
    expect(state.client.realizeTextDetailed).toHaveBeenCalledOnce();
    expect(state.renderer.prepareTightSource).toHaveBeenCalledOnce();
    expect(state.publish).toHaveBeenCalledOnce();
    expect(state.submit).toHaveBeenCalledOnce();
    expect(state.coordinator.editingLayout(document.layers[0]!.id)).toMatchObject({
      layerId: document.layers[0]!.id,
      layout: { key: 'layout' }
    });

    state.coordinator.sync(document);
    await flush();
    expect(state.client.realizeTextDetailed).toHaveBeenCalledOnce();
    expect(state.submit).toHaveBeenCalledOnce();
  });

  it('remains reusable after document-owned resources are reset', async () => {
    const state = harness();
    const first = createImageDocument('First', 32, 24, 'source');
    first.layers = [createTextLayerNode(createDefaultTextLayerData(), 'Text')];
    state.coordinator.configureFonts(state.port);
    state.coordinator.sync(first);
    await flush();
    expect(state.client.realizeTextDetailed).toHaveBeenCalledOnce();

    state.coordinator.resetDocument();
    expect(state.coordinator.snapshot()).toMatchObject({
      configuredFontCount: 0,
      visibleTextLayerCount: 0,
      preparationStage: 'waiting-document'
    });

    const second = createImageDocument('Second', 32, 24, 'source');
    second.layers = [createTextLayerNode(createDefaultTextLayerData(), 'Text')];
    state.coordinator.sync(second);
    await flush();

    expect(state.client.realizeTextDetailed).toHaveBeenCalledTimes(2);
    expect(state.publish).toHaveBeenCalledTimes(2);
  });

  it('ignores late font and document publications after terminal disposal', async () => {
    const state = harness();
    state.coordinator.dispose();
    const document = createImageDocument('Late', 32, 24, 'source');
    document.layers = [createTextLayerNode(createDefaultTextLayerData(), 'Text')];

    state.coordinator.configureFonts(state.port);
    state.coordinator.sync(document);
    await flush();

    expect(state.client.registerFontDetailed).not.toHaveBeenCalled();
    expect(state.client.realizeTextDetailed).not.toHaveBeenCalled();
  });

  it('does not let synchronous presentation bookkeeping suppress queued text preparation', async () => {
    const state = harness();
    const document = createImageDocument('Text', 32, 24, 'source');
    document.layers = [createTextLayerNode(createDefaultTextLayerData(), 'Text')];
    state.renderer.setVisibleLayerIds.mockImplementationOnce(() => {
      throw new Error('presentation bookkeeping failed');
    });
    state.coordinator.configureFonts(state.port);

    expect(() => state.coordinator.sync(document)).toThrow('presentation bookkeeping failed');
    await flush();

    expect(state.client.registerFontDetailed).toHaveBeenCalledOnce();
    expect(state.client.realizeTextDetailed).toHaveBeenCalledOnce();
    expect(state.publish).toHaveBeenCalledOnce();
  });

  it('registers only exact fonts referenced by production text layers', async () => {
    const state = harness();
    const unused = {
      ...asset,
      assetId: 'font-unused',
      fingerprintSha256: 'b'.repeat(64),
      familyNames: ['Unused']
    };
    const port = {
      ...state.port,
      assets: [asset, unused],
      bytes: vi.fn(async (assetId: string) => new Uint8Array(
        assetId === asset.assetId ? [1, 2, 3, 4] : [5, 6, 7, 8]
      ))
    } satisfies TextFontRuntimePort;
    const text = createDefaultTextLayerData();
    const source = text.source.kind === 'flow' ? text.source : null;
    if (!source) throw new Error('Expected the default flow source.');
    const document = createImageDocument('Referenced font', 32, 24, 'source');
    document.layers = [createTextLayerNode({
      ...text,
      source: {
        ...source,
        styleRuns: source.styleRuns.map((run) => ({
          ...run,
          requestedFont: { ...run.requestedFont, preferredAsset: asset }
        }))
      }
    }, 'Text')];

    state.coordinator.configureFonts(port);
    state.coordinator.sync(document);
    await flush();

    expect(port.bytes).toHaveBeenCalledOnce();
    expect(port.bytes).toHaveBeenCalledWith(asset.assetId);
    expect(state.client.registerFontDetailed).toHaveBeenCalledOnce();
    expect(state.client.registerFontDetailed).toHaveBeenCalledWith(
      expect.objectContaining({ font: asset }), expect.any(AbortSignal)
    );
  });

  it('registers an explicit substitute and sends original per-run provenance to layout', async () => {
    const state = harness();
    const text = createDefaultTextLayerData();
    if (text.source.kind !== 'flow') throw new Error('Expected flow text.');
    const requested = {
      families: ['Unavailable Family'],
      postScriptName: 'UnavailableFamily-Regular',
      preferredAsset: {
        ...asset,
        assetId: 'missing-font',
        fingerprintSha256: 'c'.repeat(64),
        postScriptName: 'UnavailableFamily-Regular'
      }
    };
    const document = createImageDocument('Substituted font', 32, 24, 'source');
    document.layers = [createTextLayerNode({
      ...text,
      source: {
        ...text.source,
        styleRuns: text.source.styleRuns.map((run) => ({ ...run, requestedFont: requested }))
      }
    }, 'Text')];

    state.coordinator.configureFonts(state.port);
    state.coordinator.sync(document);
    await flush();

    expect(state.client.registerFontDetailed).toHaveBeenCalledOnce();
    expect(state.client.realizeTextDetailed).toHaveBeenCalledWith(
      expect.objectContaining({
        flowFontSelections: [expect.objectContaining({
          font: expect.objectContaining({ assetId: asset.assetId }),
          familyName: 'Inter',
          resolution: expect.objectContaining({
            kind: 'flow-substituted',
            reason: 'asset-missing',
            requested
          })
        })]
      }),
      expect.any(AbortSignal)
    );
  });

  it('publishes small eligible text as a retained direct atlas plan without a private submit', async () => {
    const state = harness();
    state.client.realizeTextDetailed.mockResolvedValueOnce({
      layout: {
        schemaVersion: TEXT_LAYOUT_SCHEMA_VERSION,
        key: 'direct-layout',
        glyphRuns: [{
          font: CONTRACT_FIXTURE_FONT_INSTANCE, fontSize: 16,
          fontResolution: { kind: 'positioned-exact', sourceRunIndex: 0 },
          paint: { fill: { kind: 'solid', color: { colorSpace: 'srgb', r: 0, g: 0, b: 0, a: 1 } } },
          renderingMode: 'fill', direction: 'ltr',
          glyphIds: new Uint32Array([7]), clusters: new Uint32Array([0]),
          geometry: new Float32Array([2, 12, 10, 0])
        }],
        lines: [], caretStops: [], selectionGeometry: [], clusterMap: [],
        inkBounds: { x: 2, y: 0, width: 10, height: 16 },
        logicalBounds: { x: 2, y: 0, width: 10, height: 16 }, warnings: []
      }, metrics: {}, roundTripDurationMs: 0, responseTransferBytes: 0
    } as never);
    state.backend.lookupGlyph.mockReturnValue({
      placement: {
        serializedKey: 'glyph', pageId: 0, pageGeneration: 0, atlasGeneration: 0,
        x: 0, y: 0, width: 10, height: 16, empty: false
      }, bearingX: 0, bearingY: 12
    });
    const document = createImageDocument('Direct text', 32, 24, 'source');
    document.layers = [createTextLayerNode(createDefaultTextLayerData(), 'Text')];
    state.coordinator.configureFonts(state.port);
    state.coordinator.sync(document);
    await flush();
    expect(state.renderer.prepareAtlasSource).toHaveBeenCalledOnce();
    expect(state.renderer.prepareTightSource).not.toHaveBeenCalled();
    expect(state.submit).not.toHaveBeenCalled();
    expect(state.publish).toHaveBeenCalledOnce();

    await state.coordinator.waitForSettledSource(document.layers[0]!.id);
    expect(state.renderer.prepareTightSource).toHaveBeenCalledOnce();
    expect(state.submit).toHaveBeenCalledOnce();
    expect(state.renderer.thumbnailSource(document.layers[0]!.id)).not.toBeNull();

    await expect(state.coordinator.waitForFinalOutputSources()).resolves.toBe(true);
    expect(state.outlineRepository.resolve).toHaveBeenCalledOnce();
    expect(state.outlineBackend.encodeTight).toHaveBeenCalledOnce();
    expect(state.submit).toHaveBeenCalledTimes(2);

    await expect(state.coordinator.waitForFinalOutputSources()).resolves.toBe(true);
    expect(state.outlineBackend.encodeTight).toHaveBeenCalledOnce();
    expect(state.submit).toHaveBeenCalledTimes(2);
  });

  it('routes stroked text through cached outline WebGPU geometry instead of coverage masks', async () => {
    const state = harness();
    state.client.realizeTextDetailed.mockResolvedValueOnce({
      layout: {
        schemaVersion: TEXT_LAYOUT_SCHEMA_VERSION,
        key: 'stroke-layout',
        glyphRuns: [{
          font: CONTRACT_FIXTURE_FONT_INSTANCE, fontSize: 16,
          fontResolution: { kind: 'positioned-exact', sourceRunIndex: 0 },
          paint: { fill: { kind: 'solid', color: { colorSpace: 'srgb', r: 0, g: 0, b: 0, a: 1 } } },
          renderingMode: 'fill', direction: 'ltr',
          glyphIds: new Uint32Array([7]), clusters: new Uint32Array([0]),
          geometry: new Float32Array([2, 12, 10, 0])
        }],
        lines: [], caretStops: [], selectionGeometry: [], clusterMap: [],
        inkBounds: { x: 2, y: 0, width: 10, height: 16 },
        logicalBounds: { x: 2, y: 0, width: 10, height: 16 }, warnings: []
      }, metrics: {}, roundTripDurationMs: 0, responseTransferBytes: 0
    } as never);
    let document = createImageDocument('Stroke text', 64, 48, 'source');
    const layer = createTextLayerNode(createDefaultTextLayerData(), 'Text');
    document.layers = [layer];
    if (layer.text.source.kind !== 'flow') throw new Error('Expected flow text fixture.');
    document = setFlowTextRuns(document, layer.id, layer.text.source.styleRuns.map((style) => ({
      ...style,
      stroke: {
        paint: { kind: 'solid' as const, color: { colorSpace: 'srgb' as const, r: 1, g: 0, b: 0, a: 1 } },
        width: 1, cap: 'butt' as const, join: 'miter' as const, miterLimit: 4
      }
    })), layer.text.source.paragraphRuns);

    state.coordinator.configureFonts(state.port);
    state.coordinator.sync(document);
    await state.coordinator.waitForSettledSource(layer.id);

    expect(state.outlineRepository.resolve).toHaveBeenCalledOnce();
    expect(state.outlineBackend.encodeTight).toHaveBeenCalledOnce();
    expect(state.renderer.publish).toHaveBeenCalledWith(expect.objectContaining({
      layerId: layer.id, sourceKey: expect.stringContaining('outline-v1'), mode: 'cached'
    }));
    expect(state.backend.lookupGlyph).not.toHaveBeenCalled();
    expect(state.renderer.prepareAtlasSource).not.toHaveBeenCalled();
    expect(state.submit).toHaveBeenCalledOnce();
  });

  it('resolves normal atlas text into uniquely identified layer-local conversion paths on demand', async () => {
    const state = harness();
    state.client.realizeTextDetailed.mockResolvedValueOnce({
      layout: {
        schemaVersion: TEXT_LAYOUT_SCHEMA_VERSION,
        key: 'convert-layout',
        glyphRuns: [{
          font: CONTRACT_FIXTURE_FONT_INSTANCE, fontSize: 20,
          fontResolution: { kind: 'positioned-exact', sourceRunIndex: 0 },
          paint: { fill: { kind: 'solid', color: { colorSpace: 'srgb', r: 0, g: 0, b: 0, a: 1 } } },
          renderingMode: 'fill', direction: 'ltr',
          glyphIds: new Uint32Array([7, 7]), clusters: new Uint32Array([0, 1]),
          geometry: new Float32Array([2, 18, 10, 0, 14, 18, 10, 0])
        }],
        lines: [], caretStops: [], selectionGeometry: [], clusterMap: [],
        inkBounds: { x: 2, y: -2, width: 22, height: 20 },
        logicalBounds: { x: 2, y: -2, width: 22, height: 20 }, warnings: []
      }, metrics: {}, roundTripDurationMs: 0, responseTransferBytes: 0
    } as never);
    state.backend.lookupGlyph.mockReturnValue({
      placement: {
        serializedKey: 'glyph', pageId: 0, pageGeneration: 0, atlasGeneration: 0,
        x: 0, y: 0, width: 10, height: 20, empty: false
      }, bearingX: 0, bearingY: 18
    });
    const document = createImageDocument('Convert text', 64, 48, 'source');
    const layer = createTextLayerNode(createDefaultTextLayerData(), 'Text');
    document.layers = [layer];
    state.coordinator.configureFonts(state.port);
    state.coordinator.sync(document);
    await flush();

    const paths = await state.coordinator.vectorPathsForLayer(layer.id);

    expect(paths).toHaveLength(2);
    expect(new Set(paths?.map(({ id }) => id)).size).toBe(2);
    expect(paths?.[0]?.transform).toMatchObject({ a: 0.02, d: -0.02, tx: 2, ty: 18 });
    expect(paths?.[1]?.transform).toMatchObject({ tx: 14, ty: 18 });
    expect(paths?.[0]?.subpaths[0]?.id).not.toBe(paths?.[1]?.subpaths[0]?.id);
    expect(state.outlineRepository.resolve).toHaveBeenCalledOnce();
  });

  it('reuses realized geometry but redraws a paint-only text update', async () => {
    const state = harness();
    const document = createImageDocument('Text paint', 32, 24, 'source');
    document.layers = [createTextLayerNode(createDefaultTextLayerData(), 'Text')];
    state.coordinator.configureFonts(state.port);
    state.coordinator.sync(document);
    await flush();
    const layer = document.layers[0]!;
    if (layer.type !== 'text' || layer.text.source.kind !== 'flow') {
      throw new Error('Expected flow text fixture.');
    }
    const source = layer.text.source;
    const repainted = setFlowTextContent(document, layer.id, source.text, source.styleRuns.map((run) => ({
      ...run,
      fill: { kind: 'solid', color: { colorSpace: 'srgb', r: 1, g: 0, b: 0, a: 1 } }
    })), source.paragraphRuns);
    state.coordinator.sync(repainted);
    await flush();

    expect(state.client.realizeTextDetailed).toHaveBeenCalledOnce();
    expect(state.renderer.prepareTightSource).toHaveBeenCalledTimes(2);
    expect(state.submit).toHaveBeenCalledTimes(2);
  });

  it('drops superseded paint preparations instead of building a render backlog', async () => {
    const state = harness();
    let releaseFirst!: (value: {
      layout: { key: string; glyphRuns: never[] };
      metrics: Record<string, never>;
      roundTripDurationMs: number;
      responseTransferBytes: number;
    }) => void;
    state.client.realizeTextDetailed.mockImplementationOnce(() => new Promise((resolve) => {
      releaseFirst = resolve;
    }));
    const document = createImageDocument('Text paint burst', 32, 24, 'source');
    document.layers = [createTextLayerNode(createDefaultTextLayerData(), 'Text')];
    const layer = document.layers[0]!;
    if (layer.type !== 'text' || layer.text.source.kind !== 'flow') {
      throw new Error('Expected flow text fixture.');
    }
    const repaint = (input: typeof document, red: number, blue: number) => {
      const current = input.layers[0]!;
      if (current.type !== 'text' || current.text.source.kind !== 'flow') {
        throw new Error('Expected flow text fixture.');
      }
      return setFlowTextContent(
        input,
        current.id,
        current.text.source.text,
        current.text.source.styleRuns.map((run) => ({
          ...run,
          fill: { kind: 'solid' as const, color: { colorSpace: 'srgb' as const, r: red, g: 0, b: blue, a: 1 } }
        })),
        current.text.source.paragraphRuns
      );
    };

    state.coordinator.configureFonts(state.port);
    state.coordinator.sync(document);
    await flush();
    expect(state.client.realizeTextDetailed).toHaveBeenCalledOnce();

    const intermediate = repaint(document, 1, 0);
    const latest = repaint(intermediate, 0, 1);
    state.coordinator.sync(intermediate);
    state.coordinator.sync(latest);
    await flush();
    // The latest generation must not wait for an obsolete worker operation
    // which has ignored cancellation to resolve.
    expect(state.client.realizeTextDetailed).toHaveBeenCalledTimes(2);
    expect(state.client.realizeTextDetailed.mock.calls[1]?.[0]).toMatchObject({
      revisions: { paint: 2 }
    });
    releaseFirst({
      layout: { key: 'superseded-layout', glyphRuns: [] },
      metrics: {}, roundTripDurationMs: 0, responseTransferBytes: 0
    });
    await state.coordinator.waitForSettledSource(layer.id);

    expect(state.client.realizeTextDetailed).toHaveBeenCalledTimes(2);
  });

  it('reflows only the paragraph-edited layer and gives settled siblings zero work', async () => {
    const state = harness();
    const document = createImageDocument('Text siblings', 32, 24, 'source');
    document.layers = [
      createTextLayerNode(createDefaultTextLayerData(), 'First'),
      createTextLayerNode(createDefaultTextLayerData(), 'Second')
    ];
    state.coordinator.configureFonts(state.port);
    state.coordinator.sync(document);
    await flush();
    expect(state.client.realizeTextDetailed).toHaveBeenCalledTimes(2);
    expect(state.renderer.prepareTightSource).toHaveBeenCalledTimes(2);

    const first = document.layers[0]!;
    if (first.type !== 'text' || first.text.source.kind !== 'flow') {
      throw new Error('Expected flow text fixture.');
    }
    const changed = setFlowTextRuns(
      document,
      first.id,
      first.text.source.styleRuns,
      first.text.source.paragraphRuns.map((run) => ({
        ...run, lineHeight: { kind: 'multiple' as const, value: 1.4 }
      }))
    );
    const changedFirst = changed.layers[0]!;
    if (changedFirst.type !== 'text') throw new Error('Expected changed text fixture.');
    expect(changedFirst.text.revisions).toEqual({
      ...first.text.revisions,
      layout: first.text.revisions.layout + 1
    });
    state.coordinator.sync(changed);
    await flush();
    expect(state.client.realizeTextDetailed).toHaveBeenCalledTimes(3);
    expect(state.renderer.prepareTightSource).toHaveBeenCalledTimes(3);
    expect(state.submit).toHaveBeenCalledTimes(3);
    expect(state.client.realizeTextDetailed.mock.calls[2]?.[0]).toMatchObject({
      layerId: first.id,
      revisions: { layout: first.text.revisions.layout + 1 }
    });
    expect(state.renderer.prepareTightSource.mock.calls[2]?.[1]).toMatchObject({ id: first.id });
  });

  it('reuses resident glyph masks across a paragraph-only layout revision', async () => {
    const state = harness();
    state.client.realizeTextDetailed.mockResolvedValue({
      layout: {
        schemaVersion: TEXT_LAYOUT_SCHEMA_VERSION,
        key: 'paragraph-layout',
        glyphRuns: [{
          font: CONTRACT_FIXTURE_FONT_INSTANCE, fontSize: 16,
          fontResolution: { kind: 'positioned-exact', sourceRunIndex: 0 },
          paint: { fill: { kind: 'solid', color: {
            colorSpace: 'srgb', r: 0, g: 0, b: 0, a: 1
          } } },
          renderingMode: 'fill', direction: 'ltr',
          glyphIds: new Uint32Array([7]), clusters: new Uint32Array([0]),
          geometry: new Float32Array([2, 12, 10, 0])
        }],
        lines: [], caretStops: [], selectionGeometry: [], clusterMap: [],
        inkBounds: { x: 2, y: 0, width: 10, height: 16 },
        logicalBounds: { x: 2, y: 0, width: 10, height: 16 }, warnings: []
      }, metrics: {}, roundTripDurationMs: 0, responseTransferBytes: 0
    } as never);
    state.backend.lookupGlyph.mockReturnValue({
      placement: {
        serializedKey: 'glyph', pageId: 0, pageGeneration: 0, atlasGeneration: 0,
        x: 0, y: 0, width: 10, height: 16, empty: false
      }, bearingX: 0, bearingY: 12
    });
    const document = createImageDocument('Paragraph atlas reuse', 32, 24, 'source');
    const layer = createTextLayerNode(createDefaultTextLayerData(), 'Text');
    document.layers = [layer];
    state.coordinator.configureFonts(state.port);
    state.coordinator.sync(document);
    await flush();
    if (layer.text.source.kind !== 'flow') throw new Error('Expected flow text fixture.');

    const changed = setFlowTextRuns(
      document,
      layer.id,
      layer.text.source.styleRuns,
      layer.text.source.paragraphRuns.map((run) => ({ ...run, alignment: 'center' }))
    );
    state.coordinator.sync(changed);
    await flush();

    expect(state.client.realizeTextDetailed).toHaveBeenCalledTimes(2);
    expect(state.backend.lookupGlyph).toHaveBeenCalledTimes(2);
    expect(state.client.rasterizeGlyph).not.toHaveBeenCalled();
    expect(state.backend.prepareGlyph).not.toHaveBeenCalled();
    expect(state.renderer.prepareAtlasSource).toHaveBeenCalledTimes(2);
  });

  it('freezes source scale during an interaction and rebuilds once at settle', async () => {
    const state = harness();
    const document = createImageDocument('Interactive transform', 32, 24, 'source');
    const layer = createTextLayerNode(createDefaultTextLayerData(), 'Text');
    document.layers = [layer];
    state.coordinator.configureFonts(state.port);
    state.coordinator.sync(document);
    await flush();

    state.coordinator.setLayerInteraction(layer.id, true);
    const transformed = setTextLayerTransform(document, layer.id, {
      a: 3, b: 0, c: 0, d: 3, tx: 12, ty: 8
    });
    expect(transformed.layers[0]?.transform).toMatchObject({ a: 3, d: 3 });
    state.coordinator.sync(transformed);
    await flush();
    expect(state.client.realizeTextDetailed).toHaveBeenCalledOnce();
    expect(state.renderer.prepareTightSource).toHaveBeenCalledOnce();
    expect(state.coordinator.editingLayout(layer.id)?.localToDocument).toMatchObject({
      a: 3, d: 3, tx: 12, ty: 8
    });

    state.coordinator.setLayerInteraction(layer.id, false);
    await state.coordinator.waitForSettledSource(layer.id);
    await flush();
    expect(state.client.realizeTextDetailed).toHaveBeenCalledOnce();
    expect(state.renderer.prepareTightSource).toHaveBeenCalledTimes(2);
  });

  it('settles text prepared during an editing interaction after the interaction ends', async () => {
    const state = harness();
    const document = createImageDocument('Interactive text', 32, 24, 'source');
    const layer = createTextLayerNode(createDefaultTextLayerData(), 'Text');
    document.layers = [layer];
    state.coordinator.setLayerInteraction(layer.id, true);
    state.coordinator.configureFonts(state.port);
    state.coordinator.sync(document);
    await flush();
    expect(state.renderer.prepareTightSource).toHaveBeenCalledOnce();

    state.coordinator.setLayerInteraction(layer.id, false);
    await flush();
    expect(state.renderer.prepareTightSource).toHaveBeenCalledTimes(2);
    expect(state.submit).toHaveBeenCalledTimes(2);
  });

  it('correlates a text input with the exact source submitted by the document frame', async () => {
    const state = harness();
    const document = createImageDocument('Input latency', 32, 24, 'source');
    const layer = createTextLayerNode(createDefaultTextLayerData(), 'Text');
    document.layers = [layer];
    state.coordinator.configureFonts(state.port);
    state.coordinator.sync(document);
    await flush();
    if (layer.text.source.kind !== 'flow') throw new Error('Expected flow text fixture.');

    state.coordinator.beginTextInput(layer.id, 10);
    const nextText = `${layer.text.source.text}x`;
    const styleRuns = layer.text.source.styleRuns.map((run, index, runs) => (
      index === runs.length - 1 ? { ...run, end: nextText.length } : run
    ));
    const paragraphRuns = layer.text.source.paragraphRuns.map((run, index, runs) => (
      index === runs.length - 1 ? { ...run, end: nextText.length } : run
    ));
    const changed = setFlowTextContent(
      document,
      layer.id,
      nextText,
      styleRuns,
      paragraphRuns
    );
    state.coordinator.sync(changed);
    await flush();
    const submitted = state.coordinator.markFrameSubmitted(changed, 24);
    expect(submitted).toHaveLength(1);
    state.coordinator.markFrameGpuComplete(submitted, 31);
    expect(state.coordinator.snapshot()).toMatchObject({
      textInputLatencySamples: 1,
      pendingTextInputs: 0,
      inputToSubmitP95Ms: 14,
      inputToGpuP95Ms: 21
    });
  });

  it('publishes editing geometry even when source preparation fails afterward', async () => {
    const state = harness();
    state.renderer.prepareTightSource.mockImplementation(() => {
      throw new Error('allocation failed');
    });
    const document = createImageDocument('Editing geometry', 32, 24, 'source');
    document.layers = [createTextLayerNode(createDefaultTextLayerData(), 'Text')];
    state.coordinator.configureFonts(state.port);
    state.coordinator.sync(document);
    await flush();
    expect(state.coordinator.editingLayout(document.layers[0]!.id)).toMatchObject({
      layerId: document.layers[0]!.id,
      layout: { key: 'layout' }
    });
    expect(state.submit).not.toHaveBeenCalled();
  });

  it('retains the last exact editing geometry until a newer edit finishes shaping', async () => {
    const state = harness();
    const document = createImageDocument('Provisional editing geometry', 32, 24, 'source');
    const layer = createTextLayerNode(createDefaultTextLayerData(), 'Text');
    document.layers = [layer];
    state.coordinator.configureFonts(state.port);
    state.coordinator.sync(document);
    await flush();
    if (layer.text.source.kind !== 'flow') throw new Error('Expected flow text fixture.');
    const exactText = layer.text.source.text;
    expect(state.coordinator.editingLayout(layer.id)).toMatchObject({ sourceText: exactText });

    let finishShaping!: (value: unknown) => void;
    state.client.realizeTextDetailed.mockImplementationOnce(() => new Promise((resolve) => {
      finishShaping = resolve;
    }) as never);
    state.coordinator.setLayerInteraction(layer.id, true);
    const nextText = `${exactText}x`;
    const changed = setFlowTextContent(
      document,
      layer.id,
      nextText,
      layer.text.source.styleRuns.map((run, index, runs) => (
        index === runs.length - 1 ? { ...run, end: nextText.length } : run
      )),
      layer.text.source.paragraphRuns.map((run, index, runs) => (
        index === runs.length - 1 ? { ...run, end: nextText.length } : run
      ))
    );
    state.coordinator.sync(changed);
    await flush();

    expect(state.coordinator.editingLayout(layer.id)).toMatchObject({
      sourceText: exactText,
      layout: { key: 'layout' }
    });
    finishShaping({
      layout: { key: 'new-layout', glyphRuns: [] },
      metrics: {}, roundTripDurationMs: 0, responseTransferBytes: 0
    });
    await flush();
    expect(state.coordinator.editingLayout(layer.id)).toMatchObject({
      sourceText: nextText,
      layout: { key: 'new-layout' }
    });
  });

  it('invalidates queued work when text becomes hidden', async () => {
    const state = harness();
    let resolveLayout!: (value: unknown) => void;
    let signal: AbortSignal | undefined;
    state.client.realizeTextDetailed.mockImplementationOnce((...args: unknown[]) => new Promise((resolve) => {
      signal = args[1] as AbortSignal | undefined;
      resolveLayout = resolve;
    }) as never);
    const document = createImageDocument('Text', 32, 24, 'source');
    const layer = createTextLayerNode(createDefaultTextLayerData(), 'Text');
    document.layers = [layer];
    state.coordinator.configureFonts(state.port);
    state.coordinator.sync(document);
    await flush();
    state.coordinator.sync({ ...document, layers: [{ ...layer, visible: false }] });
    expect(signal?.aborted).toBe(true);
    resolveLayout({
      layout: { key: 'stale', glyphRuns: [] },
      metrics: {}, roundTripDurationMs: 0, responseTransferBytes: 0
    });
    await flush();

    expect(state.renderer.prepareTightSource).not.toHaveBeenCalled();
    expect(state.submit).not.toHaveBeenCalled();
    expect(state.coordinator.editingLayout(layer.id)).toBeNull();
  });

  it('drops delayed work when the font port is detached', async () => {
    const state = harness();
    let resolveLayout!: (value: unknown) => void;
    state.client.realizeTextDetailed.mockImplementationOnce(() => new Promise((resolve) => {
      resolveLayout = resolve;
    }) as never);
    const document = createImageDocument('Text', 32, 24, 'source');
    document.layers = [createTextLayerNode(createDefaultTextLayerData(), 'Text')];
    state.coordinator.configureFonts(state.port);
    state.coordinator.sync(document);
    await flush();
    state.coordinator.configureFonts(null);
    resolveLayout({ layout: { key: 'stale', glyphRuns: [] } });
    await flush();

    expect(state.renderer.prepareTightSource).not.toHaveBeenCalled();
    expect(state.renderer.dispose).toHaveBeenCalled();
    expect(state.submit).not.toHaveBeenCalled();
    expect(state.coordinator.editingLayout(document.layers[0]!.id)).toBeNull();
  });

  it('releases every document-local text owner on device-loss disposal', async () => {
    const state = harness();
    const document = createImageDocument('Device loss', 32, 24, 'source');
    const layer = createTextLayerNode(createDefaultTextLayerData(), 'Text');
    document.layers = [layer];
    state.coordinator.configureFonts(state.port);
    state.coordinator.sync(document);
    await flush();
    state.coordinator.setLayerInteraction(layer.id, true);
    state.coordinator.beginTextInput(layer.id, 10);
    const disposeCalls = state.renderer.dispose.mock.calls.length;

    state.coordinator.dispose();
    await flush();
    expect(state.renderer.dispose).toHaveBeenCalledTimes(disposeCalls + 1);
    expect(state.renderer.setCostObserver).toHaveBeenLastCalledWith(null);
    expect(state.backend.dispose).toHaveBeenCalledOnce();
    expect(state.client.releaseSession).toHaveBeenCalled();
    expect(state.coordinator.snapshot().pendingTextInputs).toBe(0);
    expect(state.coordinator.setLayerInteraction(layer.id, false)).toBe(false);
  });

  it('does not publish a candidate when queue submission fails', async () => {
    const state = harness();
    state.submit.mockImplementation(() => { throw new Error('device lost'); });
    const document = createImageDocument('Text', 32, 24, 'source');
    document.layers = [createTextLayerNode(createDefaultTextLayerData(), 'Text')];
    state.coordinator.configureFonts(state.port);
    state.coordinator.sync(document);
    await flush();

    expect(state.discard).toHaveBeenCalledTimes(2);
    expect(state.publish).not.toHaveBeenCalled();
    expect(state.onError).toHaveBeenCalledWith('device lost');
  });

  it('releases a failed candidate font session and permits an exact retry', async () => {
    const state = harness();
    state.client.registerFontDetailed
      .mockRejectedValueOnce(new Error('bad font transfer'))
      .mockResolvedValueOnce({ metrics: {} } as never);
    const document = createImageDocument('Text', 32, 24, 'source');
    document.layers = [createTextLayerNode(createDefaultTextLayerData(), 'Text')];
    state.coordinator.configureFonts(state.port);
    state.coordinator.sync(document);
    await flush();
    state.coordinator.sync(document);
    await flush();

    expect(state.client.registerFontDetailed).toHaveBeenCalledTimes(2);
    expect(state.client.releaseSession).toHaveBeenCalled();
    expect(state.publish).toHaveBeenCalledOnce();
  });

  it('rebuilds once from a stable live font port when availability changes', async () => {
    const state = harness();
    let revision = 1;
    let notifyAvailability = () => undefined;
    const port: TextFontRuntimePort = {
      get revision() { return revision; },
      get assets() { return [asset]; },
      bytes: vi.fn(async () => new Uint8Array([1, 2, 3, 4])),
      subscribe: vi.fn((listener) => {
        notifyAvailability = listener;
        return () => undefined;
      })
    };
    const document = createImageDocument('Live fonts', 32, 24, 'source');
    document.layers = [createTextLayerNode(createDefaultTextLayerData(), 'Text')];
    state.coordinator.configureFonts(port);
    state.coordinator.sync(document);
    await flush();

    revision = 2;
    notifyAvailability();
    await flush();

    expect(state.client.registerFontDetailed).toHaveBeenCalledTimes(2);
    expect(state.client.realizeTextDetailed).toHaveBeenCalledTimes(2);
    expect(state.publish).toHaveBeenCalledTimes(2);
    expect(state.renderer.dispose).toHaveBeenCalledTimes(2);
  });

  it('reconciles a changed live font revision when its availability event was missed', async () => {
    const state = harness();
    let revision = 0;
    let assets: readonly DocumentFontAsset[] = [];
    const port: TextFontRuntimePort = {
      get revision() { return revision; },
      get assets() { return assets; },
      bytes: vi.fn(async () => new Uint8Array([1, 2, 3, 4])),
      subscribe: vi.fn(() => () => undefined)
    };
    const document = createImageDocument('Missed font publication', 32, 24, 'source');
    document.layers = [createTextLayerNode(createDefaultTextLayerData(), 'Text')];
    state.coordinator.configureFonts(port);
    state.coordinator.sync(document);
    await flush();
    expect(state.client.registerFontDetailed).not.toHaveBeenCalled();

    revision = 1;
    assets = [asset];
    state.coordinator.configureFonts(port);
    await flush();

    expect(state.client.registerFontDetailed).toHaveBeenCalledOnce();
    expect(state.client.realizeTextDetailed).toHaveBeenCalledOnce();
    expect(state.publish).toHaveBeenCalledOnce();
  });

  it('does not invalidate twice when React confirms an already delivered live revision', async () => {
    const state = harness();
    let revision = 1;
    let notifyAvailability = () => undefined;
    const port: TextFontRuntimePort = {
      get revision() { return revision; },
      get assets() { return [asset]; },
      bytes: vi.fn(async () => new Uint8Array([1, 2, 3, 4])),
      subscribe: vi.fn((listener) => {
        notifyAvailability = listener;
        return () => undefined;
      })
    };
    const document = createImageDocument('Confirmed font publication', 32, 24, 'source');
    document.layers = [createTextLayerNode(createDefaultTextLayerData(), 'Text')];
    state.coordinator.configureFonts(port);
    state.coordinator.sync(document);
    await flush();

    revision = 2;
    notifyAvailability();
    state.coordinator.configureFonts(port);
    await flush();

    expect(state.client.registerFontDetailed).toHaveBeenCalledTimes(2);
    expect(state.client.realizeTextDetailed).toHaveBeenCalledTimes(2);
    expect(state.publish).toHaveBeenCalledTimes(2);
  });

  it('rechecks ownership after asynchronously releasing a previous document session', async () => {
    const state = harness();
    const first = createImageDocument('First', 32, 24, 'source');
    first.layers = [createTextLayerNode(createDefaultTextLayerData(), 'Text')];
    state.coordinator.configureFonts(state.port);
    state.coordinator.sync(first);
    await flush();
    expect(state.publish).toHaveBeenCalledOnce();

    let finishRelease!: () => void;
    state.client.releaseSession.mockImplementationOnce(() => new Promise<undefined>((resolve) => {
      finishRelease = () => resolve(undefined);
    }));
    const second = { ...first, id: 'second-document' as typeof first.id };
    state.coordinator.sync(second);
    await flush();
    state.coordinator.configureFonts(null);
    finishRelease();
    await flush();

    expect(state.publish).toHaveBeenCalledOnce();
    expect(state.renderer.dispose).toHaveBeenCalled();
    expect(state.client.releaseSession.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
