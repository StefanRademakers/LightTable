export type PdfExportFontEmbeddingLevel =
  | 'installable' | 'editable' | 'preview-print' | 'restricted' | 'unknown';
export type PdfExportFontContainer = 'sfnt' | 'woff' | 'woff2' | 'raw-cff' | 'unknown';
export type PdfExportFontOutline = 'truetype' | 'cff' | 'cff2' | 'svg' | 'bitmap' | 'mixed' | 'unknown';

export interface PdfExportFontAssetInput {
  readonly assetId: string;
  readonly fingerprintSha256: string;
  readonly postScriptName: string | null;
  readonly source: 'bundled' | 'document' | 'system' | 'imported' | 'pdf-subset';
  readonly container: PdfExportFontContainer;
  readonly outline: PdfExportFontOutline;
  readonly embeddingLevel: PdfExportFontEmbeddingLevel;
  readonly noSubsetting: boolean;
  readonly bitmapOnly: boolean;
  readonly bytesAvailable: boolean;
  readonly outlineExtractionAvailable: boolean;
}

export interface PdfExportSemanticSpan {
  readonly glyphStart: number;
  readonly glyphEnd: number;
  readonly unicode: string;
  readonly confidence: number;
}

export interface PdfExportTextRunInput {
  readonly runId: string;
  readonly fontAssetId: string;
  readonly glyphIds: readonly number[];
  readonly semanticSpans: readonly PdfExportSemanticSpan[];
  readonly logicalOrderConfidence: number;
  readonly variableAxes: Readonly<Record<string, number>>;
  readonly syntheticBold: boolean;
  readonly syntheticItalic: boolean;
  readonly paintSupport: 'pdf-text' | 'outline-required' | 'raster-required';
  readonly geometrySupport: 'pdf-text' | 'outline-required' | 'raster-required';
}

export interface PdfExportTextLayerInput {
  readonly layerId: string;
  readonly name: string;
  readonly sourceKind: 'flow' | 'positioned';
  readonly effectsSupport: 'pdf-native' | 'outline-required' | 'raster-required';
  readonly unavailableReason?: 'text-layout-unavailable' | 'font-resolution-unavailable';
  readonly runs: readonly PdfExportTextRunInput[];
}

export interface PdfTextExportPlanInput {
  readonly fonts: readonly PdfExportFontAssetInput[];
  readonly layers: readonly PdfExportTextLayerInput[];
}

export interface PdfTextExportLimits {
  readonly maximumLayerCount: number;
  readonly maximumRunCount: number;
  readonly maximumGlyphCount: number;
  readonly maximumUniqueGlyphsPerFontInstance: number;
  readonly maximumEncodingEntriesPerRun: number;
}

export const DEFAULT_PDF_TEXT_EXPORT_LIMITS: PdfTextExportLimits = Object.freeze({
  maximumLayerCount: 100_000,
  maximumRunCount: 1_000_000,
  maximumGlyphCount: 10_000_000,
  maximumUniqueGlyphsPerFontInstance: 65_534,
  maximumEncodingEntriesPerRun: 65_534
});

export interface PdfTextExportPolicy {
  readonly minimumSemanticConfidence: number;
  readonly allowOutlineFallback: boolean;
  readonly allowRasterFallback: boolean;
  /** Restricted embedding requires a separate explicit product/legal choice. */
  readonly allowRestrictedFontOutlineFallback: boolean;
}

export const DEFAULT_PDF_TEXT_EXPORT_POLICY: PdfTextExportPolicy = Object.freeze({
  minimumSemanticConfidence: 0.8,
  allowOutlineFallback: true,
  allowRasterFallback: true,
  allowRestrictedFontOutlineFallback: false
});

export type PdfTextExportReasonCode =
  | 'semantic-mapping-incomplete'
  | 'text-realization-unavailable'
  | 'semantic-confidence-low'
  | 'synthetic-style-requires-outlines'
  | 'paint-requires-outlines'
  | 'paint-requires-raster'
  | 'geometry-requires-outlines'
  | 'geometry-requires-raster'
  | 'effects-require-outlines'
  | 'effects-require-raster'
  | 'font-bytes-unavailable'
  | 'font-embedding-restricted'
  | 'font-embedding-unknown'
  | 'font-bitmap-only'
  | 'font-format-requires-raster'
  | 'font-format-requires-outlines'
  | 'glyph-id-out-of-range'
  | 'raw-cff-full-embed'
  | 'outline-fallback-disabled'
  | 'raster-fallback-disabled'
  | 'outline-extraction-unavailable'
  | 'harfbuzz-subset'
  | 'harfbuzz-static-instance-subset'
  | 'full-font-required'
  | 'existing-pdf-subset-preserved';

export interface PdfTextExportReason {
  readonly code: PdfTextExportReasonCode;
  readonly message: string;
}

export type PdfExportFontDisposition =
  | 'subset' | 'embed-existing' | 'embed-full' | 'outline' | 'raster' | 'blocked';

export interface PdfExportFontPlan {
  readonly instanceId: string;
  readonly assetId: string;
  readonly variableAxes: Readonly<Record<string, number>>;
  readonly disposition: PdfExportFontDisposition;
  readonly glyphIds: readonly number[];
  readonly subsetter: 'harfbuzz' | null;
  readonly retainGlyphIds: boolean;
  readonly requiresSfntDecode: boolean;
  readonly requiresConfirmation: boolean;
  readonly reasons: readonly PdfTextExportReason[];
}

export interface PdfExportEncodingEntry {
  readonly code: number;
  readonly glyphId: number;
  /** Null is covered by a surrounding ActualText span. */
  readonly unicode: string | null;
}

export interface PdfExportActualTextSpan {
  readonly glyphStart: number;
  readonly glyphEnd: number;
  readonly unicode: string;
}

export type PdfExportRunDisposition = 'text' | 'outline' | 'raster' | 'blocked';

export interface PdfExportTextRunPlan {
  readonly runId: string;
  readonly fontInstanceId: string;
  /** Run-local character-code/CMap resource; null when no PDF text is emitted. */
  readonly encodingId: string | null;
  readonly disposition: PdfExportRunDisposition;
  readonly encoding: readonly PdfExportEncodingEntry[];
  readonly actualText: readonly PdfExportActualTextSpan[];
  readonly searchable: boolean;
  readonly requiresConfirmation: boolean;
  readonly reasons: readonly PdfTextExportReason[];
}

export type PdfExportTextLayerDisposition = 'text' | 'mixed' | 'outline' | 'raster' | 'blocked';

export interface PdfExportTextLayerPlan {
  readonly layerId: string;
  readonly name: string;
  readonly sourceKind: 'flow' | 'positioned';
  readonly disposition: PdfExportTextLayerDisposition;
  readonly searchable: boolean;
  readonly requiresConfirmation: boolean;
  readonly reasons: readonly PdfTextExportReason[];
  readonly runs: readonly PdfExportTextRunPlan[];
}

export interface PdfTextExportPlan {
  readonly fonts: readonly PdfExportFontPlan[];
  readonly layers: readonly PdfExportTextLayerPlan[];
  readonly canExport: boolean;
  readonly requiresConfirmation: boolean;
  readonly summary: Readonly<Record<PdfExportFontDisposition, number>>;
}

const fail = (message: string): never => { throw new Error(`PDF text export input ${message}`); };
const boundedArray = <T>(value: readonly T[], maximum: number, path: string) => {
  if (value.length > maximum) fail(`${path} exceeds ${maximum} entries.`);
};
const finiteConfidence = (value: number, path: string) => {
  if (!Number.isFinite(value) || value < 0 || value > 1) fail(`${path} must be between zero and one.`);
};
const uniqueId = (value: string, ids: Set<string>, path: string) => {
  if (!value) fail(`${path} must not be empty.`);
  if (ids.has(value)) fail(`${path} duplicates ${value}.`);
  ids.add(value);
};
const reason = (code: PdfTextExportReasonCode, message: string): PdfTextExportReason => ({ code, message });

const stableAxes = (axes: Readonly<Record<string, number>>) => Object.entries(axes)
  .sort(([left], [right]) => left.localeCompare(right));
const instanceIdFor = (assetId: string, axes: Readonly<Record<string, number>>) => {
  const suffix = stableAxes(axes).map(([tag, value]) => `${tag}=${value}`).join(',');
  return suffix ? `${assetId}[${suffix}]` : assetId;
};

interface ValidatedRun {
  readonly layer: PdfExportTextLayerInput;
  readonly run: PdfExportTextRunInput;
  readonly font: PdfExportFontAssetInput;
  readonly instanceId: string;
  readonly semanticComplete: boolean;
}

const validateInput = (
  input: PdfTextExportPlanInput,
  policy: PdfTextExportPolicy,
  limits: PdfTextExportLimits
): readonly ValidatedRun[] => {
  boundedArray(input.layers, limits.maximumLayerCount, '$.layers');
  finiteConfidence(policy.minimumSemanticConfidence, 'policy.minimumSemanticConfidence');
  const fontIds = new Set<string>();
  const fonts = new Map<string, PdfExportFontAssetInput>();
  input.fonts.forEach((font, index) => {
    uniqueId(font.assetId, fontIds, `$.fonts[${index}].assetId`);
    if (!/^[a-f0-9]{64}$/i.test(font.fingerprintSha256)) {
      fail(`$.fonts[${index}].fingerprintSha256 must be a SHA-256 hex digest.`);
    }
    fonts.set(font.assetId, font);
  });
  const layerIds = new Set<string>();
  const runIds = new Set<string>();
  const validated: ValidatedRun[] = [];
  let runCount = 0;
  let glyphCount = 0;
  input.layers.forEach((layer, layerIndex) => {
    uniqueId(layer.layerId, layerIds, `$.layers[${layerIndex}].layerId`);
    if (layer.runs.length === 0 && layer.unavailableReason === undefined) {
      fail(`$.layers[${layerIndex}].runs must not be empty without an unavailable reason.`);
    }
    runCount += layer.runs.length;
    if (runCount > limits.maximumRunCount) fail('$.layers runs exceed the run limit.');
    layer.runs.forEach((run, runIndex) => {
      const path = `$.layers[${layerIndex}].runs[${runIndex}]`;
      uniqueId(run.runId, runIds, `${path}.runId`);
      const font = fonts.get(run.fontAssetId);
      if (font === undefined) return fail(`${path}.fontAssetId references a missing font.`);
      finiteConfidence(run.logicalOrderConfidence, `${path}.logicalOrderConfidence`);
      glyphCount += run.glyphIds.length;
      if (glyphCount > limits.maximumGlyphCount) fail('$.layers glyphs exceed the glyph limit.');
      run.glyphIds.forEach((glyphId, glyphIndex) => {
        if (!Number.isSafeInteger(glyphId) || glyphId < 0 || glyphId > 0xffff_ffff) {
          fail(`${path}.glyphIds[${glyphIndex}] must be an unsigned 32-bit integer.`);
        }
      });
      let cursor = 0;
      let semanticComplete = run.glyphIds.length > 0;
      run.semanticSpans.forEach((span, spanIndex) => {
        finiteConfidence(span.confidence, `${path}.semanticSpans[${spanIndex}].confidence`);
        if (!Number.isSafeInteger(span.glyphStart) || !Number.isSafeInteger(span.glyphEnd)
          || span.glyphStart !== cursor || span.glyphEnd <= span.glyphStart
          || span.glyphEnd > run.glyphIds.length || span.unicode.length === 0) {
          semanticComplete = false;
        }
        cursor = span.glyphEnd;
      });
      semanticComplete = semanticComplete && cursor === run.glyphIds.length;
      stableAxes(run.variableAxes).forEach(([tag, value]) => {
        if (!/^[\x20-\x7e]{4}$/.test(tag) || !Number.isFinite(value)) {
          fail(`${path}.variableAxes contains an invalid OpenType axis.`);
        }
      });
      validated.push({
        layer, run, font,
        instanceId: instanceIdFor(font.assetId, run.variableAxes),
        semanticComplete
      });
    });
  });
  return validated;
};

const fallback = (
  preferred: 'outline' | 'raster',
  font: PdfExportFontAssetInput,
  policy: PdfTextExportPolicy,
  reasons: readonly PdfTextExportReason[]
): { disposition: 'outline' | 'raster' | 'blocked'; reasons: readonly PdfTextExportReason[] } => {
  if (preferred === 'outline') {
    if (font.embeddingLevel === 'restricted' && !policy.allowRestrictedFontOutlineFallback) {
      return {
        disposition: 'blocked',
        reasons: [...reasons, reason(
          'font-embedding-restricted',
          'The font explicitly forbids embedding; outline fallback requires separate confirmation and is disabled.'
        )]
      };
    }
    if (!policy.allowOutlineFallback) return {
      disposition: 'blocked', reasons: [...reasons, reason('outline-fallback-disabled', 'Outline fallback is disabled.')]
    };
    if (!font.outlineExtractionAvailable) {
      return policy.allowRasterFallback
        ? { disposition: 'raster', reasons: [...reasons, reason('outline-extraction-unavailable', 'Glyph outlines are unavailable; raster fallback is required.')] }
        : { disposition: 'blocked', reasons: [...reasons, reason('outline-extraction-unavailable', 'Glyph outlines are unavailable.')] };
    }
    return { disposition: 'outline', reasons };
  }
  return policy.allowRasterFallback
    ? { disposition: 'raster', reasons }
    : { disposition: 'blocked', reasons: [...reasons, reason('raster-fallback-disabled', 'Raster fallback is disabled.')] };
};

const fontDisposition = (
  font: PdfExportFontAssetInput,
  hasVariableAxes: boolean,
  policy: PdfTextExportPolicy
): { disposition: PdfExportFontDisposition; subsetter: 'harfbuzz' | null; requiresSfntDecode: boolean; reasons: readonly PdfTextExportReason[] } => {
  if (font.embeddingLevel === 'restricted') {
    if (!policy.allowRestrictedFontOutlineFallback) return {
      disposition: 'blocked', subsetter: null, requiresSfntDecode: false,
      reasons: [reason('font-embedding-restricted', 'The font explicitly forbids embedding; outline fallback requires separate confirmation and is disabled.')]
    };
    const result = fallback('outline', font, policy, [
      reason('font-embedding-restricted', 'The font explicitly forbids embedding; text will be outlined by explicit policy.')
    ]);
    return { ...result, subsetter: null, requiresSfntDecode: false };
  }
  if (font.embeddingLevel === 'unknown') {
    const result = fallback('outline', font, policy, [
      reason('font-embedding-unknown', 'Embedding rights are unknown; font bytes will not be embedded.')
    ]);
    return { ...result, subsetter: null, requiresSfntDecode: false };
  }
  if (font.bitmapOnly || font.outline === 'bitmap' || font.outline === 'mixed') {
    const result = fallback('raster', font, policy, [
      reason('font-bitmap-only', 'Bitmap or mixed color glyphs require raster fallback for visual fidelity.')
    ]);
    return { ...result, subsetter: null, requiresSfntDecode: false };
  }
  if (font.outline === 'svg') {
    const result = fallback('raster', font, policy, [
      reason('font-format-requires-raster', 'SVG glyph paint is not representable as a standard PDF text font.')
    ]);
    return { ...result, subsetter: null, requiresSfntDecode: false };
  }
  if (font.outline === 'unknown' || font.container === 'unknown') {
    const result = fallback('outline', font, policy, [
      reason('font-format-requires-outlines', 'The font program format cannot be embedded safely.')
    ]);
    return { ...result, subsetter: null, requiresSfntDecode: false };
  }
  if (!font.bytesAvailable) {
    const result = fallback('outline', font, policy, [
      reason('font-bytes-unavailable', 'Font bytes are unavailable for portable PDF embedding.')
    ]);
    return { ...result, subsetter: null, requiresSfntDecode: false };
  }
  if (font.source === 'pdf-subset' && !hasVariableAxes) return {
    disposition: 'embed-existing', subsetter: null, requiresSfntDecode: false,
    reasons: [reason('existing-pdf-subset-preserved', 'The exact imported PDF subset program will be re-embedded.')]
  };
  if (font.container === 'raw-cff') return {
    disposition: 'embed-full', subsetter: null, requiresSfntDecode: false,
    reasons: [reason('raw-cff-full-embed', 'The complete raw CFF program will be embedded as a PDF CFF font stream.')]
  };
  if (font.noSubsetting) return {
    disposition: 'embed-full', subsetter: null,
    requiresSfntDecode: font.container === 'woff' || font.container === 'woff2',
    reasons: [reason('full-font-required', 'The font embedding rights prohibit subsetting.')]
  };
  return {
    disposition: 'subset', subsetter: 'harfbuzz',
    requiresSfntDecode: font.container === 'woff' || font.container === 'woff2',
    reasons: [reason(
      hasVariableAxes ? 'harfbuzz-static-instance-subset' : 'harfbuzz-subset',
      hasVariableAxes
        ? 'HarfBuzz will pin the variable axes and emit a static PDF font subset.'
        : 'HarfBuzz will subset the exact glyph closure for PDF embedding.'
    )]
  };
};

const directRunFallback = (
  entry: ValidatedRun,
  policy: PdfTextExportPolicy
): { disposition: 'outline' | 'raster' | 'blocked'; reasons: readonly PdfTextExportReason[] } | null => {
  const { layer, run, font, semanticComplete } = entry;
  if (layer.effectsSupport === 'raster-required') return fallback('raster', font, policy, [
    reason('effects-require-raster', 'Layer effects require raster compositing in PDF export.')
  ]);
  if (run.paintSupport === 'raster-required') return fallback('raster', font, policy, [
    reason('paint-requires-raster', 'The text paint requires raster compositing.')
  ]);
  if (run.geometrySupport === 'raster-required') return fallback('raster', font, policy, [
    reason('geometry-requires-raster', 'The text geometry cannot be represented by PDF text or outlines.')
  ]);
  if (layer.effectsSupport === 'outline-required') return fallback('outline', font, policy, [
    reason('effects-require-outlines', 'Layer effects require glyph outlines.')
  ]);
  if (run.paintSupport === 'outline-required') return fallback('outline', font, policy, [
    reason('paint-requires-outlines', 'The text paint requires glyph outlines.')
  ]);
  if (run.geometrySupport === 'outline-required') return fallback('outline', font, policy, [
    reason('geometry-requires-outlines', 'The text geometry requires glyph outlines.')
  ]);
  if (run.syntheticBold || run.syntheticItalic) return fallback('outline', font, policy, [
    reason('synthetic-style-requires-outlines', 'Synthetic font styles require outlines for deterministic export.')
  ]);
  if (run.glyphIds.some(glyphId => glyphId > 0xffff)) return fallback('outline', font, policy, [
    reason('glyph-id-out-of-range', 'The font glyph ID exceeds the 16-bit PDF CIDToGIDMap range.')
  ]);
  if (!semanticComplete) return fallback('outline', font, policy, [
    reason('semantic-mapping-incomplete', 'The glyph run does not have complete logical Unicode coverage.')
  ]);
  if (run.logicalOrderConfidence < policy.minimumSemanticConfidence
    || run.semanticSpans.some(span => span.confidence < policy.minimumSemanticConfidence)) {
    return fallback('outline', font, policy, [
      reason('semantic-confidence-low', 'Logical text confidence is below the PDF text-object threshold.')
    ]);
  }
  return null;
};

const encodingFor = (
  run: PdfExportTextRunInput,
  maximumEntries: number
): { encoding: readonly PdfExportEncodingEntry[]; actualText: readonly PdfExportActualTextSpan[] } => {
  const entries: PdfExportEncodingEntry[] = [];
  const actualText: PdfExportActualTextSpan[] = [];
  const codeByIdentity = new Map<string, number>();
  for (const span of run.semanticSpans) {
    const direct = span.glyphEnd - span.glyphStart === 1;
    if (!direct) actualText.push({ glyphStart: span.glyphStart, glyphEnd: span.glyphEnd, unicode: span.unicode });
    for (let glyphIndex = span.glyphStart; glyphIndex < span.glyphEnd; glyphIndex += 1) {
      const glyphId = run.glyphIds[glyphIndex]!;
      const unicode = direct ? span.unicode : null;
      const identity = `${glyphId}:${unicode ?? ''}`;
      let code = codeByIdentity.get(identity);
      if (code === undefined) {
        code = codeByIdentity.size + 1;
        if (code > maximumEntries) fail(`run ${run.runId} exceeds the encoding-entry limit.`);
        codeByIdentity.set(identity, code);
      }
      entries.push({ code, glyphId, unicode });
    }
  }
  return { encoding: entries, actualText };
};

/** Produces a bounded writer-neutral preflight; it never reads font bytes or mutates source state. */
export const planPdfTextExport = (
  input: PdfTextExportPlanInput,
  policyOverrides: Partial<PdfTextExportPolicy> = {},
  limitOverrides: Partial<PdfTextExportLimits> = {}
): PdfTextExportPlan => {
  const policy = { ...DEFAULT_PDF_TEXT_EXPORT_POLICY, ...policyOverrides };
  const limits = { ...DEFAULT_PDF_TEXT_EXPORT_LIMITS, ...limitOverrides };
  const entries = validateInput(input, policy, limits);
  const directFallback = new Map<string, ReturnType<typeof directRunFallback>>();
  entries.forEach(entry => directFallback.set(entry.run.runId, directRunFallback(entry, policy)));

  const usage = new Map<string, {
    font: PdfExportFontAssetInput;
    axes: Readonly<Record<string, number>>;
    glyphs: Set<number>;
    direct: boolean;
    fallback: Array<Exclude<ReturnType<typeof directRunFallback>, null>>;
  }>();
  entries.forEach(entry => {
    const runFallback = directFallback.get(entry.run.runId);
    const current = usage.get(entry.instanceId) ?? {
      font: entry.font, axes: entry.run.variableAxes, glyphs: new Set<number>([0]),
      direct: false, fallback: []
    };
    entry.run.glyphIds.forEach(glyphId => current.glyphs.add(glyphId));
    if (current.glyphs.size > limits.maximumUniqueGlyphsPerFontInstance) {
      fail(`font instance ${entry.instanceId} exceeds the unique-glyph limit.`);
    }
    if (runFallback) current.fallback.push(runFallback);
    else current.direct = true;
    usage.set(entry.instanceId, current);
  });

  const fonts = [...usage.entries()].map(([instanceId, value]): PdfExportFontPlan => {
    const choice = value.direct
      ? fontDisposition(value.font, Object.keys(value.axes).length > 0, policy)
      : (() => {
        const dispositions = value.fallback.map(entry => entry.disposition);
        const disposition = dispositions.includes('blocked') ? 'blocked'
          : dispositions.includes('raster') ? 'raster' : 'outline';
        const reasons = value.fallback.flatMap(entry => entry.reasons)
          .filter((entry, index, all) => all.findIndex(candidate => candidate.code === entry.code) === index);
        return { disposition, subsetter: null, requiresSfntDecode: false, reasons } as const;
      })();
    const requiresConfirmation = choice.disposition === 'outline'
      || choice.disposition === 'raster' || choice.disposition === 'blocked';
    return {
      instanceId, assetId: value.font.assetId, variableAxes: value.axes,
      disposition: choice.disposition,
      glyphIds: [...value.glyphs].sort((left, right) => left - right),
      subsetter: choice.subsetter,
      retainGlyphIds: choice.disposition === 'subset',
      requiresSfntDecode: choice.requiresSfntDecode,
      requiresConfirmation,
      reasons: choice.reasons
    };
  });
  const fontsByInstance = new Map(fonts.map(font => [font.instanceId, font]));
  const entryByRun = new Map(entries.map(entry => [entry.run.runId, entry]));

  const layers = input.layers.map((layer): PdfExportTextLayerPlan => {
    if (layer.unavailableReason !== undefined) return {
      layerId: layer.layerId,
      name: layer.name,
      sourceKind: layer.sourceKind,
      disposition: 'blocked',
      searchable: false,
      requiresConfirmation: true,
      reasons: [reason(
        'text-realization-unavailable',
        layer.unavailableReason === 'font-resolution-unavailable'
          ? 'The exact font could not be resolved for PDF export.'
          : 'The text layer has no current realized glyph layout for PDF export.'
      )],
      runs: []
    };
    const runs = layer.runs.map((run): PdfExportTextRunPlan => {
      const entry = entryByRun.get(run.runId)!;
      const early = directFallback.get(run.runId);
      if (early) return {
        runId: run.runId, fontInstanceId: entry.instanceId,
        encodingId: null,
        disposition: early.disposition,
        encoding: [], actualText: [], searchable: false,
        requiresConfirmation: early.disposition !== 'blocked' || early.reasons.length > 0,
        reasons: early.reasons
      };
      const font = fontsByInstance.get(entry.instanceId)!;
      if (font.disposition !== 'subset' && font.disposition !== 'embed-existing' && font.disposition !== 'embed-full') {
        return {
          runId: run.runId, fontInstanceId: entry.instanceId,
          encodingId: null,
          disposition: font.disposition,
          encoding: [], actualText: [], searchable: false,
          requiresConfirmation: font.requiresConfirmation,
          reasons: font.reasons
        };
      }
      const semantic = encodingFor(run, limits.maximumEncodingEntriesPerRun);
      return {
        runId: run.runId, fontInstanceId: entry.instanceId,
        encodingId: `encoding:${run.runId}`,
        disposition: 'text', ...semantic, searchable: true,
        requiresConfirmation: false, reasons: font.reasons
      };
    });
    const dispositions = new Set(runs.map(run => run.disposition));
    const disposition: PdfExportTextLayerDisposition = dispositions.has('blocked') ? 'blocked'
      : dispositions.size > 1 ? 'mixed'
        : (runs[0]?.disposition ?? 'text');
    return {
      layerId: layer.layerId, name: layer.name, sourceKind: layer.sourceKind,
      disposition,
      searchable: runs.length > 0 && runs.every(run => run.searchable),
      requiresConfirmation: runs.some(run => run.requiresConfirmation),
      reasons: runs.flatMap(run => run.reasons)
        .filter((entry, index, all) => all.findIndex(candidate => candidate.code === entry.code) === index),
      runs
    };
  });
  const summary: Record<PdfExportFontDisposition, number> = {
    subset: 0, 'embed-existing': 0, 'embed-full': 0, outline: 0, raster: 0, blocked: 0
  };
  fonts.forEach(font => { summary[font.disposition] += 1; });
  return {
    fonts, layers,
    canExport: layers.every(layer => layer.disposition !== 'blocked'),
    requiresConfirmation: layers.some(layer => layer.requiresConfirmation),
    summary
  };
};
