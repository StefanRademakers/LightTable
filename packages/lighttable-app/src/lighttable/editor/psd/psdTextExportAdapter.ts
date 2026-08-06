import type {
  LayerTextData,
  ParagraphStyle,
  TextStyle,
  Warp
} from 'ag-psd';
import type {
  ParagraphStyleRun,
  TextLayerData,
  TextPaint,
  TextStyleRun,
  TextWarp
} from '@lighttable/text-core';
import type { AffineMatrix } from '../geometry/affine';

const solidColor = (paint: TextPaint | undefined) => {
  if (!paint || paint.kind !== 'solid') return undefined;
  return {
    r: Math.round(paint.color.r * 255),
    g: Math.round(paint.color.g * 255),
    b: Math.round(paint.color.b * 255),
    a: Math.round(paint.color.a * 255)
  };
};

const textStyle = (run: Omit<TextStyleRun, 'start' | 'end'>): TextStyle => ({
  font: { name: run.requestedFont.postScriptName
    ?? run.requestedFont.families[0]?.replaceAll(' ', '') ?? 'Inter-Regular' },
  fontSize: run.fontSize,
  fauxBold: run.syntheticBold,
  fauxItalic: run.syntheticItalic,
  tracking: run.tracking,
  autoKerning: run.kerning !== 'none',
  baselineShift: run.baselineShift,
  horizontalScale: run.horizontalScale / 100,
  verticalScale: run.verticalScale / 100,
  ligatures: run.openTypeFeatures.liga !== false,
  dLigatures: run.openTypeFeatures.dlig === true,
  underline: run.underline === true,
  fillFlag: Boolean(run.fill),
  strokeFlag: Boolean(run.stroke),
  fillColor: solidColor(run.fill),
  strokeColor: solidColor(run.stroke?.paint),
  outlineWidth: run.stroke?.width
});

const paragraphStyle = (run: Omit<ParagraphStyleRun, 'start' | 'end'>): ParagraphStyle => ({
  justification: run.alignment === 'start' ? 'left'
    : run.alignment === 'end' ? 'right'
      : run.alignment === 'justify' ? 'justify-left' : 'center',
  firstLineIndent: run.firstLineIndent,
  startIndent: run.startIndent,
  endIndent: run.endIndent,
  spaceBefore: run.spaceBefore,
  spaceAfter: run.spaceAfter,
  autoHyphenate: run.hyphenation === 'auto'
});

const warpStyle = (style: TextWarp['style']): Warp['style'] => ({
  'arc-lower': 'arcLower', 'arc-upper': 'arcUpper',
  'shell-lower': 'shellLower', 'shell-upper': 'shellUpper'
} as Partial<Record<TextWarp['style'], Warp['style']>>)[style] ?? style as Warp['style'];

const warp = (value: TextWarp | undefined): Warp | undefined => value ? ({
  style: warpStyle(value.style), value: value.bend,
  perspective: value.horizontalDistortion,
  perspectiveOther: value.verticalDistortion,
  rotate: value.orientation,
  ...(value.bounds ? { bounds: {
    left: { units: 'Pixels', value: value.bounds.x },
    top: { units: 'Pixels', value: value.bounds.y },
    right: { units: 'Pixels', value: value.bounds.x + value.bounds.width },
    bottom: { units: 'Pixels', value: value.bounds.y + value.bounds.height }
  } } : {}),
  ...(value.mesh ? {
    deformNumRows: value.mesh.rows,
    deformNumCols: value.mesh.columns,
    customEnvelopeWarp: { meshPoints: value.mesh.points.map((point) => ({ ...point })) }
  } : {})
}) : undefined;

const translateTextOrigin = (transform: AffineMatrix, x: number, y: number): number[] => ([
  transform.a, transform.b, transform.c, transform.d,
  transform.a * x + transform.c * y + transform.tx,
  transform.b * x + transform.d * y + transform.ty
]);

/** Converts editable LightTable flow text to Photoshop TySh semantics. */
export const exportTextLayerToPsd = (
  text: TextLayerData,
  transform: AffineMatrix,
  preserved?: unknown
): LayerTextData | undefined => {
  if (text.source.kind !== 'flow') return undefined;
  const source = text.source;
  const styleRuns = source.styleRuns.length ? source.styleRuns : source.insertionStyle
    ? [{ ...source.insertionStyle, start: 0, end: Math.max(1, source.text.length) }]
    : [];
  const paragraphRuns = source.paragraphRuns.length ? source.paragraphRuns : source.insertionParagraph
    ? [{ ...source.insertionParagraph, start: 0, end: Math.max(1, source.text.length) }]
    : [];
  const firstStyle = styleRuns[0];
  const firstParagraph = paragraphRuns[0];
  const result: LayerTextData = {
    text: source.text.replace(/\n/g, '\r'),
    transform: [transform.a, transform.b, transform.c, transform.d, transform.tx, transform.ty],
    antiAlias: 'smooth',
    orientation: source.layout.mode !== 'path' && source.layout.writingMode !== 'horizontal-tb'
      ? 'vertical' : 'horizontal',
    style: firstStyle ? textStyle(firstStyle) : undefined,
    styleRuns: source.text.length ? styleRuns.map((run) => ({
      length: run.end - run.start,
      style: textStyle(run)
    })) : undefined,
    paragraphStyle: firstParagraph ? paragraphStyle(firstParagraph) : undefined,
    paragraphStyleRuns: source.text.length ? paragraphRuns.map((run) => ({
      length: run.end - run.start,
      style: paragraphStyle(run)
    })) : undefined,
    warp: warp(text.warp)
  };
  if (source.layout.mode === 'paragraph') {
    const frame = source.layout.frame;
    result.shapeType = 'box';
    result.transform = translateTextOrigin(transform, frame.x, frame.y);
    result.boxBounds = [0, 0, frame.width, frame.height];
  } else if (source.layout.mode === 'point') {
    result.shapeType = 'point';
    result.transform = translateTextOrigin(transform, source.layout.origin.x, source.layout.origin.y);
    result.pointBase = [0, 0];
  } else {
    // Arc-length editing handles do not carry Photoshop's segment+t range.
    // Merge current editable properties into the retained TextFrameSet so a
    // PSD-origin path keeps its exact contour direction, range and pivot.
    if (!preserved || typeof preserved !== 'object'
      || !(preserved as LayerTextData).textPath) return undefined;
    const original = structuredClone(preserved as LayerTextData);
    return {
      ...original,
      ...result,
      shapeType: original.shapeType,
      pointBase: original.pointBase,
      boxBounds: original.boxBounds,
      textPath: original.textPath
    };
  }
  return result;
};
