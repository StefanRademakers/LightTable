export const TEXT_DOCUMENT_SCHEMA_VERSION = 1 as const;
export const TEXT_LAYOUT_SCHEMA_VERSION = 2 as const;
export const TEXT_WORKER_PROTOCOL_VERSION = 4 as const;

export type Matrix3 = readonly [
  number, number, number,
  number, number, number,
  number, number, number
];

export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface RgbaColor {
  readonly colorSpace: 'srgb' | 'display-p3';
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

export interface SolidTextPaint {
  readonly kind: 'solid';
  readonly color: RgbaColor;
}

export interface TextGradientStop {
  readonly offset: number;
  readonly color: RgbaColor;
}

export interface LinearTextPaint {
  readonly kind: 'linear-gradient';
  readonly start: Vec2;
  readonly end: Vec2;
  readonly stops: readonly TextGradientStop[];
}

export type TextPaint = SolidTextPaint | LinearTextPaint;

export interface TextStroke {
  readonly paint: TextPaint;
  readonly width: number;
  readonly cap: 'butt' | 'round' | 'square';
  readonly join: 'miter' | 'round' | 'bevel';
  readonly miterLimit: number;
}

export interface TextRunPaint {
  readonly fill?: TextPaint;
  readonly stroke?: TextStroke;
}

export interface FontAssetRef {
  readonly assetId: string;
  readonly faceIndex: number;
  readonly fingerprintSha256: string;
  readonly source: 'bundled' | 'document' | 'system' | 'imported' | 'pdf-subset';
  readonly container: 'sfnt' | 'woff' | 'woff2' | 'raw-cff' | 'unknown';
  readonly outline: 'truetype' | 'cff' | 'cff2' | 'svg' | 'bitmap' | 'mixed' | 'unknown';
  readonly postScriptName?: string;
  readonly embedding: {
    readonly level: 'installable' | 'editable' | 'preview-print' | 'restricted' | 'unknown';
    readonly noSubsetting: boolean;
    readonly bitmapOnly: boolean;
  };
}

export interface FontInstance {
  readonly font: FontAssetRef;
  readonly variableAxes: Readonly<Record<string, number>>;
  readonly syntheticBold: boolean;
  readonly syntheticItalic: boolean;
}

export interface RequestedFont {
  readonly families: readonly string[];
  readonly postScriptName?: string;
  readonly preferredAsset?: FontAssetRef;
}

export interface TextStyleRun {
  readonly start: number;
  readonly end: number;
  readonly requestedFont: RequestedFont;
  readonly fontSize: number;
  readonly fontWeight: number;
  readonly fontStyle: 'normal' | 'italic' | 'oblique';
  readonly fontStretch: number;
  readonly fill: TextPaint;
  readonly stroke?: TextStroke;
  readonly tracking: number;
  readonly kerning: 'auto' | 'metrics' | 'optical' | 'none';
  readonly baselineShift: number;
  readonly horizontalScale: number;
  readonly verticalScale: number;
  readonly language?: string;
  readonly scriptOverride?: string;
  readonly directionOverride?: 'ltr' | 'rtl';
  readonly openTypeFeatures: Readonly<Record<string, boolean | number>>;
  readonly variableAxes: Readonly<Record<string, number>>;
  readonly syntheticBold: boolean;
  readonly syntheticItalic: boolean;
}

export interface ParagraphStyleRun {
  readonly start: number;
  readonly end: number;
  readonly alignment: 'start' | 'center' | 'end' | 'justify';
  readonly direction: 'auto' | 'ltr' | 'rtl';
  readonly lineHeight: { readonly kind: 'normal' } | { readonly kind: 'absolute'; readonly value: number } | { readonly kind: 'multiple'; readonly value: number };
  readonly firstLineIndent: number;
  readonly startIndent: number;
  readonly endIndent: number;
  readonly spaceBefore: number;
  readonly spaceAfter: number;
  readonly hyphenation: 'off' | 'auto';
}

export interface PointTextLayout {
  readonly mode: 'point';
  readonly origin: Vec2;
  readonly writingMode: 'horizontal-tb' | 'vertical-rl' | 'vertical-lr';
}

export interface ParagraphTextLayout {
  readonly mode: 'paragraph';
  readonly frame: Rect;
  readonly overflow: 'visible' | 'clip' | 'indicator';
  readonly writingMode: 'horizontal-tb' | 'vertical-rl' | 'vertical-lr';
}

export interface PathTextLayout {
  readonly mode: 'path';
  readonly pathLayerId: string;
  readonly startOffset: number;
  readonly side: 'left' | 'right';
  readonly upright: boolean;
}

export type FlowTextLayout = PointTextLayout | ParagraphTextLayout | PathTextLayout;

export interface FlowTextSource {
  readonly kind: 'flow';
  readonly text: string;
  readonly styleRuns: readonly TextStyleRun[];
  readonly paragraphRuns: readonly ParagraphStyleRun[];
  readonly layout: FlowTextLayout;
}

export interface PositionedSourceGlyph {
  readonly glyphId: number;
  readonly cluster?: number;
  readonly unicode?: string;
  readonly sourceCharacterCode?: {
    readonly value: number;
    readonly byteLength: number;
  };
  readonly x: number;
  readonly y: number;
  readonly advanceX: number;
  readonly advanceY: number;
  readonly localTransform?: Matrix3;
}

export type TextRenderingMode =
  | 'fill' | 'stroke' | 'fill-stroke' | 'invisible'
  | 'fill-clip' | 'stroke-clip' | 'fill-stroke-clip' | 'clip';

export interface PositionedTextRun {
  readonly font: FontInstance;
  readonly glyphs: readonly PositionedSourceGlyph[];
  readonly textMatrix: Matrix3;
  readonly paint: TextRunPaint;
  readonly renderingMode: TextRenderingMode;
  readonly sourceEncoding?: {
    readonly kind: 'pdf' | 'postscript' | 'other';
    readonly name?: string;
  };
}

export interface PositionedTextSource {
  readonly kind: 'positioned';
  readonly runs: readonly PositionedTextRun[];
  readonly extractedText?: string;
  readonly logicalOrderConfidence?: number;
  readonly editability: 'exact-positioned' | 'recoverable' | 'outline-only';
}

export type TextSource = FlowTextSource | PositionedTextSource;

export interface TextLayerRevisions {
  readonly content: number;
  readonly style: number;
  readonly layout: number;
  readonly path: number;
  readonly geometry: number;
}

export interface TextLayerData {
  readonly schemaVersion: typeof TEXT_DOCUMENT_SCHEMA_VERSION;
  readonly source: TextSource;
  readonly revisions: TextLayerRevisions;
  readonly interchange?: {
    readonly format: 'pdf' | 'ai' | 'psd' | 'svg';
    readonly sourceObjectId?: string;
    readonly preservedFields?: Readonly<Record<string, string | number | boolean | null>>;
  };
}

/**
 * App integration composes the frozen text payload with its canonical common
 * layer type. Slice 03 supplies the concrete base without duplicating it here.
 */
export type TextLayer<TBase extends { readonly type: string }> =
  Omit<TBase, 'type'> & { readonly type: 'text'; readonly text: TextLayerData };

export type FontResolutionProvenance =
  | { readonly kind: 'flow-exact'; readonly sourceRunIndex: number; readonly requested: RequestedFont }
  | {
    readonly kind: 'flow-substituted';
    readonly sourceRunIndex: number;
    readonly requested: RequestedFont;
    readonly reason: 'asset-missing' | 'glyph-fallback' | 'unsupported-variation' | 'policy';
  }
  | { readonly kind: 'positioned-exact'; readonly sourceRunIndex: number }
  | {
    readonly kind: 'positioned-substituted';
    readonly sourceRunIndex: number;
    readonly reason: 'asset-missing' | 'glyph-fallback' | 'embedding-restricted' | 'unsupported-format';
  };

export interface RealizedGlyphRun {
  readonly font: FontInstance;
  /** Authored layer-local size used to derive hinted raster scale buckets. */
  readonly fontSize: number;
  readonly fontResolution: FontResolutionProvenance;
  readonly paint: TextRunPaint;
  readonly renderingMode: TextRenderingMode;
  readonly direction: 'ltr' | 'rtl' | 'ttb' | 'btt';
  readonly language?: string;
  readonly script?: string;
  readonly glyphIds: Uint32Array;
  readonly clusters: Uint32Array;
  /** x, y, advanceX and advanceY per glyph, in layer-local document units. */
  readonly geometry: Float32Array;
  /** Optional row-major 3x3 transform per glyph. */
  readonly transforms?: Float32Array;
}

export interface TextLineMetrics {
  readonly start: number;
  readonly end: number;
  readonly baseline: number;
  readonly ascent: number;
  readonly descent: number;
  readonly bounds: Rect;
}

export interface CaretStop {
  readonly textOffset: number;
  readonly x: number;
  readonly y: number;
  readonly height: number;
  readonly affinity: 'upstream' | 'downstream';
}

export interface SelectionGeometryEntry {
  readonly start: number;
  readonly end: number;
  readonly bounds: Rect;
}

export interface GlyphClusterMapEntry {
  readonly textStart: number;
  readonly textEnd: number;
  readonly glyphStart: number;
  readonly glyphEnd: number;
}

export type TextLayoutWarningCode = 'font-substituted' | 'missing-glyph' | 'unsupported-feature' | 'logical-order-uncertain';

export interface TextLayoutWarning {
  readonly code: TextLayoutWarningCode;
  readonly message: string;
  readonly runIndex?: number;
}

export interface RealizedTextLayout {
  readonly schemaVersion: typeof TEXT_LAYOUT_SCHEMA_VERSION;
  readonly key: string;
  readonly glyphRuns: readonly RealizedGlyphRun[];
  readonly lines: readonly TextLineMetrics[];
  readonly caretStops: readonly CaretStop[];
  readonly selectionGeometry: readonly SelectionGeometryEntry[];
  readonly clusterMap: readonly GlyphClusterMapEntry[];
  readonly inkBounds: Rect;
  readonly logicalBounds: Rect;
  readonly warnings: readonly TextLayoutWarning[];
}

export type TextCapabilityUnavailableReason = 'wasm-unavailable' | 'worker-unavailable' | 'font-access-unavailable' | 'unsupported-platform';

export type TextCapabilityState =
  | { readonly available: true; readonly engineVersion: string; readonly protocolVersion: typeof TEXT_WORKER_PROTOCOL_VERSION }
  | { readonly available: false; readonly reason: TextCapabilityUnavailableReason; readonly message: string };

export type TextLayoutErrorCode = 'malformed-input' | 'schema-mismatch' | 'font-missing' | 'font-restricted' | 'unsupported-feature' | 'resource-limit' | 'cancelled' | 'engine-unavailable' | 'internal-error';
export type TextLayoutFallback = 'none' | 'preserve-last-realized-layout' | 'diagnostic-placeholder';

export interface TextLayoutError {
  readonly code: TextLayoutErrorCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly fallback: TextLayoutFallback;
  readonly details?: Readonly<Record<string, string | number | boolean | null>>;
}
