import {
  TEXT_DOCUMENT_SCHEMA_VERSION,
  TEXT_LAYOUT_SCHEMA_VERSION,
  TEXT_WORKER_PROTOCOL_VERSION,
  type FontAssetRef,
  type FontInstance,
  type Matrix3,
  type RealizedTextLayout,
  type Rect,
  type RgbaColor,
  type TextLayerData,
  type TextCapabilityState,
  type TextLayoutError,
  type TextPaint
} from './types';
import { createTextLayoutCacheKey } from './cacheKeys';
import { collectTextResponseTransferBuffers } from './workerProtocol';
import type { TextLayoutWorkerRequest, TextLayoutWorkerResponse, TextWorkerRequest } from './workerProtocol';

const MAX_TEXT_CODE_UNITS = 10_000_000;
const MAX_RUN_COUNT = 100_000;
const MAX_GLYPH_COUNT = 2_000_000;
const MAX_IDENTIFIER_LENGTH = 1024;
const MAX_METADATA_STRING_LENGTH = 65_536;
const MAX_FONT_BYTES = 256 * 1024 * 1024;

export class TextContractValidationError extends Error {
  readonly path: string;

  constructor(path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = 'TextContractValidationError';
    this.path = path;
  }
}

const fail = (path: string, message: string): never => {
  throw new TextContractValidationError(path, message);
};

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const record = (value: unknown, path: string): Record<string, unknown> => {
  if (!isRecord(value)) fail(path, 'expected an object');
  return value as Record<string, unknown>;
};

const stringValue = (value: unknown, path: string): string => {
  if (typeof value !== 'string') fail(path, 'expected a string');
  return value as string;
};

const boundedString = (value: unknown, path: string, maximum = MAX_IDENTIFIER_LENGTH): string => {
  const result = stringValue(value, path);
  if (result.length > maximum) fail(path, `exceeds the ${maximum} UTF-16 code-unit limit`);
  return result;
};

const finite = (value: unknown, path: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(path, 'expected a finite number');
  return value as number;
};

const integer = (value: unknown, path: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number => {
  const result = finite(value, path);
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum) {
    fail(path, `expected a safe integer in [${minimum}, ${maximum}]`);
  }
  return result;
};

const numberInRange = (value: unknown, path: string, minimum: number, maximum: number): number => {
  const result = finite(value, path);
  if (result < minimum || result > maximum) fail(path, `expected a number in [${minimum}, ${maximum}]`);
  return result;
};

const oneOf = <T extends string>(value: unknown, path: string, values: readonly T[]): T => {
  if (typeof value !== 'string' || !values.includes(value as T)) fail(path, `expected one of ${values.join(', ')}`);
  return value as T;
};

const array = (value: unknown, path: string, maximum = MAX_RUN_COUNT): readonly unknown[] => {
  if (!Array.isArray(value)) fail(path, 'expected an array');
  const entries = value as readonly unknown[];
  if (entries.length > maximum) fail(path, `exceeds the ${maximum} item limit`);
  return entries;
};

const assertPlainSerializable = (value: unknown, path: string, seen: WeakSet<object>): void => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail(path, 'non-finite numbers are not serializable contract values');
    return;
  }
  if (typeof value !== 'object') fail(path, 'functions, symbols and undefined are not contract values');
  const object = value as object;
  if (seen.has(object)) fail(path, 'cyclic values are not supported');
  seen.add(object);
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertPlainSerializable(entry, `${path}[${index}]`, seen));
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) fail(path, 'expected a plain serializable object');
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) assertPlainSerializable(entry, `${path}.${key}`, seen);
  }
  seen.delete(object);
};

const assertMatrix = (value: unknown, path: string): void => {
  const entries = array(value, path, 9);
  if (entries.length !== 9) fail(path, 'expected a row-major 3x3 matrix');
  entries.forEach((entry, index) => finite(entry, `${path}[${index}]`));
  if (Math.abs(finite(entries[8], `${path}[8]`)) < Number.EPSILON) fail(path, 'homogeneous scale must be non-zero');
};

const assertRect = (value: unknown, path: string): void => {
  const candidate = record(value, path);
  finite(candidate.x, `${path}.x`);
  finite(candidate.y, `${path}.y`);
  if (finite(candidate.width, `${path}.width`) < 0) fail(`${path}.width`, 'must be non-negative');
  if (finite(candidate.height, `${path}.height`) < 0) fail(`${path}.height`, 'must be non-negative');
};

const assertColor = (value: unknown, path: string): void => {
  const candidate = record(value, path);
  oneOf(candidate.colorSpace, `${path}.colorSpace`, ['srgb', 'display-p3']);
  for (const channel of ['r', 'g', 'b', 'a'] as const) numberInRange(candidate[channel], `${path}.${channel}`, 0, 1);
};

const assertPaint = (value: unknown, path: string): void => {
  const candidate = record(value, path);
  const kind = oneOf(candidate.kind, `${path}.kind`, ['solid', 'linear-gradient']);
  if (kind === 'solid') {
    assertColor(candidate.color, `${path}.color`);
    return;
  }
  const start = record(candidate.start, `${path}.start`);
  finite(start.x, `${path}.start.x`);
  finite(start.y, `${path}.start.y`);
  const end = record(candidate.end, `${path}.end`);
  finite(end.x, `${path}.end.x`);
  finite(end.y, `${path}.end.y`);
  const stops = array(candidate.stops, `${path}.stops`, 4096);
  if (stops.length < 2) fail(`${path}.stops`, 'a gradient requires at least two stops');
  let lastOffset = -1;
  stops.forEach((entry, index) => {
    const stop = record(entry, `${path}.stops[${index}]`);
    const offset = numberInRange(stop.offset, `${path}.stops[${index}].offset`, 0, 1);
    if (offset < lastOffset) fail(`${path}.stops[${index}].offset`, 'gradient stops must be ordered');
    lastOffset = offset;
    assertColor(stop.color, `${path}.stops[${index}].color`);
  });
};

const assertFontAsset = (value: unknown, path: string): void => {
  const candidate = record(value, path);
  if (!boundedString(candidate.assetId, `${path}.assetId`)) fail(`${path}.assetId`, 'must not be empty');
  integer(candidate.faceIndex, `${path}.faceIndex`, 0, 0xffff_ffff);
  const fingerprint = stringValue(candidate.fingerprintSha256, `${path}.fingerprintSha256`);
  if (!/^[a-f0-9]{64}$/i.test(fingerprint)) fail(`${path}.fingerprintSha256`, 'expected a SHA-256 hex digest');
  oneOf(candidate.source, `${path}.source`, ['bundled', 'document', 'system', 'imported', 'pdf-subset']);
  oneOf(candidate.container, `${path}.container`, ['sfnt', 'woff', 'woff2', 'raw-cff', 'unknown']);
  oneOf(candidate.outline, `${path}.outline`, ['truetype', 'cff', 'cff2', 'svg', 'bitmap', 'mixed', 'unknown']);
  const embedding = record(candidate.embedding, `${path}.embedding`);
  oneOf(embedding.level, `${path}.embedding.level`, ['installable', 'editable', 'preview-print', 'restricted', 'unknown']);
  if (typeof embedding.noSubsetting !== 'boolean') fail(`${path}.embedding.noSubsetting`, 'expected a boolean');
  if (typeof embedding.bitmapOnly !== 'boolean') fail(`${path}.embedding.bitmapOnly`, 'expected a boolean');
  if (candidate.postScriptName !== undefined) boundedString(candidate.postScriptName, `${path}.postScriptName`);
};

const assertFontInstance = (value: unknown, path: string): void => {
  const candidate = record(value, path);
  assertFontAsset(candidate.font, `${path}.font`);
  const axes = record(candidate.variableAxes, `${path}.variableAxes`);
  for (const [tag, axisValue] of Object.entries(axes)) {
    if (!/^[\x20-\x7e]{4}$/.test(tag)) fail(`${path}.variableAxes.${tag}`, 'axis tags must contain four printable ASCII characters');
    numberInRange(axisValue, `${path}.variableAxes.${tag}`, -1_000_000, 1_000_000);
  }
  if (typeof candidate.syntheticBold !== 'boolean') fail(`${path}.syntheticBold`, 'expected a boolean');
  if (typeof candidate.syntheticItalic !== 'boolean') fail(`${path}.syntheticItalic`, 'expected a boolean');
};

const assertRequestedFont = (value: unknown, path: string): void => {
  const candidate = record(value, path);
  const families = array(candidate.families, `${path}.families`, 64);
  if (families.length === 0) fail(`${path}.families`, 'at least one requested family is required');
  families.forEach((family, index) => {
    if (!boundedString(family, `${path}.families[${index}]`, 256)) fail(`${path}.families[${index}]`, 'must not be empty');
  });
  if (candidate.postScriptName !== undefined) boundedString(candidate.postScriptName, `${path}.postScriptName`);
  if (candidate.preferredAsset !== undefined) assertFontAsset(candidate.preferredAsset, `${path}.preferredAsset`);
};

const assertFontResolution = (value: unknown, path: string): void => {
  const resolution = record(value, path);
  const kind = oneOf(resolution.kind, `${path}.kind`, [
    'flow-exact', 'flow-substituted', 'positioned-exact', 'positioned-substituted'
  ]);
  integer(resolution.sourceRunIndex, `${path}.sourceRunIndex`);
  if (kind === 'flow-exact' || kind === 'flow-substituted') {
    assertRequestedFont(resolution.requested, `${path}.requested`);
  }
  if (kind === 'flow-substituted') {
    oneOf(resolution.reason, `${path}.reason`, ['asset-missing', 'glyph-fallback', 'unsupported-variation', 'policy']);
  } else if (kind === 'positioned-substituted') {
    oneOf(resolution.reason, `${path}.reason`, ['asset-missing', 'glyph-fallback', 'embedding-restricted', 'unsupported-format']);
  }
};

const assertTextStroke = (value: unknown, path: string): void => {
  const stroke = record(value, path);
  assertPaint(stroke.paint, `${path}.paint`);
  if (finite(stroke.width, `${path}.width`) < 0) fail(`${path}.width`, 'must be non-negative');
  oneOf(stroke.cap, `${path}.cap`, ['butt', 'round', 'square']);
  oneOf(stroke.join, `${path}.join`, ['miter', 'round', 'bevel']);
  if (finite(stroke.miterLimit, `${path}.miterLimit`) < 1) fail(`${path}.miterLimit`, 'must be at least 1');
};

const assertRunPaint = (value: unknown, path: string): void => {
  const paint = record(value, path);
  if (paint.fill !== undefined) assertPaint(paint.fill, `${path}.fill`);
  if (paint.stroke !== undefined) assertTextStroke(paint.stroke, `${path}.stroke`);
};

const assertPaintMatchesRenderingMode = (
  paintValue: unknown,
  renderingMode: string,
  path: string
): void => {
  const paint = record(paintValue, path);
  if (['fill', 'fill-stroke', 'fill-clip', 'fill-stroke-clip'].includes(renderingMode) && paint.fill === undefined) {
    fail(`${path}.fill`, `${renderingMode} requires fill paint`);
  }
  if (['stroke', 'fill-stroke', 'stroke-clip', 'fill-stroke-clip'].includes(renderingMode) && paint.stroke === undefined) {
    fail(`${path}.stroke`, `${renderingMode} requires stroke paint`);
  }
};

const splitsSurrogatePair = (text: string, offset: number): boolean => (
  offset > 0 && offset < text.length
  && text.charCodeAt(offset - 1) >= 0xd800 && text.charCodeAt(offset - 1) <= 0xdbff
  && text.charCodeAt(offset) >= 0xdc00 && text.charCodeAt(offset) <= 0xdfff
);

const assertRunCoverage = (
  runs: readonly unknown[],
  text: string,
  path: string,
  validate: (run: Record<string, unknown>, runPath: string) => void
): void => {
  if (text.length === 0) {
    if (runs.length !== 0) fail(path, 'empty text must have no runs');
    return;
  }
  if (runs.length === 0) fail(path, 'non-empty text requires complete run coverage');
  let cursor = 0;
  runs.forEach((entry, index) => {
    const runPath = `${path}[${index}]`;
    const run = record(entry, runPath);
    const start = integer(run.start, `${runPath}.start`);
    const end = integer(run.end, `${runPath}.end`);
    if (start !== cursor || end <= start || end > text.length) fail(runPath, 'runs must be ordered, contiguous and within the text');
    if (splitsSurrogatePair(text, start) || splitsSurrogatePair(text, end)) fail(runPath, 'run boundaries must not split a Unicode surrogate pair');
    validate(run, runPath);
    cursor = end;
  });
  if (cursor !== text.length) fail(path, 'runs must cover the complete text');
};

const assertFlowSource = (source: Record<string, unknown>, path: string): void => {
  const text = stringValue(source.text, `${path}.text`);
  if (text.length > MAX_TEXT_CODE_UNITS) fail(`${path}.text`, `exceeds the ${MAX_TEXT_CODE_UNITS} UTF-16 code-unit limit`);
  const assertStyle = (run: Record<string, unknown>, runPath: string) => {
    assertRequestedFont(run.requestedFont, `${runPath}.requestedFont`);
    numberInRange(run.fontSize, `${runPath}.fontSize`, 0.01, 100_000);
    numberInRange(run.fontWeight, `${runPath}.fontWeight`, 1, 1000);
    oneOf(run.fontStyle, `${runPath}.fontStyle`, ['normal', 'italic', 'oblique']);
    numberInRange(run.fontStretch, `${runPath}.fontStretch`, 0.01, 10_000);
    assertPaint(run.fill, `${runPath}.fill`);
    if (run.stroke !== undefined) assertTextStroke(run.stroke, `${runPath}.stroke`);
    numberInRange(run.tracking, `${runPath}.tracking`, -100_000, 100_000);
    numberInRange(run.baselineShift, `${runPath}.baselineShift`, -100_000, 100_000);
    numberInRange(run.horizontalScale, `${runPath}.horizontalScale`, 0.01, 10_000);
    numberInRange(run.verticalScale, `${runPath}.verticalScale`, 0.01, 10_000);
    oneOf(run.kerning, `${runPath}.kerning`, ['auto', 'metrics', 'optical', 'none']);
    const features = record(run.openTypeFeatures, `${runPath}.openTypeFeatures`);
    for (const [tag, setting] of Object.entries(features)) {
      if (!/^[\x20-\x7e]{4}$/.test(tag)) fail(`${runPath}.openTypeFeatures.${tag}`, 'feature tags must contain four printable ASCII characters');
      if (typeof setting !== 'boolean') integer(setting, `${runPath}.openTypeFeatures.${tag}`, 0, 65_535);
    }
    const axes = record(run.variableAxes, `${runPath}.variableAxes`);
    for (const [tag, axisValue] of Object.entries(axes)) {
      if (!/^[\x20-\x7e]{4}$/.test(tag)) fail(`${runPath}.variableAxes.${tag}`, 'axis tags must contain four printable ASCII characters');
      numberInRange(axisValue, `${runPath}.variableAxes.${tag}`, -1_000_000, 1_000_000);
    }
    if (typeof run.syntheticBold !== 'boolean') fail(`${runPath}.syntheticBold`, 'expected a boolean');
    if (typeof run.syntheticItalic !== 'boolean') fail(`${runPath}.syntheticItalic`, 'expected a boolean');
    if (run.language !== undefined) boundedString(run.language, `${runPath}.language`, 128);
    if (run.scriptOverride !== undefined) boundedString(run.scriptOverride, `${runPath}.scriptOverride`, 32);
    if (run.directionOverride !== undefined) oneOf(run.directionOverride, `${runPath}.directionOverride`, ['ltr', 'rtl']);
  };
  const assertParagraph = (run: Record<string, unknown>, runPath: string) => {
    oneOf(run.alignment, `${runPath}.alignment`, ['start', 'center', 'end', 'justify']);
    oneOf(run.direction, `${runPath}.direction`, ['auto', 'ltr', 'rtl']);
    const lineHeight = record(run.lineHeight, `${runPath}.lineHeight`);
    const kind = oneOf(lineHeight.kind, `${runPath}.lineHeight.kind`, ['normal', 'absolute', 'multiple']);
    if (kind !== 'normal') numberInRange(lineHeight.value, `${runPath}.lineHeight.value`, 0.01, 100_000);
    for (const property of ['firstLineIndent', 'startIndent', 'endIndent', 'spaceBefore', 'spaceAfter'] as const) {
      numberInRange(run[property], `${runPath}.${property}`, -1_000_000, 1_000_000);
    }
    oneOf(run.hyphenation, `${runPath}.hyphenation`, ['off', 'auto']);
  };
  const styleRuns = array(source.styleRuns, `${path}.styleRuns`);
  assertRunCoverage(styleRuns, text, `${path}.styleRuns`, assertStyle);
  const paragraphRuns = array(source.paragraphRuns, `${path}.paragraphRuns`);
  assertRunCoverage(paragraphRuns, text, `${path}.paragraphRuns`, assertParagraph);
  if (source.insertionStyle !== undefined) {
    assertStyle(record(source.insertionStyle, `${path}.insertionStyle`), `${path}.insertionStyle`);
  }
  if (source.insertionParagraph !== undefined) {
    assertParagraph(record(source.insertionParagraph, `${path}.insertionParagraph`), `${path}.insertionParagraph`);
  }
  const layout = record(source.layout, `${path}.layout`);
  const mode = oneOf(layout.mode, `${path}.layout.mode`, ['point', 'paragraph', 'path']);
  if (mode === 'point') {
    const origin = record(layout.origin, `${path}.layout.origin`);
    finite(origin.x, `${path}.layout.origin.x`);
    finite(origin.y, `${path}.layout.origin.y`);
    oneOf(layout.writingMode, `${path}.layout.writingMode`, ['horizontal-tb', 'vertical-rl', 'vertical-lr']);
  } else if (mode === 'paragraph') {
    assertRect(layout.frame, `${path}.layout.frame`);
    oneOf(layout.overflow, `${path}.layout.overflow`, ['visible', 'clip', 'indicator']);
    oneOf(layout.writingMode, `${path}.layout.writingMode`, ['horizontal-tb', 'vertical-rl', 'vertical-lr']);
  } else {
    if (!stringValue(layout.pathLayerId, `${path}.layout.pathLayerId`)) fail(`${path}.layout.pathLayerId`, 'must not be empty');
    if (layout.pathElementId !== undefined
      && !stringValue(layout.pathElementId, `${path}.layout.pathElementId`)) {
      fail(`${path}.layout.pathElementId`, 'must not be empty');
    }
    if (layout.pathSubpathId !== undefined
      && !stringValue(layout.pathSubpathId, `${path}.layout.pathSubpathId`)) {
      fail(`${path}.layout.pathSubpathId`, 'must not be empty');
    }
    finite(layout.startOffset, `${path}.layout.startOffset`);
    if (layout.endOffset !== undefined) finite(layout.endOffset, `${path}.layout.endOffset`);
    if (layout.direction !== undefined) {
      oneOf(layout.direction, `${path}.layout.direction`, ['forward', 'reverse']);
    }
    oneOf(layout.side, `${path}.layout.side`, ['left', 'right']);
    if (typeof layout.upright !== 'boolean') fail(`${path}.layout.upright`, 'expected a boolean');
  }
};

const assertPositionedSource = (source: Record<string, unknown>, path: string): void => {
  const runs = array(source.runs, `${path}.runs`);
  let glyphCount = 0;
  let embeddedUnicodeCodeUnits = 0;
  runs.forEach((entry, runIndex) => {
    const runPath = `${path}.runs[${runIndex}]`;
    const run = record(entry, runPath);
    assertFontInstance(run.font, `${runPath}.font`);
    assertMatrix(run.textMatrix, `${runPath}.textMatrix`);
    assertRunPaint(run.paint, `${runPath}.paint`);
    const renderingMode = oneOf(run.renderingMode, `${runPath}.renderingMode`, [
      'fill', 'stroke', 'fill-stroke', 'invisible',
      'fill-clip', 'stroke-clip', 'fill-stroke-clip', 'clip'
    ]);
    assertPaintMatchesRenderingMode(run.paint, renderingMode, `${runPath}.paint`);
    if (run.sourceEncoding !== undefined) {
      const encoding = record(run.sourceEncoding, `${runPath}.sourceEncoding`);
      oneOf(encoding.kind, `${runPath}.sourceEncoding.kind`, ['pdf', 'postscript', 'other']);
      if (encoding.name !== undefined) boundedString(encoding.name, `${runPath}.sourceEncoding.name`, 256);
    }
    const glyphs = array(run.glyphs, `${runPath}.glyphs`, MAX_GLYPH_COUNT);
    glyphCount += glyphs.length;
    if (glyphCount > MAX_GLYPH_COUNT) fail(`${path}.runs`, `exceeds the ${MAX_GLYPH_COUNT} glyph limit`);
    glyphs.forEach((glyphValue, glyphIndex) => {
      const glyphPath = `${runPath}.glyphs[${glyphIndex}]`;
      const glyph = record(glyphValue, glyphPath);
      integer(glyph.glyphId, `${glyphPath}.glyphId`, 0, 0xffff_ffff);
      if (glyph.cluster !== undefined) integer(glyph.cluster, `${glyphPath}.cluster`, 0, 0xffff_ffff);
      if (glyph.unicode !== undefined) {
        embeddedUnicodeCodeUnits += boundedString(glyph.unicode, `${glyphPath}.unicode`, 64).length;
        if (embeddedUnicodeCodeUnits > MAX_TEXT_CODE_UNITS) fail(`${path}.runs`, 'embedded Unicode exceeds the positioned-text limit');
      }
      if (glyph.sourceCharacterCode !== undefined) {
        const sourceCode = record(glyph.sourceCharacterCode, `${glyphPath}.sourceCharacterCode`);
        const sourceValue = integer(sourceCode.value, `${glyphPath}.sourceCharacterCode.value`);
        const byteLength = integer(sourceCode.byteLength, `${glyphPath}.sourceCharacterCode.byteLength`, 1);
        if (byteLength > 4) fail(`${glyphPath}.sourceCharacterCode.byteLength`, 'must not exceed 4 bytes');
        if (sourceValue >= 2 ** (byteLength * 8)) fail(`${glyphPath}.sourceCharacterCode.value`, 'does not fit the declared byte length');
      }
      for (const property of ['x', 'y', 'advanceX', 'advanceY'] as const) finite(glyph[property], `${glyphPath}.${property}`);
      if (glyph.localTransform !== undefined) assertMatrix(glyph.localTransform, `${glyphPath}.localTransform`);
    });
  });
  if (source.extractedText !== undefined) boundedString(source.extractedText, `${path}.extractedText`, MAX_TEXT_CODE_UNITS);
  if (source.logicalOrderConfidence !== undefined) numberInRange(source.logicalOrderConfidence, `${path}.logicalOrderConfidence`, 0, 1);
  oneOf(source.editability, `${path}.editability`, ['exact-positioned', 'recoverable', 'outline-only']);
};

export function assertTextLayerData(value: unknown): asserts value is TextLayerData {
  assertPlainSerializable(value, '$', new WeakSet());
  const layer = record(value, '$');
  if (layer.schemaVersion !== TEXT_DOCUMENT_SCHEMA_VERSION) fail('$.schemaVersion', `expected ${TEXT_DOCUMENT_SCHEMA_VERSION}`);
  const revisions = record(layer.revisions, '$.revisions');
  for (const domain of ['content', 'font', 'layout', 'paint', 'path', 'geometry'] as const) integer(revisions[domain], `$.revisions.${domain}`);
  const source = record(layer.source, '$.source');
  const sourceKind = oneOf(source.kind, '$.source.kind', ['flow', 'positioned']);
  if (sourceKind === 'flow') assertFlowSource(source, '$.source');
  else assertPositionedSource(source, '$.source');
  if (layer.interchange !== undefined) {
    const interchange = record(layer.interchange, '$.interchange');
    oneOf(interchange.format, '$.interchange.format', ['pdf', 'ai', 'psd', 'svg']);
    if (interchange.sourceObjectId !== undefined) boundedString(interchange.sourceObjectId, '$.interchange.sourceObjectId');
    if (interchange.preservedFields !== undefined) {
      const fields = record(interchange.preservedFields, '$.interchange.preservedFields');
      if (Object.keys(fields).length > 10_000) fail('$.interchange.preservedFields', 'exceeds the 10000 field limit');
      for (const [key, fieldValue] of Object.entries(fields)) {
        boundedString(key, `$.interchange.preservedFields.${key}`, 256);
        if (typeof fieldValue === 'string') boundedString(fieldValue, `$.interchange.preservedFields.${key}`, MAX_METADATA_STRING_LENGTH);
        else if (typeof fieldValue === 'number') finite(fieldValue, `$.interchange.preservedFields.${key}`);
        else if (fieldValue !== null && typeof fieldValue !== 'boolean') fail(`$.interchange.preservedFields.${key}`, 'expected a scalar value');
      }
    }
  }
}

export const parseTextLayerData = (value: unknown): TextLayerData => {
  const candidate = isRecord(value) && isRecord(value.revisions)
    && value.revisions.font === undefined
    && value.revisions.paint === undefined
    && value.revisions.style !== undefined
    ? {
      ...value,
      revisions: {
        content: value.revisions.content,
        font: value.revisions.style,
        layout: value.revisions.layout,
        paint: value.revisions.style,
        path: value.revisions.path,
        geometry: value.revisions.geometry
      }
    }
    : value;
  assertTextLayerData(candidate);
  return candidate as TextLayerData;
};

export function assertRealizedTextLayout(value: unknown): asserts value is RealizedTextLayout {
  const layout = record(value, '$');
  if (layout.schemaVersion !== TEXT_LAYOUT_SCHEMA_VERSION) fail('$.schemaVersion', `expected ${TEXT_LAYOUT_SCHEMA_VERSION}`);
  if (!boundedString(layout.key, '$.key', 4096)) fail('$.key', 'must not be empty');
  let glyphCount = 0;
  const runs = array(layout.glyphRuns, '$.glyphRuns');
  runs.forEach((entry, index) => {
    const runPath = `$.glyphRuns[${index}]`;
    const run = record(entry, runPath);
    assertFontInstance(run.font, `${runPath}.font`);
    if (finite(run.fontSize, `${runPath}.fontSize`) <= 0) fail(`${runPath}.fontSize`, 'must be positive');
    assertFontResolution(run.fontResolution, `${runPath}.fontResolution`);
    assertRunPaint(run.paint, `${runPath}.paint`);
    const renderingMode = oneOf(run.renderingMode, `${runPath}.renderingMode`, [
      'fill', 'stroke', 'fill-stroke', 'invisible',
      'fill-clip', 'stroke-clip', 'fill-stroke-clip', 'clip'
    ]);
    assertPaintMatchesRenderingMode(run.paint, renderingMode, `${runPath}.paint`);
    if (run.language !== undefined) boundedString(run.language, `${runPath}.language`, 128);
    if (run.script !== undefined) boundedString(run.script, `${runPath}.script`, 32);
    oneOf(run.direction, `${runPath}.direction`, ['ltr', 'rtl', 'ttb', 'btt']);
    const glyphIds = run.glyphIds;
    const clusters = run.clusters;
    const geometry = run.geometry;
    if (!(glyphIds instanceof Uint32Array)) fail(`${runPath}.glyphIds`, 'expected Uint32Array');
    if (!(clusters instanceof Uint32Array)) fail(`${runPath}.clusters`, 'expected Uint32Array');
    if (!(geometry instanceof Float32Array)) fail(`${runPath}.geometry`, 'expected Float32Array');
    const typedGlyphIds = glyphIds as Uint32Array;
    const typedClusters = clusters as Uint32Array;
    const typedGeometry = geometry as Float32Array;
    const count = typedGlyphIds.length;
    glyphCount += count;
    if (glyphCount > MAX_GLYPH_COUNT) fail('$.glyphRuns', `exceeds the ${MAX_GLYPH_COUNT} glyph limit`);
    if (typedClusters.length !== count) fail(`${runPath}.clusters`, 'must contain one cluster per glyph');
    if (typedGeometry.length !== count * 4) fail(`${runPath}.geometry`, 'must contain x, y, advanceX and advanceY per glyph');
    typedGeometry.forEach((component, componentIndex) => finite(component, `${runPath}.geometry[${componentIndex}]`));
    if (run.transforms !== undefined && (!(run.transforms instanceof Float32Array) || run.transforms.length !== count * 9)) {
      fail(`${runPath}.transforms`, 'must contain one 3x3 Float32 matrix per glyph');
    }
    if (run.transforms instanceof Float32Array) {
      run.transforms.forEach((component, componentIndex) => finite(component, `${runPath}.transforms[${componentIndex}]`));
    }
  });
  const lines = array(layout.lines, '$.lines', MAX_GLYPH_COUNT);
  lines.forEach((entry, index) => {
    const linePath = `$.lines[${index}]`;
    const line = record(entry, linePath);
    const start = integer(line.start, `${linePath}.start`);
    const end = integer(line.end, `${linePath}.end`);
    if (end < start) fail(linePath, 'line end must not precede its start');
    finite(line.baseline, `${linePath}.baseline`);
    if (finite(line.ascent, `${linePath}.ascent`) < 0) fail(`${linePath}.ascent`, 'must be non-negative');
    if (finite(line.descent, `${linePath}.descent`) < 0) fail(`${linePath}.descent`, 'must be non-negative');
    assertRect(line.bounds, `${linePath}.bounds`);
  });
  const caretStops = array(layout.caretStops, '$.caretStops', MAX_GLYPH_COUNT);
  caretStops.forEach((entry, index) => {
    const caretPath = `$.caretStops[${index}]`;
    const caret = record(entry, caretPath);
    integer(caret.textOffset, `${caretPath}.textOffset`);
    finite(caret.x, `${caretPath}.x`);
    finite(caret.y, `${caretPath}.y`);
    if (finite(caret.height, `${caretPath}.height`) < 0) fail(`${caretPath}.height`, 'must be non-negative');
    oneOf(caret.affinity, `${caretPath}.affinity`, ['upstream', 'downstream']);
  });
  const selections = array(layout.selectionGeometry, '$.selectionGeometry', MAX_GLYPH_COUNT);
  selections.forEach((entry, index) => {
    const selectionPath = `$.selectionGeometry[${index}]`;
    const selection = record(entry, selectionPath);
    const start = integer(selection.start, `${selectionPath}.start`);
    const end = integer(selection.end, `${selectionPath}.end`);
    if (end < start) fail(selectionPath, 'selection end must not precede its start');
    assertRect(selection.bounds, `${selectionPath}.bounds`);
  });
  const clusters = array(layout.clusterMap, '$.clusterMap', MAX_GLYPH_COUNT);
  let previousTextStart = 0;
  let previousGlyphStart = 0;
  clusters.forEach((entry, index) => {
    const clusterPath = `$.clusterMap[${index}]`;
    const cluster = record(entry, clusterPath);
    const textStart = integer(cluster.textStart, `${clusterPath}.textStart`);
    const textEnd = integer(cluster.textEnd, `${clusterPath}.textEnd`);
    const glyphStart = integer(cluster.glyphStart, `${clusterPath}.glyphStart`);
    const glyphEnd = integer(cluster.glyphEnd, `${clusterPath}.glyphEnd`);
    if (textEnd < textStart || glyphEnd < glyphStart || glyphEnd > glyphCount
      || textStart < previousTextStart || glyphStart < previousGlyphStart) {
      fail(clusterPath, 'cluster ranges must be ordered and reference realized glyphs');
    }
    previousTextStart = textStart;
    previousGlyphStart = glyphStart;
  });
  const warnings = array(layout.warnings, '$.warnings', MAX_RUN_COUNT);
  warnings.forEach((entry, index) => {
    const warningPath = `$.warnings[${index}]`;
    const warning = record(entry, warningPath);
    oneOf(warning.code, `${warningPath}.code`, ['font-substituted', 'missing-glyph', 'unsupported-feature', 'logical-order-uncertain']);
    boundedString(warning.message, `${warningPath}.message`, MAX_METADATA_STRING_LENGTH);
    if (warning.runIndex !== undefined) {
      const runIndex = integer(warning.runIndex, `${warningPath}.runIndex`);
      if (runIndex >= runs.length) fail(`${warningPath}.runIndex`, 'must reference an existing glyph run');
    }
  });
  assertRect(layout.inkBounds, '$.inkBounds');
  assertRect(layout.logicalBounds, '$.logicalBounds');
  if (layout.paragraphFrame !== undefined) {
    const paragraphFrame = record(layout.paragraphFrame, '$.paragraphFrame');
    assertRect(paragraphFrame.bounds, '$.paragraphFrame.bounds');
    oneOf(paragraphFrame.overflow, '$.paragraphFrame.overflow', ['visible', 'clip', 'indicator']);
    if (typeof paragraphFrame.overflowed !== 'boolean') {
      fail('$.paragraphFrame.overflowed', 'expected a boolean');
    }
    if (paragraphFrame.firstOverflowTextOffset !== undefined) {
      const offset = integer(
        paragraphFrame.firstOverflowTextOffset,
        '$.paragraphFrame.firstOverflowTextOffset'
      );
      if (offset < 0) fail('$.paragraphFrame.firstOverflowTextOffset', 'must be non-negative');
      if (paragraphFrame.overflowed !== true) {
        fail('$.paragraphFrame.firstOverflowTextOffset', 'requires overflowed to be true');
      }
    } else if (paragraphFrame.overflowed === true) {
      fail('$.paragraphFrame.firstOverflowTextOffset', 'is required when overflowed is true');
    }
  }
}

export function assertTextCapabilityState(value: unknown): asserts value is TextCapabilityState {
  const capability = record(value, '$');
  if (capability.available === true) {
    if (!boundedString(capability.engineVersion, '$.engineVersion', 128)) fail('$.engineVersion', 'must not be empty');
    if (capability.protocolVersion !== TEXT_WORKER_PROTOCOL_VERSION) fail('$.protocolVersion', `expected ${TEXT_WORKER_PROTOCOL_VERSION}`);
    return;
  }
  if (capability.available !== false) fail('$.available', 'expected a boolean literal');
  oneOf(capability.reason, '$.reason', ['wasm-unavailable', 'worker-unavailable', 'font-access-unavailable', 'unsupported-platform']);
  boundedString(capability.message, '$.message', MAX_METADATA_STRING_LENGTH);
}

export function assertTextLayoutError(value: unknown, path = '$'): asserts value is TextLayoutError {
  const error = record(value, path);
  const code = oneOf(error.code, `${path}.code`, ['malformed-input', 'schema-mismatch', 'font-missing', 'font-restricted', 'unsupported-feature', 'resource-limit', 'cancelled', 'engine-unavailable', 'internal-error']);
  boundedString(error.message, `${path}.message`, MAX_METADATA_STRING_LENGTH);
  if (typeof error.retryable !== 'boolean') fail(`${path}.retryable`, 'expected a boolean');
  const expectedRetryable = code === 'engine-unavailable' || code === 'internal-error' || code === 'resource-limit';
  if (error.retryable !== expectedRetryable) fail(`${path}.retryable`, `must be ${expectedRetryable} for ${code}`);
  const fallback = oneOf(error.fallback, `${path}.fallback`, ['none', 'preserve-last-realized-layout', 'diagnostic-placeholder']);
  if (code === 'cancelled' && fallback === 'diagnostic-placeholder') fail(`${path}.fallback`, 'cancelled work never replaces content with a placeholder');
  if (['engine-unavailable', 'internal-error', 'resource-limit'].includes(code) && fallback === 'none') {
    fail(`${path}.fallback`, `${code} requires the last layout or a diagnostic placeholder`);
  }
  if (!['cancelled', 'engine-unavailable', 'internal-error', 'resource-limit'].includes(code) && fallback !== 'diagnostic-placeholder') {
    fail(`${path}.fallback`, `${code} requires a diagnostic placeholder`);
  }
  if (error.details !== undefined) assertPlainSerializable(error.details, `${path}.details`, new WeakSet());
}

const assertWorkerIdentity = (message: Record<string, unknown>): void => {
  if (message.protocolVersion !== TEXT_WORKER_PROTOCOL_VERSION) fail('$.protocolVersion', `expected ${TEXT_WORKER_PROTOCOL_VERSION}`);
  integer(message.requestId, '$.requestId');
  if (!boundedString(message.documentSessionId, '$.documentSessionId')) fail('$.documentSessionId', 'must not be empty');
  integer(message.sessionGeneration, '$.sessionGeneration');
};

const assertLayoutOptions = (value: unknown): void => {
  const options = record(value, '$.options');
  oneOf(options.quality, '$.options.quality', ['interactive', 'final']);
  if (finite(options.effectiveScale, '$.options.effectiveScale') <= 0) fail('$.options.effectiveScale', 'must be positive');
  const maxGlyphCount = integer(options.maxGlyphCount, '$.options.maxGlyphCount', 1);
  if (maxGlyphCount > MAX_GLYPH_COUNT) fail('$.options.maxGlyphCount', `must not exceed ${MAX_GLYPH_COUNT}`);
  if (options.locale !== undefined) boundedString(options.locale, '$.options.locale', 128);
};

const assertVariationCoordinates = (value: unknown, path: string): void => {
  const variations = record(value, path);
  const entries = Object.entries(variations);
  if (entries.length > 64) fail(path, 'must not exceed 64 variation axes');
  for (const [tag, axisValue] of entries) {
    if (!/^[\x20-\x7e]{4}$/.test(tag)) fail(`${path}.${tag}`, 'axis tags must contain four printable ASCII characters');
    finite(axisValue, `${path}.${tag}`);
  }
};

export function assertTextWorkerRequest(value: unknown): asserts value is TextWorkerRequest {
  const request = record(value, '$');
  assertWorkerIdentity(request);
  const kind = oneOf(request.kind, '$.kind', [
    'register-font', 'realize-text', 'rasterize-glyph', 'extract-glyph-outline',
    'cancel-text', 'release-session'
  ]);
  if (kind === 'register-font') {
    assertFontAsset(request.font, '$.font');
    integer(request.fontSnapshotRevision, '$.fontSnapshotRevision');
    const byteSource = oneOf(request.byteSource, '$.byteSource', ['transferred', 'registered-fingerprint']);
    if (byteSource === 'transferred') {
      if (!(request.bytes instanceof Uint8Array)) fail('$.bytes', 'expected Uint8Array');
      const bytes = request.bytes as Uint8Array;
      if (bytes.byteLength === 0 || bytes.byteLength > MAX_FONT_BYTES) fail('$.bytes', `must contain 1 to ${MAX_FONT_BYTES} bytes`);
      if (!(bytes.buffer instanceof ArrayBuffer) || bytes.byteOffset !== 0 || bytes.byteLength !== bytes.buffer.byteLength) {
        fail('$.bytes', 'font registration requires dedicated full-span ArrayBuffer storage');
      }
      if (request.transferOwnership !== 'dedicated') fail('$.transferOwnership', 'expected dedicated');
    } else if (request.bytes !== undefined || request.transferOwnership !== undefined) {
      fail('$.bytes', 'registered fingerprint aliases must not resend bytes');
    }
    return;
  }
  if (kind === 'cancel-text') {
    integer(request.targetRequestId, '$.targetRequestId');
    return;
  }
  if (kind === 'rasterize-glyph') {
    if (!boundedString(request.assetId, '$.assetId')) fail('$.assetId', 'must not be empty');
    integer(request.faceIndex, '$.faceIndex', 0, 0xffff_ffff);
    integer(request.glyphId, '$.glyphId', 0, 0xffff);
    numberInRange(request.ppem, '$.ppem', 4, 256);
    integer(request.fontSnapshotRevision, '$.fontSnapshotRevision');
    assertVariationCoordinates(request.variationCoordinates, '$.variationCoordinates');
    if (typeof request.syntheticBold !== 'boolean') fail('$.syntheticBold', 'expected boolean');
    if (typeof request.syntheticItalic !== 'boolean') fail('$.syntheticItalic', 'expected boolean');
    oneOf(request.hinting, '$.hinting', ['smooth']);
    oneOf(request.renderMode, '$.renderMode', ['alpha']);
    return;
  }
  if (kind === 'extract-glyph-outline') {
    if (!boundedString(request.assetId, '$.assetId')) fail('$.assetId', 'must not be empty');
    integer(request.faceIndex, '$.faceIndex', 0, 0xffff_ffff);
    integer(request.glyphId, '$.glyphId', 0, 0xffff);
    integer(request.fontSnapshotRevision, '$.fontSnapshotRevision');
    assertVariationCoordinates(request.variationCoordinates, '$.variationCoordinates');
    return;
  }
  if (kind === 'release-session') return;
  if (!boundedString(request.layerId, '$.layerId')) fail('$.layerId', 'must not be empty');
  assertTextLayerData(request.layer);
  const flowFontSelections = array(request.flowFontSelections, '$.flowFontSelections', 16_384);
  if ((request.layer as TextLayerData).source.kind === 'flow') {
    const styleRuns = (request.layer as TextLayerData).source.kind === 'flow'
      ? (request.layer as TextLayerData & { source: { kind: 'flow'; styleRuns: readonly unknown[] } }).source.styleRuns
      : [];
    if (flowFontSelections.length !== styleRuns.length) {
      fail('$.flowFontSelections', 'requires one entry per flow style run');
    }
  } else if (flowFontSelections.length !== 0) {
    fail('$.flowFontSelections', 'must be empty for positioned text');
  }
  flowFontSelections.forEach((entry, index) => {
    const path = `$.flowFontSelections[${index}]`;
    const selection = record(entry, path);
    integer(selection.sourceRunIndex, `${path}.sourceRunIndex`, 0, 16_383);
    if (selection.sourceRunIndex !== index) fail(`${path}.sourceRunIndex`, 'must match its style-run index');
    assertFontAsset(selection.font, `${path}.font`);
    if (!boundedString(selection.familyName, `${path}.familyName`, 256)) {
      fail(`${path}.familyName`, 'must not be empty');
    }
    assertFontResolution(selection.resolution, `${path}.resolution`);
    const resolution = record(selection.resolution, `${path}.resolution`);
    if (resolution.sourceRunIndex !== index) {
      fail(`${path}.resolution.sourceRunIndex`, 'must match its style-run index');
    }
    if (resolution.kind !== 'flow-exact' && resolution.kind !== 'flow-substituted') {
      fail(`${path}.resolution.kind`, 'expected flow font provenance');
    }
  });
  assertMatrix(request.localToDocument, '$.localToDocument');
  integer(request.fontSnapshotRevision, '$.fontSnapshotRevision');
  integer(request.pathDependencyRevision, '$.pathDependencyRevision');
  if (!boundedString(request.cacheKey, '$.cacheKey', 4096)) fail('$.cacheKey', 'must not be empty');
  assertLayoutOptions(request.options);
  const expectedCacheKey = createTextLayoutCacheKey({
    documentSessionId: request.documentSessionId as string,
    sessionGeneration: request.sessionGeneration as number,
    layerId: request.layerId as string,
    revisions: (request.layer as TextLayerData).revisions,
    fontSnapshotRevision: request.fontSnapshotRevision as number,
    pathDependencyRevision: request.pathDependencyRevision as number,
    options: request.options as TextLayoutWorkerRequest['options']
  });
  if (request.cacheKey !== expectedCacheKey) fail('$.cacheKey', 'does not match the request identity and revisions');
}

export function assertTextLayoutWorkerRequest(value: unknown): asserts value is TextLayoutWorkerRequest {
  assertTextWorkerRequest(value);
  if (value.kind !== 'realize-text') fail('$.kind', 'expected realize-text');
}

export function assertTextLayoutWorkerResponse(value: unknown): asserts value is TextLayoutWorkerResponse {
  const response = record(value, '$');
  assertWorkerIdentity(response);
  const kind = oneOf(response.kind, '$.kind', [
    'font-registered', 'font-registration-failed', 'text-realized',
    'text-layout-failed', 'glyph-rasterized', 'glyph-rasterization-failed',
    'glyph-outline-extracted', 'glyph-outline-extraction-failed',
    'session-released', 'session-release-failed'
  ]);
  if (kind === 'font-registered') {
    if (!boundedString(response.assetId, '$.assetId')) fail('$.assetId', 'must not be empty');
    integer(response.fontSnapshotRevision, '$.fontSnapshotRevision');
    assertPerformanceMetrics(response.metrics, '$.metrics');
    return;
  }
  if (kind === 'session-released') return;
  if (kind === 'session-release-failed') {
    assertTextLayoutError(response.error, '$.error');
    return;
  }
  if (kind === 'font-registration-failed') {
    if (!boundedString(response.assetId, '$.assetId')) fail('$.assetId', 'must not be empty');
    assertTextLayoutError(response.error, '$.error');
    return;
  }
  if (kind === 'glyph-rasterization-failed') {
    if (!boundedString(response.assetId, '$.assetId')) fail('$.assetId', 'must not be empty');
    integer(response.glyphId, '$.glyphId', 0, 0xffff);
    assertTextLayoutError(response.error, '$.error');
    return;
  }
  if (kind === 'glyph-outline-extraction-failed') {
    if (!boundedString(response.assetId, '$.assetId')) fail('$.assetId', 'must not be empty');
    integer(response.glyphId, '$.glyphId', 0, 0xffff);
    assertTextLayoutError(response.error, '$.error');
    return;
  }
  if (kind === 'glyph-outline-extracted') {
    if (!boundedString(response.assetId, '$.assetId')) fail('$.assetId', 'must not be empty');
    integer(response.faceIndex, '$.faceIndex', 0, 0xffff_ffff);
    integer(response.glyphId, '$.glyphId', 0, 0xffff);
    integer(response.fontSnapshotRevision, '$.fontSnapshotRevision');
    assertVariationCoordinates(response.variationCoordinates, '$.variationCoordinates');
    if (response.transferOwnership !== 'dedicated') fail('$.transferOwnership', 'expected dedicated');
    assertPerformanceMetrics(response.metrics, '$.metrics');
    const outline = record(response.outline, '$.outline');
    integer(outline.unitsPerEm, '$.outline.unitsPerEm', 16, 0xffff);
    if (!(outline.verbs instanceof Uint8Array)) fail('$.outline.verbs', 'expected Uint8Array');
    if (!(outline.coordinates instanceof Float32Array)) fail('$.outline.coordinates', 'expected Float32Array');
    if (!(outline.bounds instanceof Float32Array) || (outline.bounds as Float32Array).length !== 4) {
      fail('$.outline.bounds', 'expected four Float32 values');
    }
    const verbs = outline.verbs as Uint8Array;
    if (verbs.length > 32_768) fail('$.outline.verbs', 'exceeds the command limit');
    const coordinates = outline.coordinates as Float32Array;
    let expectedCoordinates = 0;
    for (let index = 0; index < verbs.length; index += 1) {
      expectedCoordinates += [2, 2, 4, 6, 0][integer(verbs[index], `$.outline.verbs[${index}]`, 0, 4)];
    }
    if (coordinates.length !== expectedCoordinates) fail('$.outline.coordinates', 'does not match verb arity');
    coordinates.forEach((value, index) => finite(value, `$.outline.coordinates[${index}]`));
    (outline.bounds as Float32Array).forEach((value, index) => finite(value, `$.outline.bounds[${index}]`));
    try {
      collectTextResponseTransferBuffers(response as unknown as TextLayoutWorkerResponse);
    } catch (reason) {
      fail('$.outline', reason instanceof Error ? reason.message : 'invalid transfer storage');
    }
    return;
  }
  if (kind === 'glyph-rasterized') {
    if (!boundedString(response.assetId, '$.assetId')) fail('$.assetId', 'must not be empty');
    integer(response.faceIndex, '$.faceIndex', 0, 0xffff_ffff);
    integer(response.glyphId, '$.glyphId', 0, 0xffff);
    numberInRange(response.ppem, '$.ppem', 4, 256);
    integer(response.fontSnapshotRevision, '$.fontSnapshotRevision');
    assertVariationCoordinates(response.variationCoordinates, '$.variationCoordinates');
    if (typeof response.syntheticBold !== 'boolean') fail('$.syntheticBold', 'expected boolean');
    if (typeof response.syntheticItalic !== 'boolean') fail('$.syntheticItalic', 'expected boolean');
    oneOf(response.hinting, '$.hinting', ['smooth']);
    oneOf(response.renderMode, '$.renderMode', ['alpha']);
    if (response.transferOwnership !== 'dedicated') fail('$.transferOwnership', 'expected dedicated');
    assertPerformanceMetrics(response.metrics, '$.metrics');
    const raster = record(response.raster, '$.raster');
    const width = integer(raster.width, '$.raster.width', 0, 256);
    const height = integer(raster.height, '$.raster.height', 0, 256);
    integer(raster.bearingX, '$.raster.bearingX', -0x8000_0000, 0x7fff_ffff);
    integer(raster.bearingY, '$.raster.bearingY', -0x8000_0000, 0x7fff_ffff);
    integer(raster.commandCount, '$.raster.commandCount', 0, 32_768);
    if (!(raster.pixels instanceof Uint8Array)) fail('$.raster.pixels', 'expected Uint8Array');
    if ((raster.pixels as Uint8Array).byteLength !== width * height) {
      fail('$.raster.pixels', 'must contain one R8 byte per pixel');
    }
    try {
      collectTextResponseTransferBuffers(response as unknown as TextLayoutWorkerResponse);
    } catch (reason) {
      fail('$.raster.pixels', reason instanceof Error ? reason.message : 'invalid transfer storage');
    }
    return;
  }
  if (!boundedString(response.cacheKey, '$.cacheKey', 4096)) fail('$.cacheKey', 'must not be empty');
  if (kind === 'text-realized') {
    if (response.transferOwnership !== 'dedicated') fail('$.transferOwnership', 'expected dedicated');
    assertPerformanceMetrics(response.metrics, '$.metrics');
    assertRealizedTextLayout(response.layout);
    if ((response.layout as RealizedTextLayout).key !== response.cacheKey) fail('$.layout.key', 'must equal the echoed cache key');
    try {
      collectTextResponseTransferBuffers(response as unknown as TextLayoutWorkerResponse);
    } catch (reason) {
      fail('$.layout.glyphRuns', reason instanceof Error ? reason.message : 'invalid transfer storage');
    }
  } else {
    assertTextLayoutError(response.error, '$.error');
  }
}

function assertPerformanceMetrics(value: unknown, path: string): void {
  const metrics = record(value, path);
  const duration = finite(metrics.operationDurationMs, `${path}.operationDurationMs`);
  const memory = integer(metrics.wasmLinearMemoryBytes, `${path}.wasmLinearMemoryBytes`);
  if (duration < 0) fail(`${path}.operationDurationMs`, 'must be non-negative');
  if (memory < 0) fail(`${path}.wasmLinearMemoryBytes`, 'must be non-negative');
  if (metrics.paragraphCache !== undefined) {
    const paragraph = record(metrics.paragraphCache, `${path}.paragraphCache`);
    for (const field of [
      'requestHitCount',
      'requestShapeCount',
      'retainedEntryCount',
      'retainedByteLength',
      'lifetimeEvictionCount'
    ] as const) {
      if (integer(paragraph[field], `${path}.paragraphCache.${field}`) < 0) {
        fail(`${path}.paragraphCache.${field}`, 'must be non-negative');
      }
    }
  }
}
