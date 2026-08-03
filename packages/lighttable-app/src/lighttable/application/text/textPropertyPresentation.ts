import type { FlowTextSource, ParagraphStyleRun, TextStyleRun } from '@lighttable/text-core';
import type { DocumentFontAsset } from '../../editor/document/documentTypes';
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
  readonly fill: MixedValue<string>;
  readonly tracking: MixedValue<number>;
  readonly alignment: MixedValue<ParagraphStyleRun['alignment']>;
  readonly lineHeight: MixedValue<ParagraphStyleRun['lineHeight']>;
  readonly firstLineIndent: MixedValue<number>;
  readonly startIndent: MixedValue<number>;
  readonly endIndent: MixedValue<number>;
  readonly spaceBefore: MixedValue<number>;
  readonly spaceAfter: MixedValue<number>;
  readonly advancedUnavailableReason: string;
}

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

export const solidTextPaintHex = (paint: TextStyleRun['fill']) => paint.kind === 'solid'
  && paint.color.colorSpace === 'srgb'
  ? `#${byteHex(paint.color.r)}${byteHex(paint.color.g)}${byteHex(paint.color.b)}`
  : null;

export const textFillPatchFromHex = (value: string): TextStylePatch | null => {
  const match = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(value);
  if (!match) return null;
  return { fill: { kind: 'solid', color: {
    colorSpace: 'srgb',
    r: Number.parseInt(match[1]!, 16) / 255,
    g: Number.parseInt(match[2]!, 16) / 255,
    b: Number.parseInt(match[3]!, 16) / 255,
    a: 1
  } } };
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
    fill: mapValue(
      projectFlowTextStyleProperty(source, selection, 'fill', insertionStyle),
      solidTextPaintHex
    ),
    tracking: projectFlowTextStyleProperty(source, selection, 'tracking', insertionStyle),
    alignment: projectFlowTextParagraphProperty(source, selection, 'alignment', insertionParagraph),
    lineHeight: projectFlowTextParagraphProperty(source, selection, 'lineHeight', insertionParagraph),
    firstLineIndent: projectFlowTextParagraphProperty(source, selection, 'firstLineIndent', insertionParagraph),
    startIndent: projectFlowTextParagraphProperty(source, selection, 'startIndent', insertionParagraph),
    endIndent: projectFlowTextParagraphProperty(source, selection, 'endIndent', insertionParagraph),
    spaceBefore: projectFlowTextParagraphProperty(source, selection, 'spaceBefore', insertionParagraph),
    spaceAfter: projectFlowTextParagraphProperty(source, selection, 'spaceAfter', insertionParagraph),
    advancedUnavailableReason:
      'Baseline shift, faux styles, OpenType features and variable axes remain disabled until layout and glyph rasterization support the same setting.'
  };
};
