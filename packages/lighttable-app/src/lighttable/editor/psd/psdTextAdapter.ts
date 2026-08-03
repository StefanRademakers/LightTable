import type {
  Color as PsdColor,
  LayerTextData,
  ParagraphStyle,
  TextStyle
} from 'ag-psd';
import {
  assertTextLayerData,
  createDefaultFlowTextSource,
  createDefaultTextLayerData,
  type ParagraphStyleRun,
  type RgbaColor,
  type TextLayerData,
  type TextStyleRun
} from '@lighttable/text-core';
import type { AffineMatrix } from '../rendering/renderContract';

export type PsdTextImportResult =
  | {
    readonly kind: 'editable-flow';
    readonly text: TextLayerData;
    readonly transform: AffineMatrix;
    readonly reasons: readonly string[];
  }
  | {
    readonly kind: 'preserved';
    readonly reasons: readonly string[];
  };

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.max(minimum, Math.min(maximum, value));

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

const color = (value: PsdColor | undefined, reasons: string[]): RgbaColor => {
  if (value && 'r' in value && 'g' in value && 'b' in value) {
    const divisor = Math.max(value.r, value.g, value.b) > 1 ? 255 : 1;
    const alpha = 'a' in value ? (value.a > 1 ? value.a / 255 : value.a) : 1;
    return {
      colorSpace: 'srgb',
      r: clamp(value.r / divisor, 0, 1),
      g: clamp(value.g / divisor, 0, 1),
      b: clamp(value.b / divisor, 0, 1),
      a: clamp(alpha, 0, 1)
    };
  }
  if (value && 'fr' in value && 'fg' in value && 'fb' in value) {
    return {
      colorSpace: 'srgb',
      r: clamp(value.fr, 0, 1),
      g: clamp(value.fg, 0, 1),
      b: clamp(value.fb, 0, 1),
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
  reasons: string[]
): TextStyleRun => {
  const fill = color(source.fillColor, reasons);
  const stroke = source.strokeFlag && finite(source.outlineWidth) && source.outlineWidth > 0
    ? {
      paint: { kind: 'solid' as const, color: color(source.strokeColor, reasons) },
      width: clamp(source.outlineWidth, 0.01, 100_000),
      cap: 'butt' as const,
      join: 'miter' as const,
      miterLimit: 4
    }
    : undefined;
  if (source.kerning !== undefined && source.kerning !== 0) {
    reasons.push('Explicit Photoshop kerning values are preserved but currently use metrics kerning.');
  }
  if (source.underline || source.strikethrough) {
    reasons.push('Photoshop underline and strikethrough flags are preserved but not rendered yet.');
  }
  return {
    start,
    end,
    requestedFont: {
      families: source.font?.name ? [source.font.name] : ['Inter', 'sans-serif'],
      ...(source.font?.name ? { postScriptName: source.font.name } : {})
    },
    fontSize: clamp(finite(source.fontSize) && source.fontSize > 0 ? source.fontSize : 16, 0.01, 100_000),
    fontWeight: source.fauxBold ? 700 : 400,
    fontStyle: source.fauxItalic ? 'italic' : 'normal',
    fontStretch: 100,
    fill: {
      kind: 'solid',
      color: source.fillFlag === false ? { ...fill, a: 0 } : fill
    },
    ...(stroke ? { stroke } : {}),
    tracking: clamp(finite(source.tracking) ? source.tracking : 0, -100_000, 100_000),
    // Photoshop serializes zero as the manual-pair value even while automatic
    // kerning is enabled. Only the explicit autoKerning=false state disables it.
    kerning: source.autoKerning === false ? 'none' : 'metrics',
    baselineShift: clamp(finite(source.baselineShift) ? source.baselineShift : 0, -100_000, 100_000),
    horizontalScale: clamp(finite(source.horizontalScale) && source.horizontalScale > 0 ? source.horizontalScale : 100, 0.01, 10_000),
    verticalScale: clamp(finite(source.verticalScale) && source.verticalScale > 0 ? source.verticalScale : 100, 0.01, 10_000),
    openTypeFeatures: {
      ...(source.ligatures === false ? { liga: false } : {}),
      ...(source.dLigatures !== undefined ? { dlig: source.dLigatures } : {})
    },
    variableAxes: {},
    syntheticBold: Boolean(source.fauxBold),
    syntheticItalic: Boolean(source.fauxItalic)
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
  if (styles.some((candidate) => candidate.fauxBold || candidate.fauxItalic)) {
    reasons.push('Photoshop faux bold or italic requires text synthesis that is not editable yet.');
  }
  if (styles.some((candidate) => finite(candidate.baselineShift) && candidate.baselineShift !== 0)) {
    reasons.push('Photoshop baseline shift is preserved until the editable layout path supports it.');
  }
  if (styles.some((candidate) => (finite(candidate.horizontalScale) && candidate.horizontalScale !== 100)
    || (finite(candidate.verticalScale) && candidate.verticalScale !== 100))) {
    reasons.push('Photoshop character scaling is preserved until the editable layout path supports it.');
  }
  if (styles.some((candidate) => candidate.autoKerning === false)) {
    reasons.push('Disabled Photoshop kerning is preserved until the editable layout path supports it.');
  }
  if (styles.some((candidate) => candidate.ligatures === false || candidate.dLigatures === true)) {
    reasons.push('Photoshop OpenType ligature overrides are preserved until editable feature controls are supported.');
  }
  if (styles.some((candidate) => candidate.underline || candidate.strikethrough)) {
    reasons.push('Photoshop text decorations are preserved until they can be rendered and edited faithfully.');
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

export const importPsdText = (value: unknown, sourceObjectId?: string): PsdTextImportResult => {
  if (!value || typeof value !== 'object') {
    return { kind: 'preserved', reasons: ['The Photoshop text descriptor is missing or invalid.'] };
  }
  const source = value as LayerTextData;
  if (typeof source.text !== 'string') {
    return { kind: 'preserved', reasons: ['The Photoshop text descriptor has no valid text content.'] };
  }
  if (source.warp?.style && source.warp.style !== 'none') {
    return { kind: 'preserved', reasons: ['Warped Photoshop text remains preview-backed until warp semantics are implemented.'] };
  }
  if (source.textPath) {
    return { kind: 'preserved', reasons: ['Photoshop text on a path remains preview-backed until path binding is implemented.'] };
  }
  if (source.orientation === 'vertical') {
    return { kind: 'preserved', reasons: ['Vertical Photoshop text remains preview-backed pending vertical-layout fixtures.'] };
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
    style({ ...(source.style ?? {}), ...run.style }, start, end, reasons));
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
  const layout = source.shapeType === 'box'
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
      writingMode: 'horizontal-tb' as const
    }
    : {
      mode: 'point' as const,
      origin: Array.isArray(pointBase) && pointBase.length >= 2 && finite(pointBase[0]) && finite(pointBase[1])
        ? { x: pointBase[0], y: pointBase[1] }
        : { x: 0, y: 0 },
      writingMode: 'horizontal-tb' as const
    };
  if (source.shapeType === 'box' && layout.mode !== 'paragraph') {
    return { kind: 'preserved', reasons: ['The Photoshop paragraph text frame is missing or invalid.'] };
  }
  const insertionStyle = style({ ...(source.style ?? {}) }, 0, 1, reasons);
  const insertionParagraph = paragraphStyle(source.paragraphStyle ?? {}, source.style, 0, 1);
  const data: TextLayerData = {
    ...createDefaultTextLayerData(),
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
  return { kind: 'editable-flow', text: data, transform, reasons: [...new Set(reasons)] };
};
