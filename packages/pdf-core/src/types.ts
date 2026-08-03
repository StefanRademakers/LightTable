/** Parser-independent PDF page semantics. No engine, renderer or host handles belong here. */
export const PDF_DISPLAY_LIST_SCHEMA_VERSION = 1 as const;

export type PdfObjectId = string;
export type PdfMatrix = readonly [number, number, number, number, number, number];
export interface PdfPoint { readonly x: number; readonly y: number }
export interface PdfRect { readonly x: number; readonly y: number; readonly width: number; readonly height: number }

export type PdfBlendMode =
  | 'normal' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten'
  | 'color-dodge' | 'color-burn' | 'hard-light' | 'soft-light' | 'difference'
  | 'exclusion' | 'hue' | 'saturation' | 'color' | 'luminosity' | 'unsupported';

export type PdfPaint =
  | { readonly kind: 'device-gray'; readonly gray: number }
  | { readonly kind: 'device-rgb'; readonly r: number; readonly g: number; readonly b: number }
  | { readonly kind: 'device-cmyk'; readonly c: number; readonly m: number; readonly y: number; readonly k: number }
  | { readonly kind: 'resource'; readonly colorSpaceId: string; readonly components: readonly number[] };

export type PdfPathCommand =
  | { readonly kind: 'move'; readonly point: PdfPoint }
  | { readonly kind: 'line'; readonly point: PdfPoint }
  | { readonly kind: 'cubic'; readonly control1: PdfPoint; readonly control2: PdfPoint; readonly point: PdfPoint }
  | { readonly kind: 'close' };

export interface PdfPathData {
  readonly commands: readonly PdfPathCommand[];
}

export interface PdfStrokeState {
  readonly width: number;
  readonly cap: 'butt' | 'round' | 'square';
  readonly join: 'miter' | 'round' | 'bevel';
  readonly miterLimit: number;
  readonly dash: readonly number[];
  readonly dashPhase: number;
}

export type PdfTextRenderingMode = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface PdfPositionedGlyph {
  /** Original decoded character-code bytes; not interchangeable with Unicode. */
  readonly sourceCode: readonly number[];
  readonly cid?: number;
  readonly glyphId?: number;
  readonly origin: PdfPoint;
  readonly advance: PdfPoint;
  /** Exact glyph-space to page-user-space mapping after PDF text-state evaluation. */
  readonly glyphMatrix: PdfMatrix;
}

export interface PdfPositionedTextRun {
  readonly id: string;
  readonly fontResourceId: string;
  /** Semantic Unicode/ActualText is deliberately stored outside visual glyph data. */
  readonly semanticMappingResourceId: string | null;
  readonly fontSize: number;
  readonly textMatrix: PdfMatrix;
  readonly characterSpacing: number;
  readonly wordSpacing: number;
  readonly horizontalScale: number;
  readonly rise: number;
  readonly renderingMode: PdfTextRenderingMode;
  readonly glyphs: readonly PdfPositionedGlyph[];
}

export type PdfDisplayOperation =
  | { readonly kind: 'save-state'; readonly sourceObjectId?: PdfObjectId }
  | { readonly kind: 'restore-state'; readonly sourceObjectId?: PdfObjectId }
  | { readonly kind: 'concat-transform'; readonly matrix: PdfMatrix; readonly sourceObjectId?: PdfObjectId }
  | { readonly kind: 'set-fill-paint'; readonly paint: PdfPaint }
  | { readonly kind: 'set-stroke-paint'; readonly paint: PdfPaint }
  | { readonly kind: 'set-stroke-state'; readonly stroke: PdfStrokeState }
  | { readonly kind: 'set-blend-mode'; readonly blendMode: PdfBlendMode; readonly sourceName?: string }
  | { readonly kind: 'set-alpha'; readonly fill: number; readonly stroke: number }
  | { readonly kind: 'clip-path'; readonly path: PdfPathData; readonly fillRule: 'nonzero' | 'evenodd' }
  | {
    readonly kind: 'draw-path'; readonly path: PdfPathData;
    readonly paint: 'fill' | 'stroke' | 'fill-stroke'; readonly fillRule: 'nonzero' | 'evenodd';
    readonly sourceObjectId?: PdfObjectId;
  }
  | { readonly kind: 'draw-image'; readonly imageResourceId: string; readonly matrix: PdfMatrix; readonly sourceObjectId?: PdfObjectId }
  | { readonly kind: 'draw-text'; readonly runs: readonly PdfPositionedTextRun[]; readonly sourceObjectId?: PdfObjectId }
  | { readonly kind: 'begin-transparency-group'; readonly groupResourceId: string; readonly matrix: PdfMatrix }
  | { readonly kind: 'end-transparency-group'; readonly groupResourceId: string }
  | { readonly kind: 'apply-soft-mask'; readonly softMaskResourceId: string | null }
  | { readonly kind: 'begin-marked-content'; readonly tag: string; readonly propertiesObjectId?: PdfObjectId; readonly actualText?: string }
  | { readonly kind: 'end-marked-content' }
  | { readonly kind: 'preserved-unsupported'; readonly operator: string; readonly sourceObjectId?: PdfObjectId; readonly reason: string };

export interface PdfFontResource {
  readonly id: string;
  readonly sourceObjectId: PdfObjectId;
  readonly subtype: 'type1' | 'truetype' | 'type0-cid' | 'type3' | 'cff' | 'opentype' | 'unknown';
  readonly baseName: string | null;
  readonly subsetTag: string | null;
  readonly fontProgramResourceId: string | null;
  readonly encodingName: string | null;
  readonly toUnicode: 'present' | 'absent' | 'malformed';
  readonly authoring: 'exact-positioned-only' | 'recoverable' | 'outline-only' | 'visual-only';
  readonly embedding: 'embedded' | 'not-embedded' | 'restricted' | 'unknown';
}

export interface PdfFontProgramResource {
  readonly id: string;
  readonly assetId: string;
  readonly byteLength: number;
  readonly fingerprintSha256: string;
  readonly format: 'type1' | 'cff' | 'truetype' | 'opentype' | 'type3-programs' | 'unknown';
  /** Substitution bytes may render a preview but are never imported as authored bytes. */
  readonly source: 'embedded' | 'substitution';
}

export interface PdfTextSemanticSpan {
  readonly glyphStart: number;
  readonly glyphEnd: number;
  readonly unicode: string;
  readonly provenance: 'to-unicode' | 'actual-text' | 'heuristic';
  readonly confidence: number;
}

export interface PdfTextSemanticMappingResource {
  readonly id: string;
  readonly positionedRunId: string;
  readonly spans: readonly PdfTextSemanticSpan[];
  readonly extractedText: string;
  readonly logicalOrderConfidence: number;
}

export interface PdfImageResource {
  readonly id: string;
  readonly sourceObjectId: PdfObjectId;
  readonly assetId: string;
  readonly width: number;
  readonly height: number;
  readonly bitsPerComponent: number;
  readonly colorSpaceId: string | null;
  readonly softMaskResourceId: string | null;
}

export interface PdfColorSpaceResource {
  readonly id: string;
  readonly sourceObjectId: PdfObjectId | null;
  readonly kind: 'device-gray' | 'device-rgb' | 'device-cmyk' | 'cal-gray' | 'cal-rgb' | 'lab' | 'icc' | 'indexed' | 'separation' | 'device-n' | 'unknown';
  readonly componentCount: number;
  readonly iccProfileAssetId: string | null;
  /** Parser-owned payload retained for a later exact converter, never an engine handle. */
  readonly preservedDefinition: string | null;
}

export interface PdfTransparencyGroupResource {
  readonly id: string;
  readonly sourceObjectId: PdfObjectId;
  readonly isolated: boolean;
  readonly knockout: boolean;
  readonly colorSpaceId: string | null;
  readonly bounds: PdfRect;
}

export interface PdfSoftMaskResource {
  readonly id: string;
  readonly sourceObjectId: PdfObjectId;
  readonly subtype: 'alpha' | 'luminosity';
  readonly groupResourceId: string;
  readonly backdrop: readonly number[] | null;
  readonly transferFunction: 'identity' | 'preserved-unsupported';
}

export interface PdfPageDisplayList {
  readonly pageIndex: number;
  readonly sourceObjectId: PdfObjectId;
  readonly mediaBox: PdfRect;
  readonly cropBox: PdfRect;
  readonly rotation: 0 | 90 | 180 | 270;
  readonly userUnit: number;
  readonly operations: readonly PdfDisplayOperation[];
}

export interface PdfNormalizedDisplayList {
  readonly schemaVersion: typeof PDF_DISPLAY_LIST_SCHEMA_VERSION;
  readonly source: {
    readonly format: 'pdf' | 'pdf-compatible-ai';
    readonly originalAssetId: string;
    readonly byteLength: number;
    readonly fingerprintSha256: string;
    readonly pdfVersion: string | null;
    readonly nativeAiData: 'absent' | 'preserved-unsupported';
  };
  readonly pages: readonly PdfPageDisplayList[];
  readonly resources: {
    readonly fonts: readonly PdfFontResource[];
    readonly fontPrograms: readonly PdfFontProgramResource[];
    readonly semanticMappings: readonly PdfTextSemanticMappingResource[];
    readonly images: readonly PdfImageResource[];
    readonly colorSpaces: readonly PdfColorSpaceResource[];
    readonly transparencyGroups: readonly PdfTransparencyGroupResource[];
    readonly softMasks: readonly PdfSoftMaskResource[];
  };
  readonly preserved: {
    readonly catalogObjectId: PdfObjectId | null;
    readonly metadataAssetId: string | null;
    readonly unsupportedFeatures: readonly string[];
  };
}
