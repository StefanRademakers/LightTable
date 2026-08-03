/// <reference lib="webworker" />

import initializeTextLayoutWasm, {
  drop_layout_session as dropLayoutSession,
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
  type FontAssetRef,
  type RealizedTextLayout,
  type TextLayoutWorkerRequest,
  type TextLayoutWorkerResponse,
  type TextWorkerRequest
} from '@lighttable/text-core';
import {
  TEXT_ENGINE_PROTOCOL_VERSION,
  type TextEngineWorkerRequest,
  type TextEngineWorkerResponse
} from './textEngineProtocol';

let initialization: Promise<{ engineVersion: string; loadDurationMs: number }> | null = null;
const layoutSessions = new Map<string, {
  revision: number;
  fingerprints: Set<string>;
  faceCounts: Map<string, number>;
  fonts: Map<string, FontAssetRef>;
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
    || data.kind === 'cancel-text' || data.kind === 'release-session') {
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
    layoutSessions.delete(key);
    dropLayoutSession(key);
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
  if (!state && (data.kind === 'realize-text' || data.kind === 'rasterize-glyph')) {
    if (data.kind === 'realize-text') {
      self.postMessage(layoutFailure(data, 'font-missing', 'Layout session has no registered fonts.'));
    } else {
      self.postMessage({
        kind: 'glyph-rasterization-failed', protocolVersion: TEXT_WORKER_PROTOCOL_VERSION,
        requestId: data.requestId, documentSessionId: data.documentSessionId,
        sessionGeneration: data.sessionGeneration, assetId: data.assetId,
        glyphId: data.glyphId,
        error: createTextLayoutError('font-missing', 'Raster session has no registered fonts.')
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
    fonts: new Map<string, FontAssetRef>()
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
  let response: TextLayoutWorkerResponse;
  try {
    response = realizeFlowRequest(data, state);
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : 'Text layout failed.';
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
  state: { revision: number; fonts: Map<string, FontAssetRef> }
): TextLayoutWorkerResponse => {
  const operationStartedAt = performance.now();
  if (request.fontSnapshotRevision !== state.revision) {
    return layoutFailure(request, 'schema-mismatch', 'Font snapshot revision is stale.');
  }
  if (request.layer.source.kind === 'positioned') {
    throw new UnsupportedLayoutError('Positioned text realization requires exact outline bounds and is not enabled in Slice 06.');
  }
  const source = request.layer.source;
  if (source.layout.mode === 'path' || source.layout.writingMode !== 'horizontal-tb') {
    throw new UnsupportedLayoutError('Path and vertical text require a later layout adapter.');
  }
  const selectedFonts = source.styleRuns.map((run) => {
    if (run.directionOverride || run.scriptOverride || run.kerning === 'optical' || run.kerning === 'none'
      || run.horizontalScale !== 100 || run.verticalScale !== 100 || run.baselineShift !== 0
      || Object.keys(run.openTypeFeatures).length > 0 || Object.keys(run.variableAxes).length > 0
      || run.syntheticBold || run.syntheticItalic) {
      throw new UnsupportedLayoutError('Overrides, optical/disabled kerning, baseline or geometric scaling, variations, synthesis and OpenType feature changes are not supported yet.');
    }
    const preferred = run.requestedFont.preferredAsset;
    const font = preferred ? state.fonts.get(preferred.assetId) : undefined;
    if (!font) throw new UnsupportedLayoutError('Every Slice 06 flow run requires an exact registered preferred font.');
    return font;
  });
  for (const paragraph of source.paragraphRuns) {
    if (paragraph.alignment !== 'start' || paragraph.direction !== 'auto'
      || paragraph.lineHeight.kind !== 'normal' || paragraph.firstLineIndent !== 0
      || paragraph.startIndent !== 0 || paragraph.endIndent !== 0 || paragraph.spaceBefore !== 0
      || paragraph.spaceAfter !== 0 || paragraph.hyphenation !== 'off') {
      throw new UnsupportedLayoutError('Non-default paragraph formatting requires the paragraph layout slice.');
    }
  }
  const encoder = new TextEncoder();
  const encodedFontStrings = source.styleRuns.flatMap((run, index) => [
    encoder.encode(run.requestedFont.families[0] ?? run.requestedFont.postScriptName ?? ''),
    encoder.encode(selectedFonts[index].fingerprintSha256)
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
      selectedFonts[sourceRunIndex].faceIndex
    ], sourceRunIndex * 5);
    styleMetrics.set([run.fontSize, run.fontWeight, run.fontStretch, run.tracking], sourceRunIndex * 4);
  });
  const raw = realizeFlowText(
    sessionKey(request), request.cacheKey, source.text,
    source.layout.mode === 'paragraph' ? source.layout.frame.width : undefined,
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
          font: selectedFonts[sourceRunIndex],
          variableAxes: style.variableAxes,
          syntheticBold: style.syntheticBold,
          syntheticItalic: style.syntheticItalic
        },
        fontSize: style.fontSize,
        fontResolution: {
          kind: 'flow-exact',
          sourceRunIndex,
          requested: style.requestedFont
        },
        paint: { fill: style.fill, ...(style.stroke ? { stroke: style.stroke } : {}) },
        renderingMode: style.stroke ? 'fill-stroke' : 'fill',
        direction: runMeta[index * 5 + 1] === 1 ? 'rtl' : 'ltr',
        ...(style.language ? { language: style.language } : {}),
        glyphIds: glyphIds.slice(start, end),
        clusters: clusters.slice(start, end),
        geometry: geometry.slice(start * 4, end * 4)
      };
    }
  );
  const layout: RealizedTextLayout = {
    schemaVersion: TEXT_LAYOUT_SCHEMA_VERSION,
    key: raw.key,
    glyphRuns,
    lines: Array.from({ length: lineMeta.length / 2 }, (_, index) => ({
      start: lineMeta[index * 2], end: lineMeta[index * 2 + 1],
      baseline: lineGeometry[index * 7], ascent: lineGeometry[index * 7 + 1],
      descent: lineGeometry[index * 7 + 2], bounds: rectAt(lineGeometry, index * 7 + 3)
    })),
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
    warnings: glyphRuns.flatMap((run, runIndex) => run.glyphIds.includes(0)
      ? [{ code: 'missing-glyph' as const, message: 'The selected font emitted .notdef.', runIndex }]
      : [])
  };
  raw.free();
  return {
    kind: 'text-realized',
    protocolVersion: TEXT_WORKER_PROTOCOL_VERSION,
    requestId: request.requestId,
    documentSessionId: request.documentSessionId,
    sessionGeneration: request.sessionGeneration,
    cacheKey: request.cacheKey,
    layout,
    transferOwnership: 'dedicated',
    metrics: {
      operationDurationMs: performance.now() - operationStartedAt,
      wasmLinearMemoryBytes: textEngineMemoryBytes()
    }
  };
};

const rectAt = (values: Float32Array, offset: number) => ({
  x: values[offset], y: values[offset + 1], width: values[offset + 2], height: values[offset + 3]
});
