/**
 * Minimal renderer input shared by the current WebGPU backend and renderer
 * experiments. This is derived data: source formats and LightTable documents
 * remain the serialization authority.
 */
export const PAINT_SCENE_SCHEMA_VERSION = 2 as const;

export type PaintSceneMatrix = readonly [number, number, number, number, number, number];
/** Unpremultiplied linear-sRGB RGBA, matching LightTable's compositor space. */
export type PaintSceneColor = readonly [number, number, number, number];

export interface PaintSceneGradientStop {
  readonly offset: number;
  readonly color: PaintSceneColor;
}

/**
 * Backend-neutral gradient geometry. `transform` maps the normalized gradient
 * coordinate system into scene/document space; source-format coordinate
 * systems have already been resolved by the adapter.
 */
export interface PaintSceneGradientPaint {
  readonly kind: 'gradient';
  readonly shape: 'linear' | 'radial' | 'angle' | 'reflected' | 'diamond';
  readonly transform: PaintSceneMatrix;
  readonly spread: 'pad' | 'reflect' | 'repeat';
  readonly dither: boolean;
  readonly stops: readonly PaintSceneGradientStop[];
}

export type PaintScenePaint =
  | { readonly kind: 'solid'; readonly color: PaintSceneColor }
  | PaintSceneGradientPaint;

export type PaintScenePathCommand =
  | { readonly kind: 'move'; readonly x: number; readonly y: number }
  | { readonly kind: 'line'; readonly x: number; readonly y: number }
  | {
    readonly kind: 'cubic';
    readonly control1X: number;
    readonly control1Y: number;
    readonly control2X: number;
    readonly control2Y: number;
    readonly x: number;
    readonly y: number;
  }
  | { readonly kind: 'close' };

export interface PaintSceneStroke {
  readonly width: number;
  readonly cap: 'butt' | 'round' | 'square';
  readonly join: 'miter' | 'round' | 'bevel';
  readonly miterLimit: number;
  readonly dash: readonly number[];
  readonly dashOffset: number;
}

interface PaintScenePathBase {
  readonly pathId: string;
  readonly transform: PaintSceneMatrix;
}

export type PaintSceneCommand =
  | (PaintScenePathBase & {
    readonly kind: 'fill-path';
    readonly fillRule: 'nonzero' | 'evenodd';
    readonly paint: PaintScenePaint;
  })
  | (PaintScenePathBase & {
    readonly kind: 'stroke-path';
    readonly paint: PaintScenePaint;
    readonly stroke: PaintSceneStroke;
  });

/** A cacheable unit. revisionKey changes iff its rendered result changes. */
export interface PaintSceneFragment {
  readonly stableId: string;
  readonly revisionKey: string;
  readonly paths: readonly PaintScenePath[];
  readonly commands: readonly PaintSceneCommand[];
}

/** Geometry revision is independent from paint/transform revisions. */
export interface PaintScenePath {
  readonly stableId: string;
  readonly revisionKey: string;
  readonly commands: readonly PaintScenePathCommand[];
}

export interface PaintScene {
  readonly schemaVersion: typeof PAINT_SCENE_SCHEMA_VERSION;
  readonly sourceId: string;
  readonly sourceRevision: string;
  readonly fragments: readonly PaintSceneFragment[];
}

export type PaintSceneCapabilityFallback = 'current-backend' | 'rasterize' | 'preserve-only';

export interface PaintSceneCapabilityIssue {
  readonly stableId: string;
  readonly feature: string;
  readonly reason: string;
  readonly fallback: PaintSceneCapabilityFallback;
}

export interface PaintSceneCompileResult {
  /** Partial always means issues explain every omitted or reduced feature. */
  readonly status: 'ready' | 'partial' | 'unsupported';
  readonly scene: PaintScene;
  readonly issues: readonly PaintSceneCapabilityIssue[];
}
