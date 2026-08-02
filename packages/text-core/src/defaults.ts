import {
  TEXT_DOCUMENT_SCHEMA_VERSION,
  type FlowTextSource,
  type FontAssetRef,
  type FontInstance,
  type PositionedTextSource,
  type RgbaColor,
  type TextLayerData,
  type TextLayoutError,
  type TextLayoutFallback
} from './types';
import { assertTextLayerData } from './validation';

export const IDENTITY_MATRIX_3 = [1, 0, 0, 0, 1, 0, 0, 0, 1] as const;

export const DEFAULT_TEXT_COLOR: RgbaColor = {
  colorSpace: 'srgb',
  r: 0,
  g: 0,
  b: 0,
  a: 1
};

export const CONTRACT_FIXTURE_FONT_ASSET: FontAssetRef = {
  assetId: 'contract-fixture-font',
  faceIndex: 0,
  fingerprintSha256: 'bf5e8ffa51a9e748985800c1d3d7f1a2a6ae7435136593ca8d9637e3f87c699c',
  source: 'document',
  container: 'sfnt',
  outline: 'unknown',
  postScriptName: 'ContractFixtureFont',
  embedding: { level: 'unknown', noSubsetting: false, bitmapOnly: false }
};

export const CONTRACT_FIXTURE_FONT_INSTANCE: FontInstance = {
  font: CONTRACT_FIXTURE_FONT_ASSET,
  variableAxes: {},
  syntheticBold: false,
  syntheticItalic: false
};

export const createDefaultFlowTextSource = (text = 'Text'): FlowTextSource => ({
  kind: 'flow',
  text,
  styleRuns: text.length === 0 ? [] : [{
    start: 0,
    end: text.length,
    requestedFont: { families: ['Inter', 'sans-serif'] },
    fontSize: 16,
    fontWeight: 400,
    fontStyle: 'normal',
    fontStretch: 100,
    fill: { kind: 'solid', color: DEFAULT_TEXT_COLOR },
    tracking: 0,
    kerning: 'auto',
    baselineShift: 0,
    horizontalScale: 100,
    verticalScale: 100,
    openTypeFeatures: {},
    variableAxes: {},
    syntheticBold: false,
    syntheticItalic: false
  }],
  paragraphRuns: text.length === 0 ? [] : [{
    start: 0,
    end: text.length,
    alignment: 'start',
    direction: 'auto',
    lineHeight: { kind: 'normal' },
    firstLineIndent: 0,
    startIndent: 0,
    endIndent: 0,
    spaceBefore: 0,
    spaceAfter: 0,
    hyphenation: 'off'
  }],
  layout: {
    mode: 'point',
    origin: { x: 0, y: 0 },
    writingMode: 'horizontal-tb'
  }
});

export const createDefaultTextLayerData = (): TextLayerData => ({
  schemaVersion: TEXT_DOCUMENT_SCHEMA_VERSION,
  source: createDefaultFlowTextSource(),
  revisions: { content: 0, style: 0, layout: 0, path: 0, geometry: 0 }
});

export const createPositionedTextFixture = (): TextLayerData => {
  const source: PositionedTextSource = {
    kind: 'positioned',
    runs: [{
      font: CONTRACT_FIXTURE_FONT_INSTANCE,
      glyphs: [{ glyphId: 36, cluster: 0, unicode: 'A', x: 0, y: 0, advanceX: 11, advanceY: 0 }],
      textMatrix: IDENTITY_MATRIX_3,
      paint: { fill: { kind: 'solid', color: DEFAULT_TEXT_COLOR } },
      renderingMode: 'fill',
      sourceEncoding: { kind: 'pdf', name: 'Identity-H' }
    }],
    extractedText: 'A',
    logicalOrderConfidence: 1,
    editability: 'exact-positioned'
  };
  return { ...createDefaultTextLayerData(), source };
};

export const TEXT_CONTRACT_FIXTURES = Object.freeze([
  createDefaultTextLayerData(),
  createPositionedTextFixture()
]);

export const TEXT_CONTRACT_FIXTURE_COUNT = TEXT_CONTRACT_FIXTURES.length;

export const cloneTextLayerData = (layer: TextLayerData): TextLayerData => {
  assertTextLayerData(layer);
  return JSON.parse(JSON.stringify(layer)) as TextLayerData;
};

export const selectTextLayoutFallback = (
  error: Pick<TextLayoutError, 'code'>,
  hasLastRealizedLayout: boolean
): TextLayoutFallback => {
  if (error.code === 'cancelled') return hasLastRealizedLayout ? 'preserve-last-realized-layout' : 'none';
  if (error.code === 'engine-unavailable' || error.code === 'internal-error' || error.code === 'resource-limit') {
    return hasLastRealizedLayout ? 'preserve-last-realized-layout' : 'diagnostic-placeholder';
  }
  return 'diagnostic-placeholder';
};

export const createTextLayoutError = (
  code: TextLayoutError['code'],
  message: string,
  hasLastRealizedLayout = false
): TextLayoutError => ({
  code,
  message,
  retryable: code === 'engine-unavailable' || code === 'internal-error' || code === 'resource-limit',
  fallback: selectTextLayoutFallback({ code }, hasLastRealizedLayout)
});
