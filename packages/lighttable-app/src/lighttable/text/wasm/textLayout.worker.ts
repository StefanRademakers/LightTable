/// <reference lib="webworker" />

import initializeTextLayoutWasm, {
  drop_layout_session as dropLayoutSession,
  extract_registered_glyph_outline as extractRegisteredGlyphOutline,
  inspect_font_json as inspectFontJson,
  rasterize_registered_glyph as rasterizeRegisteredGlyph,
  realize_flow_text as realizeFlowText,
  register_layout_font as registerLayoutFont,
  text_engine_memory_bytes as textEngineMemoryBytes,
  text_engine_version as textEngineVersion
} from './generated/text_layout_wasm.js';
import {
  TEXT_LAYOUT_SCHEMA_VERSION,
  TEXT_WORKER_PROTOCOL_VERSION,
  assertTextWorkerRequest,
  collectTextResponseTransferBuffers,
  createTextLayoutError,
  realizeParagraphFrame,
  type FontAssetRef,
  type ParagraphTextLayout,
  type PointTextLayout,
  type RealizedTextLayout,
  type TextLayoutWorkerRequest,
  type TextLayoutWorkerResponse,
  type TextWorkerFlowFontSelection,
  type TextWorkerRequest
} from '@lighttable/text-core';
import {
  TEXT_ENGINE_PROTOCOL_VERSION,
  type TextEngineWorkerRequest,
  type TextEngineWorkerResponse
} from './textEngineProtocol';
import {
  resolveUniformParagraphLayout,
  type UniformParagraphLayout
} from './uniformParagraphLayout';
import {
  createParagraphShapeCacheKey,
  segmentFlowParagraphs,
  type FlowParagraphSegment
} from './incrementalParagraphLayout';
import { alignPackedPointTextBaseline } from './pointTextBaseline';
import { ParagraphFragmentCache } from './ParagraphFragmentCache';
import {
  horizontalLayoutForVertical,
  projectHorizontalLayoutToVertical,
  type VerticalFlowLayout
} from './verticalTextLayout';
import {
  assembleParagraphLayout,
  estimatePackedParagraphBytes,
  type PackedParagraphFragment,
  type ParagraphFragmentPlacement
} from './paragraphFragmentLayout';

let initialization: Promise<{ engineVersion: string; loadDurationMs: number }> | null = null;
const layoutSessions = new Map<string, {
  revision: number;
  fingerprints: Set<string>;
  faceCounts: Map<string, number>;
  fonts: Map<string, FontAssetRef>;
  paragraphs: ParagraphFragmentCache<PackedParagraphFragment>;
}>();

const sessionKey = (identity: { documentSessionId: string; sessionGeneration: number }) =>
  `${identity.documentSessionId}:${identity.sessionGeneration}`;

const hex = (bytes: Uint8Array) => [...bytes]
  .map((value) => value.toString(16).padStart(2, '0'))
  .join('');

const sha256 = async (bytes: Uint8Array) => hex(new Uint8Array(
  await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer)
));

const initialize = () => {
  initialization ??= (async () => {
    const startedAt = performance.now();
    await initializeTextLayoutWasm();
    return {
      engineVersion: textEngineVersion(),
      loadDurationMs: performance.now() - startedAt
    };
  })();
  return initialization;
};

self.onmessage = async ({ data }: MessageEvent<TextEngineWorkerRequest | TextWorkerRequest>) => {
  if (data.kind === 'register-font' || data.kind === 'realize-text' || data.kind === 'rasterize-glyph'
    || data.kind === 'extract-glyph-outline' || data.kind === 'cancel-text'
    || data.kind === 'release-session') {
    await handleLayoutRequest(data);
    return;
  }
  let response: TextEngineWorkerResponse;
  if (Number(data.protocolVersion) !== TEXT_ENGINE_PROTOCOL_VERSION) {
    response = {
      kind: 'error',
      protocolVersion: TEXT_ENGINE_PROTOCOL_VERSION,
      requestId: data.requestId,
      message: `Unsupported text engine protocol ${data.protocolVersion}.`
    };
    self.postMessage(response);
    return;
  }

  try {
    const capability = await initialize();
    response = data.kind === 'probe'
      ? {
          kind: 'ready',
          protocolVersion: TEXT_ENGINE_PROTOCOL_VERSION,
          requestId: data.requestId,
          ...capability
        }
      : {
          kind: 'font-inspected',
          protocolVersion: TEXT_ENGINE_PROTOCOL_VERSION,
          requestId: data.requestId,
          ...JSON.parse(inspectFontJson(new Uint8Array(data.bytes), data.faceIndex))
        };
  } catch (error) {
    initialization = null;
    response = {
      kind: 'error',
      protocolVersion: TEXT_ENGINE_PROTOCOL_VERSION,
      requestId: data.requestId,
      message: error instanceof Error ? error.message : 'The text engine failed to initialize.'
    };
  }
  self.postMessage(response);
};

const layoutFailure = (
  request: TextLayoutWorkerRequest,
  code: Parameters<typeof createTextLayoutError>[0],
  message: string
): TextLayoutWorkerResponse => ({
  kind: 'text-layout-failed',
  protocolVersion: TEXT_WORKER_PROTOCOL_VERSION,
  requestId: request.requestId,
  documentSessionId: request.documentSessionId,
  sessionGeneration: request.sessionGeneration,
  cacheKey: request.cacheKey,
  error: createTextLayoutError(code, message)
});

const handleLayoutRequest = async (data: TextWorkerRequest) => {
  try {
    assertTextWorkerRequest(data);
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : 'Invalid text worker request.';
    if (data.kind === 'realize-text') {
      self.postMessage(layoutFailure(data, 'malformed-input', message));
    } else if (data.kind === 'rasterize-glyph') {
      self.postMessage({
        kind: 'glyph-rasterization-failed', protocolVersion: TEXT_WORKER_PROTOCOL_VERSION,
        requestId: data.requestId, documentSessionId: data.documentSessionId,
        sessionGeneration: data.sessionGeneration, assetId: data.assetId ?? 'unknown',
        glyphId: data.glyphId ?? 0, error: createTextLayoutError('malformed-input', message)
      } satisfies TextLayoutWorkerResponse);
    } else if (data.kind === 'extract-glyph-outline') {
      self.postMessage({
        kind: 'glyph-outline-extraction-failed', protocolVersion: TEXT_WORKER_PROTOCOL_VERSION,
        requestId: data.requestId, documentSessionId: data.documentSessionId,
        sessionGeneration: data.sessionGeneration, assetId: data.assetId ?? 'unknown',
        glyphId: data.glyphId ?? 0, error: createTextLayoutError('malformed-input', message)
      } satisfies TextLayoutWorkerResponse);
    } else if (data.kind === 'register-font') {
      self.postMessage({
        kind: 'font-registration-failed', protocolVersion: TEXT_WORKER_PROTOCOL_VERSION,
        requestId: data.requestId, documentSessionId: data.documentSessionId,
        sessionGeneration: data.sessionGeneration, assetId: data.font?.assetId ?? 'unknown',
        error: createTextLayoutError('malformed-input', message)
      } satisfies TextLayoutWorkerResponse);
    } else if (data.kind === 'release-session') {
      self.postMessage({
        kind: 'session-release-failed', protocolVersion: TEXT_WORKER_PROTOCOL_VERSION,
        requestId: data.requestId, documentSessionId: data.documentSessionId,
        sessionGeneration: data.sessionGeneration,
        error: createTextLayoutError('malformed-input', message)
      } satisfies TextLayoutWorkerResponse);
    }
    return;
  }
  const key = sessionKey(data);
  if (data.kind === 'cancel-text') {
    // Parley shaping is synchronous. The client rejects immediately and drops
    // any late response; this control message intentionally performs no work.
    return;
  }
  if (data.kind === 'release-session') {
    const state = layoutSessions.get(key);
    state?.paragraphs.clear();
    layoutSessions.delete(key);
    // Opening a PSD replaces the provisional image document before the lazy
    // text runtime has necessarily initialized. Releasing that empty session
    // must not call wasm-bindgen exports while its module instance is absent.
    // A JS session can only exist after successful WASM font registration, so
    // skipping the native drop here is exact rather than a leaked resource.
    if (state) dropLayoutSession(key);
    const response: TextLayoutWorkerResponse = {
      kind: 'session-released',
      protocolVersion: TEXT_WORKER_PROTOCOL_VERSION,
      requestId: data.requestId,
      documentSessionId: data.documentSessionId,
      sessionGeneration: data.sessionGeneration
    };
    self.postMessage(response);
    return;
  }
  try {
    await initialize();
  } catch (reason) {
    initialization = null;
    const message = reason instanceof Error ? reason.message : 'The text engine failed to initialize.';
    if (data.kind === 'realize-text') {
      self.postMessage(layoutFailure(data, 'engine-unavailable',
        message));
    } else if (data.kind === 'rasterize-glyph') {
      self.postMessage({
        kind: 'glyph-rasterization-failed', protocolVersion: TEXT_WORKER_PROTOCOL_VERSION,
        requestId: data.requestId, documentSessionId: data.documentSessionId,
        sessionGeneration: data.sessionGeneration, assetId: data.assetId,
        glyphId: data.glyphId, error: createTextLayoutError('engine-unavailable', message)
      } satisfies TextLayoutWorkerResponse);
    } else if (data.kind === 'extract-glyph-outline') {
      self.postMessage({
        kind: 'glyph-outline-extraction-failed', protocolVersion: TEXT_WORKER_PROTOCOL_VERSION,
        requestId: data.requestId, documentSessionId: data.documentSessionId,
        sessionGeneration: data.sessionGeneration, assetId: data.assetId,
        glyphId: data.glyphId, error: createTextLayoutError('engine-unavailable', message)
      } satisfies TextLayoutWorkerResponse);
    } else if (data.kind === 'register-font') {
      self.postMessage({
        kind: 'font-registration-failed', protocolVersion: TEXT_WORKER_PROTOCOL_VERSION,
        requestId: data.requestId, documentSessionId: data.documentSessionId,
        sessionGeneration: data.sessionGeneration, assetId: data.font.assetId,
        error: createTextLayoutError('engine-unavailable', message)
      } satisfies TextLayoutWorkerResponse);
    }
    return;
  }
  let state = layoutSessions.get(key);
  if (!state && (data.kind === 'realize-text' || data.kind === 'rasterize-glyph'
    || data.kind === 'extract-glyph-outline')) {
    if (data.kind === 'realize-text') {
      self.postMessage(layoutFailure(data, 'font-missing', 'Layout session has no registered fonts.'));
    } else if (data.kind === 'rasterize-glyph') {
      self.postMessage({
        kind: 'glyph-rasterization-failed', protocolVersion: TEXT_WORKER_PROTOCOL_VERSION,
        requestId: data.requestId, documentSessionId: data.documentSessionId,
        sessionGeneration: data.sessionGeneration, assetId: data.assetId,
        glyphId: data.glyphId,
        error: createTextLayoutError('font-missing', 'Raster session has no registered fonts.')
      } satisfies TextLayoutWorkerResponse);
    } else {
      self.postMessage({
        kind: 'glyph-outline-extraction-failed', protocolVersion: TEXT_WORKER_PROTOCOL_VERSION,
        requestId: data.requestId, documentSessionId: data.documentSessionId,
        sessionGeneration: data.sessionGeneration, assetId: data.assetId,
        glyphId: data.glyphId,
        error: createTextLayoutError('font-missing', 'Outline session has no registered fonts.')
      } satisfies TextLayoutWorkerResponse);
    }
    return;
  }
  if (!state && layoutSessions.size >= 16) {
    if (data.kind === 'register-font') {
      self.postMessage({
        kind: 'font-registration-failed', protocolVersion: TEXT_WORKER_PROTOCOL_VERSION,
        requestId: data.requestId, documentSessionId: data.documentSessionId,
        sessionGeneration: data.sessionGeneration, assetId: data.font.assetId,
        error: createTextLayoutError('resource-limit', 'Text layout exceeds the 16-session limit.')
      } satisfies TextLayoutWorkerResponse);
    }
    return;
  }
  state ??= {
    revision: 0,
    fingerprints: new Set<string>(),
    faceCounts: new Map<string, number>(),
    fonts: new Map<string, FontAssetRef>(),
    paragraphs: new ParagraphFragmentCache(estimatePackedParagraphBytes)
  };
  if (!layoutSessions.has(key)) layoutSessions.set(key, state);
  if (data.kind === 'register-font') {
    const operationStartedAt = performance.now();
    try {
      if (data.fontSnapshotRevision !== state.revision + 1) {
        throw new Error('Font snapshot revision is stale.');
      }
      if (data.byteSource === 'transferred') {
        const bytes = data.bytes!;
        if (await sha256(bytes) !== data.font.fingerprintSha256) {
          throw new Error('Transferred font fingerprint does not match its bytes.');
        }
        if (!state.fingerprints.has(data.font.fingerprintSha256)) {
          const faceCount = registerLayoutFont(key, data.font.fingerprintSha256, bytes);
          state.fingerprints.add(data.font.fingerprintSha256);
          state.faceCounts.set(data.font.fingerprintSha256, faceCount);
        }
      } else if (!state.fingerprints.has(data.font.fingerprintSha256)) {
        throw new Error('Font collection bytes were not registered before its face alias.');
      }
      const faceCount = state.faceCounts.get(data.font.fingerprintSha256);
      if (faceCount === undefined || data.font.faceIndex >= faceCount) {
        throw new Error(`Font faceIndex ${data.font.faceIndex} is outside the ${faceCount ?? 0}-face collection.`);
      }
      state.fonts.set(data.font.assetId, structuredClone(data.font));
      state.revision = data.fontSnapshotRevision;
      state.paragraphs.clear();
      const response: TextLayoutWorkerResponse = {
        kind: 'font-registered',
        protocolVersion: TEXT_WORKER_PROTOCOL_VERSION,
        requestId: data.requestId,
        documentSessionId: data.documentSessionId,
        sessionGeneration: data.sessionGeneration,
        assetId: data.font.assetId,
        fontSnapshotRevision: state.revision,
        metrics: {
          operationDurationMs: performance.now() - operationStartedAt,
          wasmLinearMemoryBytes: textEngineMemoryBytes()
        }
      };
      self.postMessage(response);
    } catch (reason) {
      const response: TextLayoutWorkerResponse = {
        kind: 'font-registration-failed',
        protocolVersion: TEXT_WORKER_PROTOCOL_VERSION,
        requestId: data.requestId,
        documentSessionId: data.documentSessionId,
        sessionGeneration: data.sessionGeneration,
        assetId: data.font.assetId,
        error: createTextLayoutError(
          'malformed-input',
          reason instanceof Error ? reason.message : 'Font registration failed.'
        )
      };
      self.postMessage(response);
    }
    return;
  }
  if (data.kind === 'rasterize-glyph') {
    const operationStartedAt = performance.now();
    let response: TextLayoutWorkerResponse;
    try {
      if (data.fontSnapshotRevision !== state.revision) throw new Error('Font snapshot revision is stale.');
      const font = state.fonts.get(data.assetId);
      if (!font || font.faceIndex !== data.faceIndex) throw new Error('Exact registered font face is unavailable.');
      if (Object.keys(data.variationCoordinates).length > 0 || data.syntheticBold || data.syntheticItalic) {
        throw new UnsupportedLayoutError('Variable and synthesized glyph rasterization is not enabled yet.');
      }
      const raw = rasterizeRegisteredGlyph(
        key, font.fingerprintSha256, data.faceIndex, data.glyphId, data.ppem
      );
      try {
        const pixels = Uint8Array.from(raw.pixels());
        response = {
        kind: 'glyph-rasterized', protocolVersion: TEXT_WORKER_PROTOCOL_VERSION,
        requestId: data.requestId, documentSessionId: data.documentSessionId,
        sessionGeneration: data.sessionGeneration, assetId: data.assetId,
        faceIndex: data.faceIndex, glyphId: data.glyphId, ppem: data.ppem,
        fontSnapshotRevision: data.fontSnapshotRevision,
        variationCoordinates: data.variationCoordinates,
        syntheticBold: data.syntheticBold, syntheticItalic: data.syntheticItalic,
        hinting: data.hinting, renderMode: data.renderMode,
        transferOwnership: 'dedicated',
        raster: {
          width: raw.width, height: raw.height,
          bearingX: raw.bearing_x, bearingY: raw.bearing_y,
          commandCount: raw.command_count, pixels
        },
        metrics: {
          operationDurationMs: performance.now() - operationStartedAt,
          wasmLinearMemoryBytes: textEngineMemoryBytes()
        }
        };
      } finally {
        raw.free();
      }
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Glyph rasterization failed.';
      response = {
        kind: 'glyph-rasterization-failed', protocolVersion: TEXT_WORKER_PROTOCOL_VERSION,
        requestId: data.requestId, documentSessionId: data.documentSessionId,
        sessionGeneration: data.sessionGeneration, assetId: data.assetId, glyphId: data.glyphId,
        error: createTextLayoutError(
          reason instanceof UnsupportedLayoutError ? 'unsupported-feature'
            : /limit|ppem|dimension|command/i.test(message) ? 'resource-limit'
            : /font|face|glyph/i.test(message) ? 'font-missing' : 'internal-error',
          message
        )
      };
    }
    self.postMessage(response, { transfer: [...collectTextResponseTransferBuffers(response)] });
    return;
  }
  if (data.kind === 'extract-glyph-outline') {
    const operationStartedAt = performance.now();
    let response: TextLayoutWorkerResponse;
    try {
      if (data.fontSnapshotRevision !== state.revision) throw new Error('Font snapshot revision is stale.');
      const font = state.fonts.get(data.assetId);
      if (!font || font.faceIndex !== data.faceIndex) throw new Error('Exact registered font face is unavailable.');
      const variations = Object.entries(data.variationCoordinates)
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
      const raw = extractRegisteredGlyphOutline(
        key,
        font.fingerprintSha256,
        data.faceIndex,
        data.glyphId,
        variations.map(([tag]) => tag),
        new Float32Array(variations.map(([, value]) => value))
      );
      try {
        response = {
          kind: 'glyph-outline-extracted', protocolVersion: TEXT_WORKER_PROTOCOL_VERSION,
          requestId: data.requestId, documentSessionId: data.documentSessionId,
          sessionGeneration: data.sessionGeneration, assetId: data.assetId,
          faceIndex: data.faceIndex, glyphId: data.glyphId,
          fontSnapshotRevision: data.fontSnapshotRevision,
          variationCoordinates: data.variationCoordinates,
          transferOwnership: 'dedicated',
          outline: {
            unitsPerEm: raw.units_per_em,
            verbs: Uint8Array.from(raw.verbs()),
            coordinates: Float32Array.from(raw.coordinates()),
            bounds: Float32Array.from(raw.bounds())
          },
          metrics: {
            operationDurationMs: performance.now() - operationStartedAt,
            wasmLinearMemoryBytes: textEngineMemoryBytes()
          }
        };
      } finally {
        raw.free();
      }
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Glyph outline extraction failed.';
      response = {
        kind: 'glyph-outline-extraction-failed', protocolVersion: TEXT_WORKER_PROTOCOL_VERSION,
        requestId: data.requestId, documentSessionId: data.documentSessionId,
        sessionGeneration: data.sessionGeneration, assetId: data.assetId, glyphId: data.glyphId,
        error: createTextLayoutError(
          /limit|command|axis/i.test(message) ? 'resource-limit'
            : /font|face|glyph/i.test(message) ? 'font-missing' : 'internal-error',
          message
        )
      };
    }
    self.postMessage(response, { transfer: [...collectTextResponseTransferBuffers(response)] });
    return;
  }
  let response: TextLayoutWorkerResponse;
  try {
    response = realizeFlowRequest(data, state);
  } catch (reason) {
    const message = reason instanceof Error
      ? reason.message
      : typeof reason === 'string'
        ? reason
        : 'Text layout failed.';
    response = layoutFailure(
      data,
      reason instanceof UnsupportedLayoutError ? 'unsupported-feature'
        : /unsupported font instance|synthesis|variation/i.test(message) ? 'unsupported-feature'
          : /maxGlyphCount|exceeds|limit/i.test(message) ? 'resource-limit'
          : /font|fallback/i.test(message) ? 'font-missing'
            : /range|stride|finite|unicode|valid/i.test(message) ? 'malformed-input'
              : 'internal-error',
      message
    );
  }
  const transfer = collectTextResponseTransferBuffers(response);
  self.postMessage(response, { transfer: [...transfer] });
};

class UnsupportedLayoutError extends Error {}

const realizeFlowRequest = (
  request: TextLayoutWorkerRequest,
  state: {
    revision: number;
    fonts: Map<string, FontAssetRef>;
    paragraphs: ParagraphFragmentCache<PackedParagraphFragment>;
  }
): TextLayoutWorkerResponse => {
  const operationStartedAt = performance.now();
  if (request.fontSnapshotRevision !== state.revision) {
    return layoutFailure(request, 'schema-mismatch', 'Font snapshot revision is stale.');
  }
  if (request.layer.source.kind === 'positioned') {
    throw new UnsupportedLayoutError('Positioned text realization requires exact outline bounds and is not enabled in Slice 06.');
  }
  const authoredSource = request.layer.source;
  if (authoredSource.layout.mode === 'path') {
    throw new UnsupportedLayoutError('Path text requires the dedicated path layout adapter.');
  }
  const flowLayout = authoredSource.layout as PointTextLayout | ParagraphTextLayout;
  const verticalLayout: VerticalFlowLayout | null = flowLayout.writingMode === 'horizontal-tb'
    ? null
    : flowLayout as VerticalFlowLayout;
  const source = verticalLayout
    ? { ...authoredSource, layout: horizontalLayoutForVertical(verticalLayout) }
    : { ...authoredSource, layout: flowLayout };
  const layoutRequest = verticalLayout
    ? { ...request, layer: { ...request.layer, source } }
    : request;
  const finalizeLayout = (layout: RealizedTextLayout) => verticalLayout
    ? projectHorizontalLayoutToVertical(layout, verticalLayout)
    : layout;
  const selectedFonts = source.styleRuns.map((run, sourceRunIndex) => {
    if (run.directionOverride || run.scriptOverride || run.kerning === 'optical' || run.kerning === 'none'
      || run.horizontalScale !== 100 || run.verticalScale !== 100 || run.baselineShift !== 0
      || Object.keys(run.openTypeFeatures).length > 0 || Object.keys(run.variableAxes).length > 0
      || run.syntheticBold || run.syntheticItalic) {
      throw new UnsupportedLayoutError('Overrides, optical/disabled kerning, baseline or geometric scaling, variations, synthesis and OpenType feature changes are not supported yet.');
    }
    const selection = request.flowFontSelections[sourceRunIndex];
    const font = selection ? state.fonts.get(selection.font.assetId) : undefined;
    if (!selection || !font
      || font.fingerprintSha256 !== selection.font.fingerprintSha256
      || font.faceIndex !== selection.font.faceIndex) {
      throw new UnsupportedLayoutError('Every flow run requires its explicitly selected registered font face.');
    }
    return selection;
  });
  if (source.layout.mode === 'paragraph' && source.text.length > 0) {
    const frameWidth = source.layout.frame.width;
    const cacheBefore = state.paragraphs.metrics();
    const placements = segmentFlowParagraphs(source).map((segment) => {
      const paragraphResolution = resolveUniformParagraphLayout({
        paragraphRuns: segment.paragraphStyles.map(({ run }) => run),
        insertionParagraph: source.insertionParagraph
      });
      if (!paragraphResolution.supported) {
        throw new UnsupportedLayoutError(paragraphResolution.message);
      }
      const cacheKey = createParagraphShapeCacheKey(
        segment,
        frameWidth,
        request.fontSnapshotRevision
      );
      let fragment = state.paragraphs.get(cacheKey);
      fragment ??= state.paragraphs.set(cacheKey, shapeParagraphFragment(
        layoutRequest,
        segment,
        selectedFonts,
        paragraphResolution.value
      ));
      return {
        segment,
        fragment,
        paragraph: paragraphResolution.value
      } satisfies ParagraphFragmentPlacement;
    });
    const paragraphSource = source as typeof source & {
      readonly layout: Extract<typeof source.layout, { readonly mode: 'paragraph' }>;
    };
    const layout = assembleParagraphLayout({
      key: request.cacheKey,
      source: paragraphSource,
      selectedFonts,
      placements,
      maxGlyphCount: request.options.maxGlyphCount
    });
    const cacheAfter = state.paragraphs.metrics();
    return {
      kind: 'text-realized',
      protocolVersion: TEXT_WORKER_PROTOCOL_VERSION,
      requestId: request.requestId,
      documentSessionId: request.documentSessionId,
      sessionGeneration: request.sessionGeneration,
      cacheKey: request.cacheKey,
      layout: finalizeLayout(layout),
      transferOwnership: 'dedicated',
      metrics: {
        operationDurationMs: performance.now() - operationStartedAt,
        wasmLinearMemoryBytes: textEngineMemoryBytes(),
        paragraphCache: {
          requestHitCount: cacheAfter.hits - cacheBefore.hits,
          requestShapeCount: cacheAfter.misses - cacheBefore.misses,
          retainedEntryCount: cacheAfter.entries,
          retainedByteLength: cacheAfter.byteLength,
          lifetimeEvictionCount: cacheAfter.evictions
        }
      }
    };
  }
  const paragraphResolution = resolveUniformParagraphLayout(source);
  if (!paragraphResolution.supported) {
    throw new UnsupportedLayoutError(paragraphResolution.message);
  }
  const paragraphStyle = paragraphResolution.value;
  const encoder = new TextEncoder();
  const encodedFontStrings = source.styleRuns.flatMap((run, index) => [
    encoder.encode(selectedFonts[index].familyName),
    encoder.encode(selectedFonts[index].font.fingerprintSha256)
  ]);
  const fontStringBytes = new Uint8Array(encodedFontStrings.reduce((sum, bytes) => sum + bytes.byteLength, 0));
  const fontStringRanges = new Uint32Array(source.styleRuns.length * 4);
  let stringOffset = 0;
  encodedFontStrings.forEach((bytes, index) => {
    fontStringRanges[index * 2] = stringOffset;
    fontStringBytes.set(bytes, stringOffset);
    stringOffset += bytes.byteLength;
    fontStringRanges[index * 2 + 1] = stringOffset;
  });
  const styleMeta = new Uint32Array(source.styleRuns.length * 5);
  const styleMetrics = new Float32Array(source.styleRuns.length * 4);
  source.styleRuns.forEach((run, sourceRunIndex) => {
    styleMeta.set([
      run.start, run.end, sourceRunIndex,
      run.fontStyle === 'normal' ? 0 : run.fontStyle === 'italic' ? 1 : 2,
      selectedFonts[sourceRunIndex].font.faceIndex
    ], sourceRunIndex * 5);
    styleMetrics.set([run.fontSize, run.fontWeight, run.fontStretch, run.tracking], sourceRunIndex * 4);
  });
  const raw = realizeFlowText(
    sessionKey(request), request.cacheKey, source.text,
    source.layout.mode === 'paragraph' ? source.layout.frame.width : undefined,
    paragraphStyle.alignment,
    paragraphStyle.lineHeightKind,
    paragraphStyle.lineHeightValue,
    paragraphStyle.firstLineIndent,
    paragraphStyle.startIndent,
    paragraphStyle.endIndent,
    paragraphStyle.spaceBefore,
    paragraphStyle.spaceAfter,
    source.layout.mode === 'paragraph' ? source.layout.frame.x : source.layout.origin.x,
    source.layout.mode === 'paragraph' ? source.layout.frame.y : source.layout.origin.y,
    request.options.maxGlyphCount, styleMeta, styleMetrics, fontStringBytes, fontStringRanges
  );
  const runMeta = raw.run_meta();
  const glyphIds = raw.glyph_ids();
  const clusters = raw.clusters();
  const geometry = raw.geometry();
  const lineMeta = raw.line_meta();
  const lineGeometry = raw.line_geometry();
  const caretMeta = raw.caret_meta();
  const caretGeometry = raw.caret_geometry();
  const selectionMeta = raw.selection_meta();
  const packedSelectionGeometry = raw.selection_geometry();
  const packedClusterMap = raw.cluster_map();
  const bounds = raw.bounds();
  const layoutOriginY = source.layout.mode === 'paragraph'
    ? source.layout.frame.y
    : source.layout.origin.y;
  const firstBaselineOffset = lineGeometry.length >= 7
    ? lineGeometry[0] - layoutOriginY
    : 0;
  if (source.layout.mode === 'point') {
    alignPackedPointTextBaseline({
      glyphGeometry: geometry,
      lineGeometry,
      caretGeometry,
      selectionGeometry: packedSelectionGeometry,
      bounds
    }, source.layout.origin.y);
  }
  const glyphRuns: RealizedTextLayout['glyphRuns'] = Array.from(
    { length: runMeta.length / 5 }, (_, index) => {
      const sourceRunIndex = runMeta[index * 5];
      if (runMeta[index * 5 + 2] !== 1) {
        raw.free();
        throw new UnsupportedLayoutError('Parley selected a fallback font; Slice 06 refuses to misreport exact provenance.');
      }
      const start = runMeta[index * 5 + 3];
      const end = runMeta[index * 5 + 4];
      const style = source.styleRuns[sourceRunIndex];
      if (!style) {
        raw.free();
        throw new Error('Parley returned an invalid source style index.');
      }
      return {
        font: {
          font: selectedFonts[sourceRunIndex].font,
          variableAxes: style.variableAxes,
          syntheticBold: style.syntheticBold,
          syntheticItalic: style.syntheticItalic
        },
        fontSize: style.fontSize,
        fontResolution: selectedFonts[sourceRunIndex].resolution,
        paint: { ...(style.fill ? { fill: style.fill } : {}), ...(style.stroke ? { stroke: style.stroke } : {}) },
        renderingMode: style.stroke ? 'fill-stroke' : 'fill',
        direction: runMeta[index * 5 + 1] === 1 ? 'rtl' : 'ltr',
        ...(style.language ? { language: style.language } : {}),
        glyphIds: glyphIds.slice(start, end),
        clusters: clusters.slice(start, end),
        geometry: geometry.slice(start * 4, end * 4)
      };
    }
  );
  const lines: RealizedTextLayout['lines'] = Array.from(
    { length: lineMeta.length / 2 }, (_, index) => ({
      start: lineMeta[index * 2], end: lineMeta[index * 2 + 1],
      baseline: lineGeometry[index * 7], ascent: lineGeometry[index * 7 + 1],
      descent: lineGeometry[index * 7 + 2], bounds: rectAt(lineGeometry, index * 7 + 3)
    })
  );
  const layout: RealizedTextLayout = {
    schemaVersion: TEXT_LAYOUT_SCHEMA_VERSION,
    key: raw.key,
    glyphRuns,
    lines,
    caretStops: Array.from({ length: caretMeta.length / 2 }, (_, index) => ({
      textOffset: caretMeta[index * 2],
      affinity: caretMeta[index * 2 + 1] === 1 ? 'downstream' : 'upstream',
      x: caretGeometry[index * 3], y: caretGeometry[index * 3 + 1],
      height: caretGeometry[index * 3 + 2]
    })),
    selectionGeometry: Array.from({ length: selectionMeta.length / 2 }, (_, index) => ({
      start: selectionMeta[index * 2], end: selectionMeta[index * 2 + 1],
      bounds: rectAt(packedSelectionGeometry, index * 4)
    })),
    clusterMap: Array.from({ length: packedClusterMap.length / 4 }, (_, index) => ({
      textStart: packedClusterMap[index * 4], textEnd: packedClusterMap[index * 4 + 1],
      glyphStart: packedClusterMap[index * 4 + 2], glyphEnd: packedClusterMap[index * 4 + 3]
    })),
    inkBounds: rectAt(bounds, 0),
    logicalBounds: rectAt(bounds, 4),
    firstBaselineOffset,
    ...(source.layout.mode === 'paragraph'
      ? { paragraphFrame: realizeParagraphFrame(source.layout, lines) }
      : {}),
    warnings: glyphRuns.flatMap((run, runIndex) => [
      ...(run.fontResolution.kind === 'flow-substituted'
        ? [{ code: 'font-substituted' as const, message: 'The requested font was explicitly substituted.', runIndex }]
        : []),
      ...(run.glyphIds.includes(0)
        ? [{ code: 'missing-glyph' as const, message: 'The selected font emitted .notdef.', runIndex }]
        : [])
    ])
  };
  raw.free();
  return {
    kind: 'text-realized',
    protocolVersion: TEXT_WORKER_PROTOCOL_VERSION,
    requestId: request.requestId,
    documentSessionId: request.documentSessionId,
    sessionGeneration: request.sessionGeneration,
    cacheKey: request.cacheKey,
    layout: finalizeLayout(layout),
    transferOwnership: 'dedicated',
    metrics: {
      operationDurationMs: performance.now() - operationStartedAt,
      wasmLinearMemoryBytes: textEngineMemoryBytes()
    }
  };
};

const shapeParagraphFragment = (
  request: TextLayoutWorkerRequest,
  segment: FlowParagraphSegment,
  selectedFonts: readonly TextWorkerFlowFontSelection[],
  paragraph: UniformParagraphLayout
): PackedParagraphFragment => {
  const encoder = new TextEncoder();
  const encodedFontStrings = segment.textStyles.flatMap(({ sourceRunIndex, run }) => {
    const font = selectedFonts[sourceRunIndex];
    if (!font) throw new Error('Paragraph font provenance is unavailable.');
    return [
      encoder.encode(font.familyName),
      encoder.encode(font.font.fingerprintSha256)
    ];
  });
  const fontStringBytes = new Uint8Array(encodedFontStrings.reduce((sum, bytes) => sum + bytes.byteLength, 0));
  const fontStringRanges = new Uint32Array(segment.textStyles.length * 4);
  let stringOffset = 0;
  encodedFontStrings.forEach((bytes, index) => {
    fontStringRanges[index * 2] = stringOffset;
    fontStringBytes.set(bytes, stringOffset);
    stringOffset += bytes.byteLength;
    fontStringRanges[index * 2 + 1] = stringOffset;
  });
  const styleMeta = new Uint32Array(segment.textStyles.length * 5);
  const styleMetrics = new Float32Array(segment.textStyles.length * 4);
  segment.textStyles.forEach(({ sourceRunIndex, run }, localStyleSlot) => {
    const font = selectedFonts[sourceRunIndex];
    if (!font) throw new Error('Paragraph font provenance is unavailable.');
    styleMeta.set([
      run.start,
      run.end,
      localStyleSlot,
      run.fontStyle === 'normal' ? 0 : run.fontStyle === 'italic' ? 1 : 2,
      font.font.faceIndex
    ], localStyleSlot * 5);
    styleMetrics.set([run.fontSize, run.fontWeight, run.fontStretch, run.tracking], localStyleSlot * 4);
  });
  const raw = realizeFlowText(
    sessionKey(request),
    'paragraph-fragment',
    segment.text,
    request.layer.source.kind === 'flow' && request.layer.source.layout.mode === 'paragraph'
      ? request.layer.source.layout.frame.width
      : undefined,
    paragraph.alignment,
    paragraph.lineHeightKind,
    paragraph.lineHeightValue,
    paragraph.firstLineIndent,
    paragraph.startIndent,
    paragraph.endIndent,
    0,
    0,
    0,
    0,
    request.options.maxGlyphCount,
    styleMeta,
    styleMetrics,
    fontStringBytes,
    fontStringRanges
  );
  try {
    return Object.freeze({
      runMeta: Uint32Array.from(raw.run_meta()),
      glyphIds: Uint32Array.from(raw.glyph_ids()),
      clusters: Uint32Array.from(raw.clusters()),
      geometry: Float32Array.from(raw.geometry()),
      lineMeta: Uint32Array.from(raw.line_meta()),
      lineGeometry: Float32Array.from(raw.line_geometry()),
      caretMeta: Uint32Array.from(raw.caret_meta()),
      caretGeometry: Float32Array.from(raw.caret_geometry()),
      selectionMeta: Uint32Array.from(raw.selection_meta()),
      selectionGeometry: Float32Array.from(raw.selection_geometry()),
      clusterMap: Uint32Array.from(raw.cluster_map()),
      bounds: Float32Array.from(raw.bounds())
    });
  } finally {
    raw.free();
  }
};

const rectAt = (values: Float32Array, offset: number) => ({
  x: values[offset], y: values[offset + 1], width: values[offset + 2], height: values[offset + 3]
});
