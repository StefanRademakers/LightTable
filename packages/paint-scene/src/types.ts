/**
 * Minimal renderer input shared by the current WebGPU backend and renderer
 * experiments. This is derived data: source formats and LightTable documents
 * remain the serialization authority.
 */
export const PAINT_SCENE_SCHEMA_VERSION = 5 as const;

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
  /** Focal point in normalized radial space; only valid for radial paint. */
  readonly radialFocus?: readonly [number, number];
  readonly radialStartRadius?: number;
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

export type PaintSceneDrawCommand =
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

export type PaintSceneCommand = PaintSceneDrawCommand
  | (PaintScenePathBase & {
    readonly kind: 'push-clip';
    readonly fillRule: 'nonzero' | 'evenodd';
  })
  | { readonly kind: 'pop-clip' };

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

/**
 * A cacheable clipping resource. Source-format coordinate systems and child
 * transforms are resolved by the adapter before this renderer boundary.
 * Compound contours live in `path`, so a clip remains one atomic mask.
 */
export interface PaintSceneClip {
  readonly stableId: string;
  readonly revisionKey: string;
  readonly path: PaintScenePath;
  readonly transform: PaintSceneMatrix;
  readonly fillRule: 'nonzero' | 'evenodd';
}

/**
 * Renderer-neutral scene composition. Leaves retain independent fragment
 * revisions; clip nodes therefore do not force their descendants into one
 * monolithic upload/cache entry. A retained fragment may intentionally be
 * absent from composition while hidden, without being removed from the scene.
 */
export type PaintSceneCompositionNode =
  | { readonly kind: 'fragment'; readonly stableId: string }
  | {
    /** Isolated source-over group; opacity is applied after its children combine. */
    readonly kind: 'opacity-group';
    readonly opacity: number;
    readonly children: readonly PaintSceneCompositionNode[];
  }
  | {
    readonly kind: 'clip';
    readonly stableId: string;
    readonly children: readonly PaintSceneCompositionNode[];
  };

export interface PaintScene {
  readonly schemaVersion: typeof PAINT_SCENE_SCHEMA_VERSION;
  readonly sourceId: string;
  readonly sourceRevision: string;
  readonly fragments: readonly PaintSceneFragment[];
  readonly clips: readonly PaintSceneClip[];
  readonly composition: readonly PaintSceneCompositionNode[];
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
