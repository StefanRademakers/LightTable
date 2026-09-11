import type { FlowTextSource, ParagraphStyleRun, TextPaint, TextStyleRun } from '@lighttable/text-core';
import type { DocumentFontAsset, ImageDocument } from '../../editor/document/documentTypes';
import { findDocumentLayer } from '../../editor/document/layerTree';
import type { FlowTextEditingSessionController } from './flowTextEditingSession';
import type { TextSelectionRange } from './flowTextEditing';
import {
  projectFlowTextStyleProperty,
  projectFlowTextParagraphProperty,
  projectFlowTextStyleValue,
  type MixedValue,
  type TextStylePatch
} from './flowTextFormatting';

export interface TextPropertyPresentation {
  readonly target: 'selection' | 'insertion' | 'layer';
  readonly family: MixedValue<string>;
  readonly face: MixedValue<string>;
  readonly size: MixedValue<number>;
  readonly fillEnabled: MixedValue<boolean>;
  readonly fill: MixedValue<string>;
  readonly fillPaint?: MixedValue<TextPaint | undefined>;
  readonly strokeColor: MixedValue<string>;
  readonly strokeWidth: MixedValue<number>;
  readonly tracking: MixedValue<number>;
  readonly kerning: MixedValue<TextStyleRun['kerning']>;
  readonly baselineShift: MixedValue<number>;
  readonly horizontalScale: MixedValue<number>;
  readonly verticalScale: MixedValue<number>;
  readonly syntheticBold: MixedValue<boolean>;
  readonly syntheticItalic: MixedValue<boolean>;
  readonly underline: MixedValue<boolean>;
  readonly writingMode: MixedValue<'horizontal-tb' | 'vertical-rl' | 'vertical-lr'>;
  readonly alignment: MixedValue<ParagraphStyleRun['alignment']>;
  readonly lineHeight: MixedValue<ParagraphStyleRun['lineHeight']>;
  readonly firstLineIndent: MixedValue<number>;
  readonly startIndent: MixedValue<number>;
  readonly endIndent: MixedValue<number>;
  readonly spaceBefore: MixedValue<number>;
  readonly spaceAfter: MixedValue<number>;
  readonly advancedUnavailableReason: string;
}

/** Pure contextual projection; no panel snapshot is an authoring authority. */
export const resolveTextProperties = (document: ImageDocument | null,
  editing: Pick<FlowTextEditingSessionController, 'getSnapshot' | 'formatProjection'>,
  fonts: readonly DocumentFontAsset[]) => {
  const layer = document ? findDocumentLayer(document, document.activeLayerId) : null;
  const source = layer?.type === 'text' && layer.text.source.kind === 'flow' ? layer.text.source : null;
  const snapshot = editing.getSnapshot();
  const targetsLayer = snapshot.status === 'editing' && snapshot.layerId === layer?.id;
  const format = targetsLayer ? editing.formatProjection() : null;
  const style = format?.target === 'insertion' && format.style.kind === 'value'
    ? { ...format.style.value, start: 0, end: 0 } : undefined;
  const paragraph = format?.target === 'insertion' && format.paragraph.kind === 'value'
    ? { ...format.paragraph.value, start: 0, end: 0 } : undefined;
  const unavailable = { kind: 'unavailable' as const };
  const model: TextPropertyPresentation | null = source
    ? buildTextPropertyPresentation(source, targetsLayer ? snapshot.selection : null, fonts, style, paragraph)
    : layer?.type === 'text' ? {
      target: 'layer', family: unavailable, face: unavailable, size: unavailable,
      fillEnabled: unavailable, fill: unavailable, strokeColor: unavailable, strokeWidth: unavailable,
      tracking: unavailable, kerning: unavailable, baselineShift: unavailable,
      horizontalScale: unavailable, verticalScale: unavailable, syntheticBold: unavailable,
      syntheticItalic: unavailable, underline: unavailable, writingMode: unavailable,
      alignment: unavailable, lineHeight: unavailable, firstLineIndent: unavailable,
      startIndent: unavailable, endIndent: unavailable, spaceBefore: unavailable, spaceAfter: unavailable,
      advancedUnavailableReason: 'Positioned imported text preserves exact glyph placement. Editable flow conversion is not available yet; preserve it or rasterize a copy.'
    } : null;
  return { layer, model, layoutMode: source?.layout.mode === 'point' || source?.layout.mode === 'paragraph'
    ? source.layout.mode : null };
};

const mapValue = <Input, Output>(
  value: MixedValue<Input>,
  project: (input: Input) => Output | null
): MixedValue<Output> => {
  if (value.kind !== 'value') return value;
  const projected = project(value.value);
  return projected === null ? { kind: 'unavailable' } : { kind: 'value', value: projected };
};

const byteHex = (value: number) => Math.round(Math.max(0, Math.min(1, value)) * 255)
  .toString(16).padStart(2, '0');

export const solidTextPaintHex = (paint: TextStyleRun['fill']) => paint?.kind === 'solid'
  && paint.color.colorSpace === 'srgb'
  ? `#${byteHex(paint.color.r)}${byteHex(paint.color.g)}${byteHex(paint.color.b)}`
  : null;

const solidPaintFromHex = (value: string): TextStyleRun['fill'] | null => {
  const match = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(value);
  if (!match) return null;
  return { kind: 'solid', color: {
    colorSpace: 'srgb',
    r: Number.parseInt(match[1]!, 16) / 255,
    g: Number.parseInt(match[2]!, 16) / 255,
    b: Number.parseInt(match[3]!, 16) / 255,
    a: 1
  } };
};

export const textFillPatchFromHex = (value: string): TextStylePatch | null => {
  const fill = solidPaintFromHex(value);
  return fill ? { fill } : null;
};

export const textFillEnabledPatch = (
  enabled: boolean,
  fallbackColor = '#000000'
): TextStylePatch => enabled
  ? textFillPatchFromHex(fallbackColor) ?? {}
  : { fill: undefined };

export const textStrokePatch = (value: string, width: number): TextStylePatch | null => {
  if (!Number.isFinite(width) || width < 0 || width > 100_000) return null;
  if (width === 0) return { stroke: undefined };
  const paint = solidPaintFromHex(value);
  return paint ? { stroke: {
    paint, width, cap: 'butt', join: 'miter', miterLimit: 4
  } } : null;
};

const faceKey = (asset: Pick<DocumentFontAsset, 'fingerprintSha256' | 'faceIndex'>) => (
  `${asset.fingerprintSha256}:${asset.faceIndex}`
);

export const textFontPatch = (asset: DocumentFontAsset): TextStylePatch => ({
  requestedFont: {
    families: [asset.familyNames[0] ?? asset.postScriptName ?? 'Unknown'],
    ...(asset.postScriptName ? { postScriptName: asset.postScriptName } : {}),
    preferredAsset: {
      assetId: asset.assetId,
      faceIndex: asset.faceIndex,
      fingerprintSha256: asset.fingerprintSha256,
      source: asset.source,
      container: asset.container,
      outline: asset.outline,
      ...(asset.postScriptName ? { postScriptName: asset.postScriptName } : {}),
      embedding: { ...asset.embedding }
    }
  },
  fontWeight: asset.weight,
  fontStyle: asset.italic ? 'italic' : 'normal',
  fontStretch: asset.stretch,
  syntheticBold: false,
  syntheticItalic: false
});

export const buildTextPropertyPresentation = (
  source: FlowTextSource,
  selection: TextSelectionRange | null,
  fonts: readonly DocumentFontAsset[],
  insertionStyle?: TextStyleRun,
  insertionParagraph?: ParagraphStyleRun
): TextPropertyPresentation => {
  return {
    target: !selection ? 'layer' : selection.anchor === selection.focus ? 'insertion' : 'selection',
    family: projectFlowTextStyleValue(
      source, selection,
      (style) => style.requestedFont.families[0] ?? style.requestedFont.postScriptName ?? '',
      insertionStyle
    ),
    face: mapValue(projectFlowTextStyleValue(
      source, selection,
      (style) => style.requestedFont.preferredAsset
        ? faceKey(style.requestedFont.preferredAsset) : '',
      insertionStyle
    ), (key) => fonts.find((font) => faceKey(font) === key)?.assetId ?? null),
    size: projectFlowTextStyleProperty(source, selection, 'fontSize', insertionStyle),
    fillEnabled: projectFlowTextStyleValue(
      source, selection, (style) => style.fill !== undefined, insertionStyle
    ),
    fill: mapValue(
      projectFlowTextStyleProperty(source, selection, 'fill', insertionStyle),
      (paint) => paint ? solidTextPaintHex(paint) : '#000000'
    ),
    fillPaint: projectFlowTextStyleProperty(source, selection, 'fill', insertionStyle),
    strokeColor: mapValue(
      projectFlowTextStyleProperty(source, selection, 'stroke', insertionStyle),
      (stroke) => stroke ? solidTextPaintHex(stroke.paint) : '#000000'
    ),
    strokeWidth: projectFlowTextStyleValue(
      source, selection, (style) => style.stroke?.width ?? 0, insertionStyle
    ),
    tracking: projectFlowTextStyleProperty(source, selection, 'tracking', insertionStyle),
    kerning: projectFlowTextStyleProperty(source, selection, 'kerning', insertionStyle),
    baselineShift: projectFlowTextStyleProperty(source, selection, 'baselineShift', insertionStyle),
    horizontalScale: projectFlowTextStyleProperty(source, selection, 'horizontalScale', insertionStyle),
    verticalScale: projectFlowTextStyleProperty(source, selection, 'verticalScale', insertionStyle),
    syntheticBold: projectFlowTextStyleProperty(source, selection, 'syntheticBold', insertionStyle),
    syntheticItalic: projectFlowTextStyleProperty(source, selection, 'syntheticItalic', insertionStyle),
    underline: projectFlowTextStyleValue(
      source, selection, (style) => style.underline ?? false, insertionStyle
    ),
    writingMode: source.layout.mode === 'path'
      ? { kind: 'unavailable' }
      : { kind: 'value', value: source.layout.writingMode },
    alignment: projectFlowTextParagraphProperty(source, selection, 'alignment', insertionParagraph),
    lineHeight: projectFlowTextParagraphProperty(source, selection, 'lineHeight', insertionParagraph),
    firstLineIndent: projectFlowTextParagraphProperty(source, selection, 'firstLineIndent', insertionParagraph),
    startIndent: projectFlowTextParagraphProperty(source, selection, 'startIndent', insertionParagraph),
    endIndent: projectFlowTextParagraphProperty(source, selection, 'endIndent', insertionParagraph),
    spaceBefore: projectFlowTextParagraphProperty(source, selection, 'spaceBefore', insertionParagraph),
    spaceAfter: projectFlowTextParagraphProperty(source, selection, 'spaceAfter', insertionParagraph),
    advancedUnavailableReason:
      'OpenType feature controls and variable axes remain unavailable.'
  };
};
