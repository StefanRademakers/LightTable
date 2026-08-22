import type { AffineMatrix, VectorElement } from '@lighttable/vector-core';

export interface SvgCodecLimits {
  readonly maxInputBytes: number;
  readonly maxOutputBytes: number;
  readonly maxElements: number;
  readonly maxDepth: number;
  readonly maxAttributesPerElement: number;
  readonly maxPathDataBytes: number;
  readonly maxSubpaths: number;
  readonly maxAnchors: number;
}

export const DEFAULT_SVG_CODEC_LIMITS: SvgCodecLimits = Object.freeze({
  maxInputBytes: 16_777_216,
  maxOutputBytes: 16_777_216,
  maxElements: 32_768,
  maxDepth: 32,
  maxAttributesPerElement: 128,
  maxPathDataBytes: 8_388_608,
  maxSubpaths: 4_096,
  maxAnchors: 262_144
});

export interface SvgConversionNotice {
  readonly code: string;
  readonly element: string;
  readonly message: string;
}

export interface SvgConversionReport {
  readonly warnings: readonly SvgConversionNotice[];
  readonly conversions: readonly SvgConversionNotice[];
}

export interface SvgViewBox {
  readonly minX: number;
  readonly minY: number;
  readonly width: number;
  readonly height: number;
}

export interface SvgImportPlan {
  readonly width: number;
  readonly height: number;
  readonly viewBox: SvgViewBox;
  readonly elements: readonly VectorElement[];
  /** Ordered paint tree; `elements` remains its compatibility flat projection. */
  readonly nodes: readonly SvgSceneNode[];
  readonly sourceElementCount: number;
  readonly report: SvgConversionReport;
}

export type SvgSceneNode =
  | { readonly kind: 'element'; readonly element: VectorElement }
  | {
    readonly kind: 'group';
    readonly name: string;
    readonly opacity: number;
    readonly transform: AffineMatrix;
    readonly children: readonly SvgSceneNode[];
  };

export interface SvgImportOptions {
  readonly limits?: Partial<SvgCodecLimits>;
  readonly createId?: (kind: 'element' | 'subpath' | 'anchor') => string;
}

export interface SvgExportOptions {
  readonly width: number;
  readonly height: number;
  readonly title?: string;
  readonly limits?: Partial<SvgCodecLimits>;
}

export class SvgCodecError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'SvgCodecError';
    this.code = code;
  }
}
