import type {
  Color as PsdColor,
  LayerTextData,
  ParagraphStyle,
  TextStyle,
  Warp
} from 'ag-psd';
import {
  assertTextLayerData,
  createDefaultFlowTextSource,
  createDefaultTextLayerData,
  type ParagraphStyleRun,
  type RgbaColor,
  type TextLayerData,
  type TextWarp,
  type TextWarpStyle,
  type TextStyleRun
} from '@lighttable/text-core';
import {
  createAnchor,
  createSubpath,
  createVectorPath,
  transformPoint,
  type VectorPath
} from '@lighttable/vector-core';
import type { AffineMatrix } from '../rendering/renderContract';
import type { DocumentBlendProfile } from '../document/documentTypes';
import { convertEncodedDocumentColorToSrgb } from '../color/documentColorTransform';

export type PsdTextImportResult =
  | {
    readonly kind: 'editable-flow';
    readonly text: TextLayerData;
    readonly transform: AffineMatrix;
    readonly path: VectorPath | null;
    readonly reasons: readonly string[];
  }
  | {
    readonly kind: 'preserved';
    readonly reasons: readonly string[];
  };

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const warpStyle = (style: Warp['style']): TextWarpStyle | null => ({
  arc: 'arc', arcLower: 'arc-lower', arcUpper: 'arc-upper', arch: 'arch', bulge: 'bulge',
  shellLower: 'shell-lower', shellUpper: 'shell-upper', flag: 'flag', wave: 'wave',
  fish: 'fish', rise: 'rise', fisheye: 'fisheye', inflate: 'inflate', squeeze: 'squeeze',
  twist: 'twist', custom: 'custom', cylinder: 'cylinder'
} as Partial<Record<NonNullable<Warp['style']>, TextWarpStyle>>)[style ?? 'none'] ?? null;

const unitValue = (value: unknown) => value && typeof value === 'object'
  && finite((value as { value?: unknown }).value)
  ? (value as { value: number }).value : null;

const normalizeWarp = (source: Warp | undefined): TextWarp | null => {
  const style = warpStyle(source?.style);
  if (!source || !style) return null;
  const boundsValues = source.bounds ? [
    unitValue(source.bounds.left), unitValue(source.bounds.top),
    unitValue(source.bounds.right), unitValue(source.bounds.bottom)
  ] : null;
  const bounds = boundsValues?.every((value): value is number => value !== null)
    && boundsValues[2]! > boundsValues[0]! && boundsValues[3]! > boundsValues[1]!
    ? { x: boundsValues[0]!, y: boundsValues[1]!,
      width: boundsValues[2]! - boundsValues[0]!, height: boundsValues[3]! - boundsValues[1]! }
    : undefined;
  const rows = source.deformNumRows;
  const columns = source.deformNumCols;
  const points = source.customEnvelopeWarp?.meshPoints;
  const mesh = Number.isInteger(rows) && Number.isInteger(columns)
    && rows! >= 2 && columns! >= 2 && rows! <= 65 && columns! <= 65
    && points?.length === rows! * columns! && points.every((point) => finite(point.x) && finite(point.y))
    ? { rows: rows!, columns: columns!, points: points.map(({ x, y }) => ({ x, y })) }
    : undefined;
  if (style === 'custom' && !mesh) return null;
  return {
    style,
    bend: finite(source.value) ? source.value : finite(source.values?.[0]) ? source.values![0]! : 0,
    horizontalDistortion: finite(source.perspective) ? source.perspective : 0,
    verticalDistortion: finite(source.perspectiveOther) ? source.perspectiveOther : 0,
    orientation: source.rotate === 'vertical' ? 'vertical' : 'horizontal',
    ...(bounds ? { bounds } : {}),
    ...(mesh ? { mesh } : {})
  };
};

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.max(minimum, Math.min(maximum, value));

// ag-psd reads Photoshop's canonical 100% character scale as 1 for files
// written by current Photoshop, while older/synthetic descriptors may expose
// the percentage value directly. Normalize both representations at the PSD
// boundary so ordinary text is not misclassified as unsupported 1% scaling.
const characterScalePercent = (value: unknown) => finite(value)
  ? (Math.abs(value) <= 10 ? value * 100 : value)
  : 100;

const familyNameFromPostScript = (postScriptName: string) => {
  if (postScriptName.startsWith('Inter-')) return 'Inter';
  if (postScriptName.startsWith('SourceSerif4-')) return 'Source Serif 4';
  if (postScriptName.startsWith('JetBrainsMono-')) return 'JetBrains Mono';
  if (postScriptName.startsWith('NotoSans-')) return 'Noto Sans';
  return postScriptName;
};

const fontWeightFromPostScript = (postScriptName: string | undefined) => {
  const normalized = postScriptName?.toLowerCase() ?? '';
  if (/thin/.test(normalized)) return 100;
  if (/(?:extra|ultra)[-_ ]?light/.test(normalized)) return 200;
  if (/light/.test(normalized)) return 300;
  if (/medium/.test(normalized)) return 500;
  if (/(?:semi|demi)[-_ ]?bold/.test(normalized)) return 600;
  if (/(?:extra|ultra)[-_ ]?bold/.test(normalized)) return 800;
  if (/(?:black|heavy)/.test(normalized)) return 900;
  if (/bold/.test(normalized)) return 700;
  return 400;
};

const affine = (value: unknown): AffineMatrix | null => {
  if (value === undefined) return { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
  if (!Array.isArray(value) || value.length !== 6 || !value.every(finite)) return null;
  return {
    a: value[0],
    b: value[1],
    c: value[2],
    d: value[3],
    tx: value[4],
    ty: value[5]
  };
};

export interface PsdTextPathTarget {
  readonly layerId: string;
  readonly elementId: string;
  readonly subpathId: string;
}

interface PsdTextPathDescriptor {
  bezierCurve?: { controlPoints?: unknown };
  data?: {
    frameMatrix?: unknown;
    textRange?: unknown;
    pathData?: { reversed?: unknown };
  };
}

const isEmptyTextPathPlaceholder = (value: unknown) => {
  if (!value || typeof value !== 'object') return false;
  const descriptor = value as PsdTextPathDescriptor;
  const points = descriptor.bezierCurve?.controlPoints;
  const range = descriptor.data?.textRange;
  // Photoshop commonly writes a [-1, -1] textPath placeholder on ordinary
  // point/paragraph text. It is metadata absence, not malformed path text.
  return (!Array.isArray(points) || points.length === 0)
    && Array.isArray(range) && range.length === 2
    && range[0] === -1 && range[1] === -1;
};

const importTextPath = (
  value: unknown,
  target: PsdTextPathTarget
): {
  path: VectorPath;
  startOffset: number;
  endOffset: number;
  direction: 'forward' | 'reverse';
} | null => {
  if (!value || typeof value !== 'object') return null;
  const descriptor = value as PsdTextPathDescriptor;
  const controlPoints = descriptor.bezierCurve?.controlPoints;
  const matrix = affine(descriptor.data?.frameMatrix);
  const textRange = descriptor.data?.textRange;
  if (!Array.isArray(controlPoints) || controlPoints.length < 8
    || controlPoints.length % 8 !== 0 || !controlPoints.every(finite) || !matrix
    || !Array.isArray(textRange) || textRange.length !== 2 || !textRange.every(finite)) return null;
  const point = (offset: number) => transformPoint(matrix, {
    x: controlPoints[offset]!, y: controlPoints[offset + 1]!
  });
  const anchors = [createAnchor(`${target.subpathId}-anchor-0`, point(0), {
    handleOut: point(2), mode: 'smooth'
  })];
  for (let segment = 0; segment < controlPoints.length / 8; segment += 1) {
    const offset = segment * 8;
    const nextOffset = offset + 8;
    anchors.push(createAnchor(`${target.subpathId}-anchor-${segment + 1}`, point(offset + 6), {
      handleIn: point(offset + 4),
      handleOut: nextOffset < controlPoints.length ? point(nextOffset + 2) : null,
      mode: 'smooth'
    }));
  }
  const path = createVectorPath(
    target.elementId,
    'Photoshop Text Path',
    [createSubpath(target.subpathId, anchors, false)]
  );
  path.style = { fill: null, stroke: null, opacity: 1 };

  // Photoshop stores the authored range as segment index + cubic parameter,
  // while LightTable's editable path handles use arc length. Measure the same
  // transformed cubic geometry at import time so the first glyph does not
  // incorrectly jump to the path origin.
  const arcLengthAt = (parameter: number) => {
    const segmentCount = controlPoints.length / 8;
    const bounded = clamp(parameter, 0, segmentCount);
    const completeSegments = Math.floor(bounded);
    const partial = bounded - completeSegments;
    let length = 0;
    const samplesPerSegment = 64;
    for (let segment = 0; segment < segmentCount; segment += 1) {
      const endT = segment < completeSegments ? 1 : segment === completeSegments ? partial : 0;
      if (endT <= 0) break;
      const offset = segment * 8;
      const p0 = point(offset);
      const p1 = point(offset + 2);
      const p2 = point(offset + 4);
      const p3 = point(offset + 6);
      let previous = p0;
      const sampleCount = Math.max(1, Math.ceil(samplesPerSegment * endT));
      for (let sample = 1; sample <= sampleCount; sample += 1) {
        const t = endT * sample / sampleCount;
        const inverse = 1 - t;
        const current = {
          x: inverse ** 3 * p0.x + 3 * inverse ** 2 * t * p1.x
            + 3 * inverse * t ** 2 * p2.x + t ** 3 * p3.x,
          y: inverse ** 3 * p0.y + 3 * inverse ** 2 * t * p1.y
            + 3 * inverse * t ** 2 * p2.y + t ** 3 * p3.y
        };
        length += Math.hypot(current.x - previous.x, current.y - previous.y);
        previous = current;
      }
    }
    return length;
  };
  return {
    path,
    startOffset: arcLengthAt(textRange[0]),
    endOffset: arcLengthAt(textRange[1]),
    direction: descriptor.data?.pathData?.reversed === true ? 'reverse' : 'forward'
  };
};

const color = (
  value: PsdColor | undefined,
  reasons: string[],
  sourceProfile: DocumentBlendProfile
): RgbaColor => {
  if (value && 'r' in value && 'g' in value && 'b' in value) {
    const divisor = Math.max(value.r, value.g, value.b) > 1 ? 255 : 1;
    const alpha = 'a' in value ? (value.a > 1 ? value.a / 255 : value.a) : 1;
    const converted = convertEncodedDocumentColorToSrgb({
      r: clamp(value.r / divisor, 0, 1),
      g: clamp(value.g / divisor, 0, 1),
      b: clamp(value.b / divisor, 0, 1)
    }, sourceProfile);
    return {
      colorSpace: 'srgb',
      ...converted,
      a: clamp(alpha, 0, 1)
    };
  }
  if (value && 'fr' in value && 'fg' in value && 'fb' in value) {
    const converted = convertEncodedDocumentColorToSrgb({
      r: clamp(value.fr, 0, 1), g: clamp(value.fg, 0, 1), b: clamp(value.fb, 0, 1)
    }, sourceProfile);
    return {
      colorSpace: 'srgb',
      ...converted,
      a: 1
    };
  }
  if (value) reasons.push('A non-RGB Photoshop text color is preserved and rendered as black for now.');
  return { colorSpace: 'srgb', r: 0, g: 0, b: 0, a: 1 };
};

const style = (
  source: TextStyle,
  start: number,
  end: number,
  reasons: string[],
  sourceProfile: DocumentBlendProfile
): TextStyleRun => {
  const fill = color(source.fillColor, reasons, sourceProfile);
  const stroke = source.strokeFlag && finite(source.outlineWidth) && source.outlineWidth > 0
    ? {
      paint: { kind: 'solid' as const, color: color(source.strokeColor, reasons, sourceProfile) },
      width: clamp(source.outlineWidth, 0.01, 100_000),
      cap: 'butt' as const,
      join: 'miter' as const,
      miterLimit: 4
    }
    : undefined;
  if (source.kerning !== undefined && source.kerning !== 0) {
    reasons.push('Explicit Photoshop kerning values are preserved but currently use metrics kerning.');
  }
  if (source.autoKerning === false) {
    reasons.push('Disabled Photoshop kerning is approximated with metrics kerning after the retained preview is edited.');
  }
  if (source.underline || source.strikethrough) {
    reasons.push('Photoshop underline and strikethrough flags are preserved but not rendered yet.');
  }
  return {
    start,
    end,
    requestedFont: {
      families: source.font?.name
        ? [familyNameFromPostScript(source.font.name)] : ['Inter', 'sans-serif'],
      ...(source.font?.name ? { postScriptName: source.font.name } : {})
    },
    fontSize: clamp(finite(source.fontSize) && source.fontSize > 0 ? source.fontSize : 16, 0.01, 100_000),
    fontWeight: source.fauxBold ? 700 : fontWeightFromPostScript(source.font?.name),
    fontStyle: source.fauxItalic || /(?:italic|oblique)/i.test(source.font?.name ?? '')
      ? 'italic' : 'normal',
    fontStretch: 100,
    ...(source.fillFlag === false ? {} : { fill: { kind: 'solid' as const, color: fill } }),
    ...(stroke ? { stroke } : {}),
    tracking: clamp(finite(source.tracking) ? source.tracking : 0, -100_000, 100_000),
    // Photoshop serializes zero as the manual-pair value even while automatic
    // kerning is enabled. Only the explicit autoKerning=false state disables it.
    kerning: 'metrics',
    baselineShift: clamp(finite(source.baselineShift) ? source.baselineShift : 0, -100_000, 100_000),
    horizontalScale: clamp(characterScalePercent(source.horizontalScale), 0.01, 10_000),
    verticalScale: clamp(characterScalePercent(source.verticalScale), 0.01, 10_000),
    openTypeFeatures: {
      ...(source.ligatures === false ? { liga: false } : {}),
      ...(source.dLigatures === true ? { dlig: true } : {})
    },
    variableAxes: {},
    syntheticBold: Boolean(source.fauxBold),
    syntheticItalic: Boolean(source.fauxItalic),
    underline: Boolean(source.underline)
  };
};

const spans = <T extends { readonly length: number }>(
  textLength: number,
  runs: readonly T[] | undefined
): Array<{ start: number; end: number; run: T }> | null => {
  if (!runs?.length) return [];
  const result: Array<{ start: number; end: number; run: T }> = [];
  let start = 0;
  for (const run of runs) {
    if (!Number.isInteger(run.length) || run.length <= 0 || start + run.length > textLength) return null;
    result.push({ start, end: start + run.length, run });
    start += run.length;
  }
  return start === textLength ? result : null;
};

const paragraphStyle = (
  source: ParagraphStyle,
  characterStyle: TextStyle | undefined,
  start: number,
  end: number
): ParagraphStyleRun => ({
  start,
  end,
  alignment: source.justification === 'center'
    ? 'center'
    : source.justification === 'right' ? 'end'
      : source.justification?.startsWith('justify') ? 'justify' : 'start',
  direction: 'auto',
  lineHeight: characterStyle?.autoLeading === false && finite(characterStyle.leading) && characterStyle.leading > 0
    ? { kind: 'absolute', value: clamp(characterStyle.leading, 0.01, 100_000) }
    : { kind: 'normal' },
  firstLineIndent: clamp(finite(source.firstLineIndent) ? source.firstLineIndent : 0, -1_000_000, 1_000_000),
  startIndent: clamp(finite(source.startIndent) ? source.startIndent : 0, -1_000_000, 1_000_000),
  endIndent: clamp(finite(source.endIndent) ? source.endIndent : 0, -1_000_000, 1_000_000),
  spaceBefore: clamp(finite(source.spaceBefore) ? source.spaceBefore : 0, -1_000_000, 1_000_000),
  spaceAfter: clamp(finite(source.spaceAfter) ? source.spaceAfter : 0, -1_000_000, 1_000_000),
  hyphenation: source.autoHyphenate ? 'auto' : 'off'
});

const styleAt = (
  source: LayerTextData,
  styleSpans: ReturnType<typeof spans<NonNullable<LayerTextData['styleRuns']>[number]>>,
  offset: number
) => {
  const run = styleSpans?.find((candidate) => candidate.start <= offset && offset < candidate.end);
  return { ...(source.style ?? {}), ...(run?.run.style ?? {}) };
};

const unsupportedEditableSemantics = (source: LayerTextData): string[] => {
  const base = source.style ?? {};
  const styles = source.styleRuns?.length
    ? source.styleRuns.map((run) => ({ ...base, ...run.style }))
    : [base];
  const reasons: string[] = [];
  if (styles.some((candidate) => candidate.ligatures === false || candidate.dLigatures === true)) {
    reasons.push('Photoshop OpenType ligature overrides are preserved until editable feature controls are supported.');
  }
  if (styles.some((candidate) => candidate.strikethrough)) {
    reasons.push('Photoshop strikethrough is preserved until it can be rendered and edited faithfully.');
  }
  if (source.shapeType === 'box') {
    const paragraphs = source.paragraphStyleRuns?.length
      ? source.paragraphStyleRuns.map((run) => ({ ...(source.paragraphStyle ?? {}), ...run.style }))
      : [source.paragraphStyle ?? {}];
    if (paragraphs.some((candidate) => candidate.autoHyphenate)) {
      reasons.push('Photoshop automatic hyphenation is preserved until the editable paragraph layout supports it.');
    }
  }
  return reasons;
};

export const importPsdText = (
  value: unknown,
  sourceObjectId?: string,
  pathTarget?: PsdTextPathTarget,
  sourceProfile: DocumentBlendProfile = 'srgb'
): PsdTextImportResult => {
  if (!value || typeof value !== 'object') {
    return { kind: 'preserved', reasons: ['The Photoshop text descriptor is missing or invalid.'] };
  }
  const source = value as LayerTextData;
  if (typeof source.text !== 'string') {
    return { kind: 'preserved', reasons: ['The Photoshop text descriptor has no valid text content.'] };
  }
  const warp = normalizeWarp(source.warp);
  if (source.warp?.style && source.warp.style !== 'none' && !warp) {
    return { kind: 'preserved', reasons: ['The Photoshop custom text warp mesh is incomplete or invalid.'] };
  }
  const authoredTextPath = Boolean(source.textPath)
    && !isEmptyTextPathPlaceholder(source.textPath);
  const importedPath = authoredTextPath && pathTarget
    ? importTextPath(source.textPath, pathTarget)
    : null;
  if (authoredTextPath && !importedPath) {
    return { kind: 'preserved', reasons: ['Photoshop text on a path remains preview-backed until path binding is implemented.'] };
  }
  if (source.orientation === 'vertical' && importedPath) {
    return { kind: 'preserved', reasons: ['Vertical Photoshop path text remains preview-backed pending path-layout fixtures.'] };
  }
  const transform = affine(source.transform);
  if (!transform) {
    return { kind: 'preserved', reasons: ['The Photoshop text transform is invalid.'] };
  }

  // Photoshop uses carriage returns in authored text. Replacing each code unit
  // with a line feed keeps style-run offsets stable.
  const text = source.text.replace(/\r/g, '\n');
  const styleSpans = spans(text.length, source.styleRuns);
  const paragraphSpans = spans(text.length, source.paragraphStyleRuns);
  if (styleSpans === null || paragraphSpans === null) {
    return { kind: 'preserved', reasons: ['Photoshop text run lengths do not cover the text exactly.'] };
  }
  const unsupportedReasons = unsupportedEditableSemantics(source);
  if (unsupportedReasons.length) return { kind: 'preserved', reasons: unsupportedReasons };

  const reasons = [
    'Editable text semantics were imported; exact appearance depends on resolving the original Photoshop fonts.'
  ];
  const effectiveStyleSpans = styleSpans.length
    ? styleSpans
    : text.length ? [{ start: 0, end: text.length, run: { length: text.length, style: source.style ?? {} } }] : [];
  const styleRuns = effectiveStyleSpans.map(({ start, end, run }) =>
    style({ ...(source.style ?? {}), ...run.style }, start, end, reasons, sourceProfile));
  const effectiveParagraphSpans = paragraphSpans.length
    ? paragraphSpans
    : text.length ? [{ start: 0, end: text.length, run: { length: text.length, style: source.paragraphStyle ?? {} } }] : [];
  const paragraphRuns = effectiveParagraphSpans.map(({ start, end, run }) => paragraphStyle(
    { ...(source.paragraphStyle ?? {}), ...run.style },
    styleAt(source, styleSpans, start),
    start,
    end
  ));
  const defaultFlow = createDefaultFlowTextSource(text);
  const pointBase = source.pointBase;
  const boxBounds = source.boxBounds;
  const layout = importedPath && pathTarget
    ? {
      mode: 'path' as const,
      pathLayerId: pathTarget.layerId,
      pathElementId: pathTarget.elementId,
      pathSubpathId: pathTarget.subpathId,
      startOffset: importedPath.startOffset,
      endOffset: importedPath.endOffset,
      direction: importedPath.direction,
      side: 'left' as const,
      // Photoshop keeps glyph orientation continuous along the authored
      // contour. Per-glyph upright normalization flips both the tangent and
      // baseline normal at +/-90 degrees and visibly puts characters on the
      // wrong side of looping paths.
      upright: false
    }
    : source.shapeType === 'box'
    && Array.isArray(boxBounds)
    && boxBounds.length === 4
    && boxBounds.every(finite)
    && boxBounds[2] > boxBounds[0]
    && boxBounds[3] > boxBounds[1]
    ? {
      mode: 'paragraph' as const,
      frame: {
        x: boxBounds[0],
        y: boxBounds[1],
        width: boxBounds[2] - boxBounds[0],
        height: boxBounds[3] - boxBounds[1]
      },
      overflow: 'visible' as const,
      writingMode: source.orientation === 'vertical' ? 'vertical-rl' as const : 'horizontal-tb' as const
    }
    : {
      mode: 'point' as const,
      origin: Array.isArray(pointBase) && pointBase.length >= 2 && finite(pointBase[0]) && finite(pointBase[1])
        ? { x: pointBase[0], y: pointBase[1] }
        : { x: 0, y: 0 },
      writingMode: source.orientation === 'vertical' ? 'vertical-rl' as const : 'horizontal-tb' as const
    };
  if (!importedPath && source.shapeType === 'box' && layout.mode !== 'paragraph') {
    return { kind: 'preserved', reasons: ['The Photoshop paragraph text frame is missing or invalid.'] };
  }
  const insertionStyle = style({ ...(source.style ?? {}) }, 0, 1, reasons, sourceProfile);
  const insertionParagraph = paragraphStyle(source.paragraphStyle ?? {}, source.style, 0, 1);
  const data: TextLayerData = {
    ...createDefaultTextLayerData(),
    ...(warp ? { warp } : {}),
    source: {
      ...defaultFlow,
      text,
      styleRuns,
      paragraphRuns,
      ...(text.length === 0 ? {
        insertionStyle: (({ start: _start, end: _end, ...rest }) => rest)(insertionStyle),
        insertionParagraph: (({ start: _start, end: _end, ...rest }) => rest)(insertionParagraph)
      } : {}),
      layout
    },
    interchange: {
      format: 'psd',
      ...(sourceObjectId ? { sourceObjectId } : {}),
      preservedFields: {
        shapeType: source.shapeType ?? 'point',
        orientation: source.orientation ?? 'horizontal',
        antiAlias: source.antiAlias ?? null,
        styleRunCount: source.styleRuns?.length ?? 0,
        paragraphRunCount: source.paragraphStyleRuns?.length ?? 0
      }
    }
  };
  try {
    assertTextLayerData(data);
  } catch (error) {
    return {
      kind: 'preserved',
      reasons: [`The normalized Photoshop text descriptor is outside LightTable's safe limits: ${error instanceof Error ? error.message : String(error)}`]
    };
  }
  if (importedPath) reasons.push('Photoshop path geometry is mapped to an editable native text path.');
  if (warp) reasons.push('Photoshop text warp is mapped to an editable native vector envelope.');
  return {
    kind: 'editable-flow', text: data, transform,
    path: importedPath?.path ?? null,
    reasons: [...new Set(reasons)]
  };
};
