import { describe, expect, it } from 'vitest';
import {
  CONTRACT_FIXTURE_FONT_ASSET,
  CONTRACT_FIXTURE_FONT_INSTANCE,
  IDENTITY_MATRIX_3,
  TEXT_CONTRACT_FIXTURE_COUNT,
  cloneTextLayerData,
  createDefaultFlowTextSource,
  createDefaultTextLayerData,
  createPositionedTextFixture,
  createTextLayoutError,
  selectTextLayoutFallback
} from './defaults';
import { bumpTextLayerRevision, createTextLayoutCacheKey } from './cacheKeys';
import {
  TEXT_LAYOUT_SCHEMA_VERSION,
  TEXT_WORKER_PROTOCOL_VERSION,
  type RealizedTextLayout,
  type TextRenderingMode,
  type TextRunPaint
} from './types';
import {
  TextContractValidationError,
  assertRealizedTextLayout,
  assertTextLayoutWorkerRequest,
  assertTextLayoutWorkerResponse,
  assertTextLayerData,
  assertTextWorkerRequest,
  parseTextLayerData
} from './validation';
import {
  TextTransferContractError,
  collectTextRequestTransferBuffers,
  collectTextResponseTransferBuffers,
  copyFontBytesToDedicatedStorage,
  type TextLayoutWorkerRequest,
  type TextLayoutWorkerResponse,
  type TextWorkerFontRegistrationRequest
} from './workerProtocol';

const structuredCloneValue = (
  globalThis as unknown as {
    structuredClone: <T>(value: T, options?: { transfer: readonly ArrayBuffer[] }) => T;
  }
).structuredClone;

const fillPaint: TextRunPaint = {
  fill: { kind: 'solid', color: { colorSpace: 'srgb', r: 0, g: 0, b: 0, a: 0.5 } }
};
const strokePaint = {
  paint: { kind: 'solid', color: { colorSpace: 'srgb', r: 1, g: 0, b: 0, a: 1 } } as const,
  width: 1,
  cap: 'butt' as const,
  join: 'miter' as const,
  miterLimit: 4
};

const createRealizedFixture = (key = 'fixture-layout'): RealizedTextLayout => ({
  schemaVersion: TEXT_LAYOUT_SCHEMA_VERSION,
  key,
  glyphRuns: [{
    font: CONTRACT_FIXTURE_FONT_INSTANCE,
    fontSize: 16,
    fontResolution: {
      kind: 'flow-exact',
      sourceRunIndex: 0,
      requested: { families: ['Inter', 'sans-serif'] }
    },
    paint: fillPaint,
    renderingMode: 'fill',
    direction: 'ltr',
    glyphIds: new Uint32Array([36]),
    clusters: new Uint32Array([0]),
    geometry: new Float32Array([0, 0, 11, 0])
  }],
  lines: [{ start: 0, end: 1, baseline: 12, ascent: 10, descent: 2, bounds: { x: 0, y: 0, width: 11, height: 12 } }],
  caretStops: [
    { textOffset: 0, x: 0, y: 0, height: 12, affinity: 'downstream' },
    { textOffset: 1, x: 11, y: 0, height: 12, affinity: 'upstream' }
  ],
  selectionGeometry: [{ start: 0, end: 1, bounds: { x: 0, y: 0, width: 11, height: 12 } }],
  clusterMap: [{ textStart: 0, textEnd: 1, glyphStart: 0, glyphEnd: 1 }],
  inkBounds: { x: 0, y: 2, width: 10, height: 10 },
  logicalBounds: { x: 0, y: 0, width: 11, height: 12 },
  warnings: []
});

const createLayoutRequest = (): TextLayoutWorkerRequest => {
  const layer = createDefaultTextLayerData();
  const options = { quality: 'final' as const, effectiveScale: 2, maxGlyphCount: 1000, locale: 'nl-NL' };
  const identity = {
    documentSessionId: 'document-session-1',
    sessionGeneration: 2,
    layerId: 'layer-1',
    revisions: layer.revisions,
    fontSnapshotRevision: 1,
    pathDependencyRevision: 0,
    options
  };
  return {
    protocolVersion: TEXT_WORKER_PROTOCOL_VERSION,
    kind: 'realize-text',
    requestId: 4,
    documentSessionId: identity.documentSessionId,
    sessionGeneration: identity.sessionGeneration,
    layerId: identity.layerId,
    layer,
    flowFontSelections: [{
      sourceRunIndex: 0,
      font: CONTRACT_FIXTURE_FONT_ASSET,
      familyName: 'Inter',
      resolution: {
        kind: 'flow-exact', sourceRunIndex: 0,
        requested: layer.source.kind === 'flow'
          ? layer.source.styleRuns[0]!.requestedFont
          : { families: ['Inter'] }
      }
    }],
    localToDocument: IDENTITY_MATRIX_3,
    fontSnapshotRevision: identity.fontSnapshotRevision,
    pathDependencyRevision: identity.pathDependencyRevision,
    cacheKey: createTextLayoutCacheKey(identity),
    options
  };
};

describe('text document contracts', () => {
  it('round-trips flow and positioned payloads through JSON and structured clone', () => {
    expect(TEXT_CONTRACT_FIXTURE_COUNT).toBe(2);
    for (const fixture of [createDefaultTextLayerData(), createPositionedTextFixture()]) {
      assertTextLayerData(fixture);
      expect(parseTextLayerData(JSON.parse(JSON.stringify(fixture)) as unknown)).toEqual(fixture);
      expect(structuredCloneValue(fixture)).toEqual(fixture);
    }
  });

  it('round-trips explicit font replacement provenance without changing the source request', () => {
    const layer = createDefaultTextLayerData();
    if (layer.source.kind !== 'flow') throw new Error('Expected flow text.');
    const run = layer.source.styleRuns[0]!;
    const candidate = {
      ...layer,
      source: { ...layer.source, styleRuns: [{
        ...run,
        requestedFont: {
          families: ['Replacement Sans'],
          preferredAsset: CONTRACT_FIXTURE_FONT_ASSET,
          replacement: {
            original: structuredCloneValue(run.requestedFont),
            originalStyle: {
              weight: run.fontWeight, stretch: run.fontStretch, fontStyle: run.fontStyle
            },
            replacementAsset: CONTRACT_FIXTURE_FONT_ASSET
          }
        }
      }] }
    };

    expect(parseTextLayerData(JSON.parse(JSON.stringify(candidate)) as unknown)).toEqual(candidate);
  });

  it('round-trips semantic text warp data and rejects malformed custom meshes', () => {
    const layer = {
      ...createDefaultTextLayerData(),
      warp: {
        style: 'custom' as const,
        bend: 0,
        horizontalDistortion: 0,
        verticalDistortion: 0,
        orientation: 'horizontal' as const,
        bounds: { x: 10, y: 20, width: 100, height: 50 },
        mesh: {
          rows: 2,
          columns: 2,
          points: [
            { x: 10, y: 20 }, { x: 110, y: 15 },
            { x: 10, y: 70 }, { x: 110, y: 75 }
          ]
        }
      }
    };
    expect(parseTextLayerData(JSON.parse(JSON.stringify(layer)) as unknown)).toEqual(layer);
    expect(() => assertTextLayerData({
      ...layer,
      warp: { ...layer.warp, mesh: { ...layer.warp.mesh, points: layer.warp.mesh.points.slice(1) } }
    })).toThrow(/rows x columns/);
  });

  it('clones without sharing authored run state', () => {
    const original = createDefaultTextLayerData();
    const clone = cloneTextLayerData(original);
    expect(clone).toEqual(original);
    expect(clone).not.toBe(original);
    expect(clone.source).not.toBe(original.source);
  });

  it('accepts empty flow text with no style or paragraph runs', () => {
    const layer = { ...createDefaultTextLayerData(), source: createDefaultFlowTextSource('') };
    expect(() => assertTextLayerData(layer)).not.toThrow();
  });

  it('round-trips the shared gradient paint contract in editable character runs', () => {
    const layer = createDefaultTextLayerData();
    const source = createDefaultFlowTextSource('Gradient');
    const fill = {
      kind: 'gradient' as const,
      asset: {
        id: 'text-gradient', name: 'Text gradient', type: 'solid' as const, smoothness: 1,
        colorStops: [
          { id: 'a', position: 0, midpoint: 0.5, color: { r: 0, g: 0, b: 0, a: 1 } },
          { id: 'b', position: 1, midpoint: 0.5, color: { r: 1, g: 1, b: 1, a: 1 } }
        ],
        opacityStops: [
          { id: 'oa', position: 0, midpoint: 0.5, opacity: 1 },
          { id: 'ob', position: 1, midpoint: 0.5, opacity: 1 }
        ], roughness: 0, seed: 0
      },
      shape: 'linear' as const, coordinateSpace: 'layer' as const,
      transform: { a: 100, b: 0, c: 0, d: 100, tx: 0, ty: 0 },
      reverse: false, dither: true, interpolation: 'perceptual' as const
    };
    const candidate = {
      ...layer,
      source: {
        ...source,
        styleRuns: source.styleRuns.map((run) => ({ ...run, fill }))
      }
    };
    expect(parseTextLayerData(JSON.parse(JSON.stringify(candidate)) as unknown)).toEqual(candidate);
  });

  it('round-trips validated insertion styling for an empty authored flow', () => {
    const populated = createDefaultFlowTextSource('x');
    const { start: _styleStart, end: _styleEnd, ...insertionStyle } = populated.styleRuns[0];
    const { start: _paragraphStart, end: _paragraphEnd, ...insertionParagraph } = populated.paragraphRuns[0];
    const layer = {
      ...createDefaultTextLayerData(),
      source: {
        ...createDefaultFlowTextSource(''),
        insertionStyle: { ...insertionStyle, fontSize: 73 },
        insertionParagraph
      }
    };
    expect(parseTextLayerData(JSON.parse(JSON.stringify(layer)) as unknown)).toEqual(layer);
    expect(() => assertTextLayerData({
      ...layer,
      source: { ...layer.source, insertionStyle: { ...layer.source.insertionStyle, fontSize: 0 } }
    })).toThrow(/insertionStyle.fontSize/);
  });

  it('round-trips stable path text references and validates optional element identities', () => {
    const source = createDefaultFlowTextSource('Path');
    const layer = {
      ...createDefaultTextLayerData(),
      source: {
        ...source,
        layout: {
          mode: 'path' as const,
          pathLayerId: 'vector-layer',
          pathElementId: 'curve-a',
          pathSubpathId: 'contour-a',
          startOffset: 12,
          endOffset: 240,
          direction: 'reverse' as const,
          side: 'left' as const,
          upright: true
        }
      }
    };
    expect(parseTextLayerData(JSON.parse(JSON.stringify(layer)) as unknown)).toEqual(layer);
    expect(() => assertTextLayerData({
      ...layer,
      source: { ...layer.source, layout: { ...layer.source.layout, pathElementId: '' } }
    })).toThrow(/pathElementId/);
    expect(() => assertTextLayerData({
      ...layer,
      source: { ...layer.source, layout: { ...layer.source.layout, pathSubpathId: '' } }
    })).toThrow(/pathSubpathId/);
    expect(() => assertTextLayerData({
      ...layer,
      source: { ...layer.source, layout: { ...layer.source.layout, endOffset: Number.NaN } }
    })).toThrow(/endOffset/);
    expect(() => assertTextLayerData({
      ...layer,
      source: { ...layer.source, layout: { ...layer.source.layout, direction: 'sideways' } }
    })).toThrow(/direction/);
  });

  it('bounds authored character and paragraph numbers in runs and insertion defaults', () => {
    const source = createDefaultFlowTextSource('x');
    const layer = { ...createDefaultTextLayerData(), source };
    const invalidStyle = (change: Record<string, unknown>) => ({
      ...layer,
      source: { ...source, styleRuns: [{ ...source.styleRuns[0], ...change }] }
    });
    expect(() => assertTextLayerData(invalidStyle({ fontStretch: Number.POSITIVE_INFINITY }))).toThrow(/fontStretch/);
    expect(() => assertTextLayerData(invalidStyle({ fontStretch: 10_001 }))).toThrow(/fontStretch/);
    expect(() => assertTextLayerData(invalidStyle({ variableAxes: { wght: 1_000_001 } }))).toThrow(/variableAxes.wght/);
    expect(() => assertTextLayerData({
      ...layer,
      source: {
        ...source,
        paragraphRuns: [{ ...source.paragraphRuns[0], lineHeight: { kind: 'multiple', value: 100_001 } }]
      }
    })).toThrow(/lineHeight.value/);
    const { start: _start, end: _end, ...insertionStyle } = source.styleRuns[0];
    expect(() => assertTextLayerData({
      ...createDefaultTextLayerData(),
      source: {
        ...createDefaultFlowTextSource(''),
        insertionStyle: { ...insertionStyle, variableAxes: { wght: Number.NaN } }
      }
    })).toThrow(/insertionStyle.variableAxes.wght/);
  });

  it('rejects malformed schemas, optional enums, metadata and runtime handles', () => {
    expect(() => assertTextLayerData({ ...createDefaultTextLayerData(), schemaVersion: 2 })).toThrow(/schemaVersion/);
    const badLanguage = cloneTextLayerData(createDefaultTextLayerData()) as unknown as { source: { styleRuns: Array<Record<string, unknown>> } };
    badLanguage.source.styleRuns[0].directionOverride = 'sideways';
    expect(() => assertTextLayerData(badLanguage)).toThrow(/directionOverride/);
    const badInterchange = { ...createDefaultTextLayerData(), interchange: { format: 'eps' } };
    expect(() => assertTextLayerData(badInterchange)).toThrow(/interchange.format/);
    class RuntimeHandle {}
    expect(() => assertTextLayerData({ ...createDefaultTextLayerData(), runtime: new RuntimeHandle() })).toThrow(/plain serializable object/);
  });

  it('rejects positioned identifiers that would truncate in Uint32Array tables', () => {
    const fixture = createPositionedTextFixture();
    if (fixture.source.kind !== 'positioned') throw new Error('Expected positioned fixture.');
    const run = fixture.source.runs[0];
    const glyph = run.glyphs[0];
    expect(() => assertTextLayerData({
      ...fixture,
      source: { ...fixture.source, runs: [{ ...run, glyphs: [{ ...glyph, glyphId: 0x1_0000_0000 }] }] }
    })).toThrow(/glyphId/);
    expect(() => assertTextLayerData({
      ...fixture,
      source: {
        ...fixture.source,
        runs: [{ ...run, font: { ...run.font, font: { ...run.font.font, faceIndex: 0x1_0000_0000 } } }]
      }
    })).toThrow(/faceIndex/);
  });

  it('validates and transfers bounded hinted glyph raster responses', () => {
    const response: TextLayoutWorkerResponse = {
      kind: 'glyph-rasterized', protocolVersion: TEXT_WORKER_PROTOCOL_VERSION,
      requestId: 8, documentSessionId: 'document', sessionGeneration: 1,
      assetId: CONTRACT_FIXTURE_FONT_ASSET.assetId, faceIndex: 0,
      glyphId: 36, ppem: 24, fontSnapshotRevision: 1,
      variationCoordinates: {}, syntheticBold: false, syntheticItalic: false,
      hinting: 'smooth', renderMode: 'alpha',
      transferOwnership: 'dedicated',
      raster: {
        width: 2, height: 2, bearingX: 0, bearingY: 2,
        commandCount: 4, pixels: new Uint8Array([0, 64, 128, 255])
      },
      metrics: { operationDurationMs: 1, wasmLinearMemoryBytes: 65_536 }
    };
    expect(() => assertTextLayoutWorkerResponse(response)).not.toThrow();
    expect(collectTextResponseTransferBuffers(response)).toEqual([response.raster.pixels.buffer]);
    expect(() => assertTextLayoutWorkerResponse({
      ...response,
      raster: { ...response.raster, width: 3 }
    })).toThrow(/one R8 byte/);
  });

  it('validates scale-independent glyph outline requests and dedicated tables', () => {
    const identity = {
      protocolVersion: TEXT_WORKER_PROTOCOL_VERSION,
      requestId: 9,
      documentSessionId: 'document',
      sessionGeneration: 1
    } as const;
    expect(() => assertTextWorkerRequest({
      ...identity,
      kind: 'extract-glyph-outline',
      assetId: CONTRACT_FIXTURE_FONT_ASSET.assetId,
      faceIndex: 0,
      glyphId: 36,
      fontSnapshotRevision: 1,
      variationCoordinates: { wght: 650 }
    })).not.toThrow();
    const response: TextLayoutWorkerResponse = {
      ...identity,
      kind: 'glyph-outline-extracted',
      assetId: CONTRACT_FIXTURE_FONT_ASSET.assetId,
      faceIndex: 0,
      glyphId: 36,
      fontSnapshotRevision: 1,
      variationCoordinates: { wght: 650 },
      transferOwnership: 'dedicated',
      outline: {
        unitsPerEm: 1_000,
        verbs: new Uint8Array([0, 1, 1, 4]),
        coordinates: new Float32Array([0, 0, 10, 0, 10, 10]),
        bounds: new Float32Array([0, 0, 10, 10])
      },
      metrics: { operationDurationMs: 1, wasmLinearMemoryBytes: 65_536 }
    };
    expect(() => assertTextLayoutWorkerResponse(response)).not.toThrow();
    expect(collectTextResponseTransferBuffers(response)).toEqual([
      response.outline.verbs.buffer,
      response.outline.coordinates.buffer,
      response.outline.bounds.buffer
    ]);
    expect(() => assertTextLayoutWorkerResponse({
      ...response,
      outline: { ...response.outline, verbs: new Uint8Array([0]) }
    })).toThrow(/verb arity/);
  });

  it('never permits run boundaries to split a surrogate pair', () => {
    const layer = createDefaultTextLayerData();
    const source = createDefaultFlowTextSource('A\u{1F600}B');
    const style = source.styleRuns[0];
    const malformed = {
      ...layer,
      source: { ...source, styleRuns: [{ ...style, start: 0, end: 2 }, { ...style, start: 2, end: source.text.length }] }
    };
    expect(() => assertTextLayerData(malformed)).toThrow(TextContractValidationError);
    expect(() => assertTextLayerData(malformed)).toThrow(/surrogate pair/);
  });

  it('preserves all eight PDF rendering modes and exact encoded-code width', () => {
    const modes: readonly TextRenderingMode[] = [
      'fill', 'stroke', 'fill-stroke', 'invisible',
      'fill-clip', 'stroke-clip', 'fill-stroke-clip', 'clip'
    ];
    for (const renderingMode of modes) {
      const needsFill = renderingMode.includes('fill');
      const needsStroke = renderingMode.includes('stroke');
      const fixture = createPositionedTextFixture();
      const source = fixture.source.kind === 'positioned' ? fixture.source : null;
      expect(source).not.toBeNull();
      const run = source!.runs[0];
      const paint: TextRunPaint = {
        ...(needsFill ? fillPaint : {}),
        ...(needsStroke ? { stroke: strokePaint } : {})
      };
      const candidate = {
        ...fixture,
        source: {
          ...source!,
          runs: [{
            ...run,
            renderingMode,
            paint,
            glyphs: [{ ...run.glyphs[0], sourceCharacterCode: { value: 1, byteLength: 2 } }]
          }]
        }
      };
      expect(() => assertTextLayerData(candidate)).not.toThrow();
      expect(JSON.parse(JSON.stringify(candidate)).source.runs[0].glyphs[0].sourceCharacterCode).toEqual({ value: 1, byteLength: 2 });
    }
  });
});

describe('text revisions and fallback policy', () => {
  it('derives layout identity only from layout-affecting revisions and options', () => {
    const layer = createDefaultTextLayerData();
    const options = { quality: 'final' as const, effectiveScale: 2, maxGlyphCount: 1000, locale: 'nl-NL' };
    const base = {
      documentSessionId: 'document-a', sessionGeneration: 1, layerId: 'layer-a', revisions: layer.revisions,
      fontSnapshotRevision: 7, pathDependencyRevision: 0, options
    };
    const nextRevisions = bumpTextLayerRevision(layer.revisions, 'font');
    expect(nextRevisions).toEqual({ ...layer.revisions, font: 1 });
    expect(createTextLayoutCacheKey(base)).toBe(createTextLayoutCacheKey(base));
    expect(createTextLayoutCacheKey({ ...base, revisions: nextRevisions })).not.toBe(createTextLayoutCacheKey(base));
    expect(createTextLayoutCacheKey({
      ...base,
      revisions: bumpTextLayerRevision(layer.revisions, 'paint')
    })).toBe(createTextLayoutCacheKey(base));
    expect(createTextLayoutCacheKey({
      ...base,
      options: { ...options, effectiveScale: 4 }
    })).toBe(createTextLayoutCacheKey(base));
    expect(createTextLayoutCacheKey({ ...base, pathDependencyRevision: 1 })).not.toBe(createTextLayoutCacheKey(base));
    expect(createTextLayoutCacheKey({ ...base, sessionGeneration: 2 })).not.toBe(createTextLayoutCacheKey(base));
    expect(createTextLayoutCacheKey({ ...base, options: { ...options, locale: 'ar' } })).not.toBe(createTextLayoutCacheKey(base));
  });

  it('migrates legacy style revisions to independent font and paint revisions', () => {
    const layer = createDefaultTextLayerData();
    const legacy = {
      ...layer,
      revisions: { content: 2, style: 7, layout: 3, path: 1, geometry: 4 }
    };

    expect(parseTextLayerData(legacy).revisions).toEqual({
      content: 2,
      font: 7,
      layout: 3,
      paint: 7,
      path: 1,
      geometry: 4
    });
    expect(() => assertTextLayerData(legacy)).toThrow(/revisions\.font/);
  });

  it('uses the exact non-silent fallback policy', () => {
    expect(selectTextLayoutFallback({ code: 'font-missing' }, true)).toBe('diagnostic-placeholder');
    expect(selectTextLayoutFallback({ code: 'engine-unavailable' }, true)).toBe('preserve-last-realized-layout');
    expect(selectTextLayoutFallback({ code: 'engine-unavailable' }, false)).toBe('diagnostic-placeholder');
    expect(selectTextLayoutFallback({ code: 'cancelled' }, false)).toBe('none');
    expect(createTextLayoutError('resource-limit', 'Too many glyphs.', true)).toEqual({
      code: 'resource-limit', message: 'Too many glyphs.', retryable: true, fallback: 'preserve-last-realized-layout'
    });
  });
});

describe('realized layout and worker contracts', () => {
  it('rejects invalid typed geometry and cross-array cluster ranges', () => {
    const layout = createRealizedFixture();
    expect(() => assertRealizedTextLayout(layout)).not.toThrow();
    expect(() => assertRealizedTextLayout({ ...layout, firstBaselineOffset: 12.5 })).not.toThrow();
    expect(() => assertRealizedTextLayout({ ...layout, firstBaselineOffset: Number.NaN }))
      .toThrow(/firstBaselineOffset/);
    expect(() => assertRealizedTextLayout({
      ...layout,
      paragraphFrame: {
        bounds: { x: 0, y: 0, width: 100, height: 40 },
        overflow: 'indicator',
        overflowed: true,
        firstOverflowTextOffset: 1
      }
    })).not.toThrow();
    expect(() => assertRealizedTextLayout({
      ...layout,
      paragraphFrame: {
        bounds: { x: 0, y: 0, width: 100, height: 40 },
        overflow: 'indicator',
        overflowed: true
      }
    })).toThrow(/firstOverflowTextOffset/);
    expect(() => assertRealizedTextLayout({
      ...layout,
      glyphRuns: [{ ...layout.glyphRuns[0], geometry: new Float32Array([0, Number.NaN, 11, 0]) }]
    })).toThrow(/geometry/);
    expect(() => assertRealizedTextLayout({
      ...layout,
      clusterMap: [{ textStart: 0, textEnd: 1, glyphStart: 0, glyphEnd: 2 }]
    })).toThrow(/cluster ranges/);
    expect(() => assertRealizedTextLayout({ ...layout, lines: [null] })).toThrow(/lines/);
    expect(() => assertRealizedTextLayout({
      ...layout,
      glyphRuns: [{ ...layout.glyphRuns[0], fontSize: 0 }]
    })).toThrow(/fontSize/);
    expect(() => assertRealizedTextLayout({
      ...layout,
      glyphRuns: [{ ...layout.glyphRuns[0], language: 42 }]
    })).toThrow(/language/);
  });

  it('validates session/generation/cache identity before layout work starts', () => {
    const request = createLayoutRequest();
    expect(() => assertTextLayoutWorkerRequest(request)).not.toThrow();
    expect(() => assertTextLayoutWorkerRequest({
      ...request,
      flowFontSelections: []
    })).toThrow(/one entry per flow style run/);
    expect(() => assertTextLayoutWorkerRequest({
      ...request,
      flowFontSelections: [{ ...request.flowFontSelections[0], sourceRunIndex: 1 }]
    })).toThrow(/style-run index/);
    expect(() => assertTextLayoutWorkerRequest({ ...request, cacheKey: 'stale' })).toThrow(/cacheKey/);
    expect(() => assertTextLayoutWorkerRequest({ ...request, protocolVersion: 999 })).toThrow(/protocolVersion/);
  });

  it('moves only dedicated font registration storage', () => {
    const bytes = copyFontBytesToDedicatedStorage(new Uint8Array([0, 1, 0, 0]));
    const request: TextWorkerFontRegistrationRequest = {
      protocolVersion: TEXT_WORKER_PROTOCOL_VERSION,
      kind: 'register-font',
      requestId: 3,
      documentSessionId: 'document-session-1',
      sessionGeneration: 2,
      font: CONTRACT_FIXTURE_FONT_ASSET,
      fontSnapshotRevision: 1,
      bytes,
      byteSource: 'transferred',
      transferOwnership: 'dedicated'
    };
    expect(() => assertTextWorkerRequest(request)).not.toThrow();
    const clone = structuredCloneValue(request, { transfer: collectTextRequestTransferBuffers(request) });
    expect(bytes.byteLength).toBe(0);
    expect(clone.bytes).toEqual(new Uint8Array([0, 1, 0, 0]));

    const pooled = new Uint8Array(8);
    const subarrayRequest = { ...request, bytes: pooled.subarray(2, 6) };
    expect(() => collectTextRequestTransferBuffers(subarrayRequest)).toThrow(TextTransferContractError);

    const aliasRequest: TextWorkerFontRegistrationRequest = {
      ...request,
      requestId: 4,
      fontSnapshotRevision: 2,
      byteSource: 'registered-fingerprint',
      bytes: undefined,
      transferOwnership: undefined
    };
    expect(() => assertTextWorkerRequest(aliasRequest)).not.toThrow();
    expect(collectTextRequestTransferBuffers(aliasRequest)).toEqual([]);
  });

  it('validates logical cancellation and exact-generation session release', () => {
    const identity = {
      protocolVersion: TEXT_WORKER_PROTOCOL_VERSION,
      documentSessionId: 'document-session-1',
      sessionGeneration: 2
    };
    expect(() => assertTextWorkerRequest({
      ...identity, kind: 'cancel-text', requestId: 8, targetRequestId: 7
    })).not.toThrow();
    expect(() => assertTextWorkerRequest({
      ...identity, kind: 'release-session', requestId: 9
    })).not.toThrow();
    expect(() => assertTextLayoutWorkerResponse({
      ...identity, kind: 'session-released', requestId: 9
    })).not.toThrow();
  });

  it('moves dedicated realized tables without sharing or detaching unrelated memory', () => {
    const request = createLayoutRequest();
    const response: TextLayoutWorkerResponse = {
      protocolVersion: TEXT_WORKER_PROTOCOL_VERSION,
      kind: 'text-realized',
      requestId: request.requestId,
      documentSessionId: request.documentSessionId,
      sessionGeneration: request.sessionGeneration,
      cacheKey: request.cacheKey,
      layout: createRealizedFixture(request.cacheKey),
      transferOwnership: 'dedicated',
      metrics: {
        operationDurationMs: 1.25,
        wasmLinearMemoryBytes: 65_536,
        paragraphCache: {
          requestHitCount: 2,
          requestShapeCount: 1,
          retainedEntryCount: 3,
          retainedByteLength: 4096,
          lifetimeEvictionCount: 0
        }
      }
    };
    expect(() => assertTextLayoutWorkerResponse(response)).not.toThrow();
    expect(() => assertTextLayoutWorkerResponse({
      ...response,
      metrics: {
        ...response.metrics,
        paragraphCache: { ...response.metrics.paragraphCache!, requestShapeCount: -1 }
      }
    })).toThrow(/requestShapeCount/);
    const transfers = collectTextResponseTransferBuffers(response);
    const clone = structuredCloneValue(response, { transfer: transfers });
    expect(transfers).toHaveLength(3);
    expect(response.layout.glyphRuns[0].glyphIds.byteLength).toBe(0);
    expect(clone.layout.glyphRuns[0].glyphIds).toEqual(new Uint32Array([36]));

    const shared = new ArrayBuffer(4);
    const validLayout = createRealizedFixture(request.cacheKey);
    const invalid = {
      ...validLayout,
      glyphRuns: [{
        ...validLayout.glyphRuns[0],
        glyphIds: new Uint32Array(shared),
        clusters: new Uint32Array(shared)
      }]
    };
    expect(() => collectTextResponseTransferBuffers({ ...response, layout: invalid })).toThrow(TextTransferContractError);
    expect(() => assertTextLayoutWorkerResponse({ ...response, layout: invalid })).toThrow(/shares storage/);
  });
});
