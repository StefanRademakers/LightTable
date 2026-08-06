import type { AffineMatrix } from '../../editor/geometry/affine';

export type SemanticTextWritingMode = 'horizontal-tb' | 'vertical-rl' | 'vertical-lr';
export interface SemanticTextFontRequest {
  readonly assetId?: string;
  readonly family?: string;
  readonly style?: string;
}
export interface SemanticTextStylePatch {
  readonly font?: SemanticTextFontRequest;
  readonly fontSize?: number;
  readonly fontWeight?: number;
  readonly fontStyle?: 'normal' | 'italic' | 'oblique';
  readonly tracking?: number;
  readonly fill?: { readonly enabled: boolean; readonly color?: string };
  readonly stroke?: { readonly enabled: boolean; readonly color?: string; readonly width?: number };
  readonly underline?: boolean;
}
export interface SemanticParagraphStylePatch {
  readonly alignment?: 'start' | 'center' | 'end' | 'justify';
  readonly direction?: 'auto' | 'ltr' | 'rtl';
  readonly leading?: 'normal' | { readonly kind?: 'absolute' | 'multiple'; readonly value: number };
  readonly firstLineIndent?: number;
  readonly startIndent?: number;
  readonly endIndent?: number;
  readonly spaceBefore?: number;
  readonly spaceAfter?: number;
}
export type SemanticTextCommand =
  | { readonly kind: 'create'; readonly mode: 'point' | 'paragraph'; readonly text: string;
      readonly name?: string; readonly origin: { readonly x: number; readonly y: number };
      readonly frame?: { readonly width: number; readonly height: number };
      readonly writingMode: SemanticTextWritingMode; readonly style?: SemanticTextStylePatch;
      readonly paragraph?: SemanticParagraphStylePatch }
  | { readonly kind: 'replace'; readonly layerId: string; readonly start: number;
      readonly end: number; readonly text: string }
  | { readonly kind: 'format'; readonly layerId: string; readonly start?: number;
      readonly end?: number; readonly style?: SemanticTextStylePatch;
      readonly paragraph?: SemanticParagraphStylePatch }
  | { readonly kind: 'layout'; readonly layerId: string;
      readonly mode?: 'point' | 'paragraph'; readonly origin?: { readonly x: number; readonly y: number };
      readonly frame?: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
      readonly writingMode?: SemanticTextWritingMode; readonly transform?: AffineMatrix };

const record = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);
const finite = (value: unknown, minimum = -10_000_000, maximum = 10_000_000): value is number => (
  typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum
);
const point = (value: unknown): value is { x: number; y: number } => (
  record(value) && finite(value.x) && finite(value.y)
);
const color = (value: unknown) => typeof value === 'string' && /^#[\da-f]{6}$/iu.test(value);
const writingMode = (value: unknown): value is SemanticTextWritingMode => (
  value === 'horizontal-tb' || value === 'vertical-rl' || value === 'vertical-lr'
);
const layerId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 255;
const content = (value: unknown): value is string => typeof value === 'string' && value.length <= 1_000_000;

const parseFont = (value: unknown): SemanticTextFontRequest | null => {
  if (!record(value)) return null;
  const result: SemanticTextFontRequest = {
    ...(typeof value.assetId === 'string' && value.assetId.length <= 255 ? { assetId: value.assetId } : {}),
    ...(typeof value.family === 'string' && value.family.length <= 255 ? { family: value.family } : {}),
    ...(typeof value.style === 'string' && value.style.length <= 255 ? { style: value.style } : {})
  };
  return result.assetId || result.family ? result : null;
};

const parseStyle = (value: unknown): SemanticTextStylePatch | null => {
  if (value === undefined) return {};
  if (!record(value)) return null;
  const font = value.font === undefined ? undefined : parseFont(value.font);
  if (value.font !== undefined && !font) return null;
  if (value.fontSize !== undefined && !finite(value.fontSize, 0.1, 100_000)) return null;
  if (value.fontWeight !== undefined && !finite(value.fontWeight, 1, 1_000)) return null;
  if (value.fontStyle !== undefined && !['normal', 'italic', 'oblique'].includes(String(value.fontStyle))) return null;
  if (value.tracking !== undefined && !finite(value.tracking, -10_000, 100_000)) return null;
  if (value.underline !== undefined && typeof value.underline !== 'boolean') return null;
  const parsePaint = (paint: unknown, stroke: boolean) => {
    if (!record(paint) || typeof paint.enabled !== 'boolean') return null;
    if (paint.color !== undefined && !color(paint.color)) return null;
    if (stroke && paint.width !== undefined && !finite(paint.width, 0, 100_000)) return null;
    return { enabled: paint.enabled, ...(paint.color ? { color: String(paint.color) } : {}),
      ...(stroke && typeof paint.width === 'number' ? { width: paint.width } : {}) };
  };
  const fill = value.fill === undefined ? undefined : parsePaint(value.fill, false);
  const stroke = value.stroke === undefined ? undefined : parsePaint(value.stroke, true);
  if ((value.fill !== undefined && !fill) || (value.stroke !== undefined && !stroke)) return null;
  return { ...(font ? { font } : {}), ...(typeof value.fontSize === 'number' ? { fontSize: value.fontSize } : {}),
    ...(typeof value.fontWeight === 'number' ? { fontWeight: value.fontWeight } : {}),
    ...(typeof value.fontStyle === 'string' ? { fontStyle: value.fontStyle as SemanticTextStylePatch['fontStyle'] } : {}),
    ...(typeof value.tracking === 'number' ? { tracking: value.tracking } : {}),
    ...(typeof value.underline === 'boolean' ? { underline: value.underline } : {}),
    ...(fill ? { fill } : {}), ...(stroke ? { stroke } : {}) };
};

const parseParagraph = (value: unknown): SemanticParagraphStylePatch | null => {
  if (value === undefined) return {};
  if (!record(value)) return null;
  if (value.alignment !== undefined && !['start', 'center', 'end', 'justify'].includes(String(value.alignment))) return null;
  if (value.direction !== undefined && !['auto', 'ltr', 'rtl'].includes(String(value.direction))) return null;
  const numeric = ['firstLineIndent', 'startIndent', 'endIndent', 'spaceBefore', 'spaceAfter'] as const;
  if (numeric.some((key) => value[key] !== undefined && !finite(value[key], -100_000, 100_000))) return null;
  let leading: SemanticParagraphStylePatch['leading'];
  if (value.leading === 'normal') leading = 'normal';
  else if (value.leading !== undefined) {
    if (!record(value.leading) || !finite(value.leading.value, 0.1, 100_000)
      || (value.leading.kind !== undefined && value.leading.kind !== 'absolute' && value.leading.kind !== 'multiple')) return null;
    leading = { kind: value.leading.kind === 'multiple' ? 'multiple' : 'absolute', value: value.leading.value };
  }
  return { ...(value.alignment ? { alignment: value.alignment as SemanticParagraphStylePatch['alignment'] } : {}),
    ...(value.direction ? { direction: value.direction as SemanticParagraphStylePatch['direction'] } : {}),
    ...(leading ? { leading } : {}),
    ...Object.fromEntries(numeric.filter((key) => typeof value[key] === 'number').map((key) => [key, value[key]])) };
};

export const parseSemanticTextCommand = (
  kind: SemanticTextCommand['kind'], value: unknown
): SemanticTextCommand | { readonly message: string } => {
  if (!record(value)) return { message: 'Text command parameters must be an object.' };
  if (kind === 'create') {
    const style = parseStyle(value.style); const paragraph = parseParagraph(value.paragraph);
    if ((value.mode !== 'point' && value.mode !== 'paragraph') || !content(value.text) || !point(value.origin)
      || (value.name !== undefined && (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 255))
      || (value.writingMode !== undefined && !writingMode(value.writingMode)) || !style || !paragraph) {
      return { message: 'Create text parameters are invalid.' };
    }
    const frame = value.frame;
    if (value.mode === 'paragraph' && (!record(frame) || !finite(frame.width, 1) || !finite(frame.height, 1))) {
      return { message: 'Paragraph text requires a positive frame width and height.' };
    }
    return { kind, mode: value.mode, text: value.text, origin: value.origin,
      writingMode: writingMode(value.writingMode) ? value.writingMode : 'horizontal-tb',
      ...(typeof value.name === 'string' ? { name: value.name.trim() } : {}),
      ...(record(frame) ? { frame: { width: Number(frame.width), height: Number(frame.height) } } : {}),
      ...(Object.keys(style).length ? { style } : {}), ...(Object.keys(paragraph).length ? { paragraph } : {}) };
  }
  if (!layerId(value.layerId)) return { message: 'Text edits require a valid layerId.' };
  if (kind === 'replace') {
    if (!Number.isInteger(value.start) || !Number.isInteger(value.end) || Number(value.start) < 0
      || Number(value.end) < Number(value.start) || !content(value.text)) return { message: 'Replacement range or content is invalid.' };
    return { kind, layerId: value.layerId, start: Number(value.start), end: Number(value.end), text: value.text };
  }
  if (kind === 'format') {
    const style = parseStyle(value.style); const paragraph = parseParagraph(value.paragraph);
    const ranged = value.start !== undefined || value.end !== undefined;
    if (!style || !paragraph || (ranged && (!Number.isInteger(value.start) || !Number.isInteger(value.end)
      || Number(value.start) < 0 || Number(value.end) < Number(value.start)))) return { message: 'Text format range or properties are invalid.' };
    return { kind, layerId: value.layerId, ...(ranged ? { start: Number(value.start), end: Number(value.end) } : {}),
      ...(Object.keys(style).length ? { style } : {}), ...(Object.keys(paragraph).length ? { paragraph } : {}) };
  }
  const frame = value.frame; const transform = value.transform;
  if (value.mode !== undefined && value.mode !== 'point' && value.mode !== 'paragraph') return { message: 'Text layout mode is invalid.' };
  if (value.writingMode !== undefined && !writingMode(value.writingMode)) return { message: 'Writing mode is invalid.' };
  if (value.origin !== undefined && !point(value.origin)) return { message: 'Text origin is invalid.' };
  if (frame !== undefined && (!record(frame) || !finite(frame.x) || !finite(frame.y)
    || !finite(frame.width, 1) || !finite(frame.height, 1))) return { message: 'Paragraph frame is invalid.' };
  if (transform !== undefined && (!record(transform)
    || ['a', 'b', 'c', 'd', 'tx', 'ty'].some((key) => !finite(transform[key])))) return { message: 'Text transform is invalid.' };
  return { kind, layerId: value.layerId, ...(value.mode ? { mode: value.mode } : {}),
    ...(point(value.origin) ? { origin: value.origin } : {}),
    ...(record(frame) ? { frame: frame as unknown as { x: number; y: number; width: number; height: number } } : {}),
    ...(writingMode(value.writingMode) ? { writingMode: value.writingMode } : {}),
    ...(record(transform) ? { transform: transform as unknown as AffineMatrix } : {}) };
};
