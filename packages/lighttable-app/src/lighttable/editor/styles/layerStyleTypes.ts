import type { BlendMode } from '../document/blendModes';
import type {
  DisplaySrgbColor,
  GradientAsset,
  GradientColorStop,
  GradientOpacityStop
} from '@lighttable/paint-core';

export type LayerStyleId = string & { readonly __brand: 'LayerStyleId' };

export type LayerStyleKind =
  | 'drop-shadow'
  | 'inner-shadow'
  | 'outer-glow'
  | 'inner-glow'
  | 'bevel-emboss'
  | 'color-overlay'
  | 'gradient-overlay'
  | 'pattern-overlay'
  | 'satin'
  | 'stroke';

export type LayerStyleColor = DisplaySrgbColor;

export interface LayerStyleContourPoint {
  position: number;
  value: number;
}

export interface LayerStyleContour {
  points: LayerStyleContourPoint[];
}

export type LayerStyleGradientStop = GradientColorStop;
export type LayerStyleOpacityStop = GradientOpacityStop;
export type LayerStyleGradient = GradientAsset;

export interface LayerStylePatternReference {
  id: string;
  name: string;
  /** Optional native LightTable asset. PSD imports may preserve only the id. */
  assetId: string | null;
}

interface CommonLayerStyle {
  id: LayerStyleId;
  kind: LayerStyleKind;
  name: string;
  enabled: boolean;
  blendMode: BlendMode;
  opacity: number;
}

interface DirectionalLayerStyle {
  useGlobalLight: boolean;
  angle: number;
  distance: number;
}

interface QualityLayerStyle {
  contour: LayerStyleContour;
  antiAlias: boolean;
  noise: number;
}

export interface DropShadowStyle extends CommonLayerStyle, DirectionalLayerStyle, QualityLayerStyle {
  kind: 'drop-shadow';
  color: LayerStyleColor;
  spread: number;
  size: number;
  layerKnocksOut: boolean;
}

export interface InnerShadowStyle extends CommonLayerStyle, DirectionalLayerStyle, QualityLayerStyle {
  kind: 'inner-shadow';
  color: LayerStyleColor;
  choke: number;
  size: number;
}

interface GlowLayerStyle extends CommonLayerStyle, QualityLayerStyle {
  color: LayerStyleColor;
  gradient: LayerStyleGradient | null;
  technique: 'softer' | 'precise';
  choke: number;
  size: number;
  range: number;
  jitter: number;
}

export interface OuterGlowStyle extends GlowLayerStyle {
  kind: 'outer-glow';
}

export interface InnerGlowStyle extends GlowLayerStyle {
  kind: 'inner-glow';
  source: 'edge' | 'center';
}

export interface BevelEmbossStyle extends CommonLayerStyle, QualityLayerStyle {
  kind: 'bevel-emboss';
  style: 'outer-bevel' | 'inner-bevel' | 'emboss' | 'pillow-emboss' | 'stroke-emboss';
  technique: 'smooth' | 'chisel-hard' | 'chisel-soft';
  depth: number;
  direction: 'up' | 'down';
  size: number;
  soften: number;
  useGlobalLight: boolean;
  angle: number;
  altitude: number;
  highlightMode: BlendMode;
  highlightColor: LayerStyleColor;
  highlightOpacity: number;
  shadowMode: BlendMode;
  shadowColor: LayerStyleColor;
  shadowOpacity: number;
  texture: {
    enabled: boolean;
    pattern: LayerStylePatternReference | null;
    scale: number;
    depth: number;
    invert: boolean;
    linkWithLayer: boolean;
  };
}

export interface ColorOverlayStyle extends CommonLayerStyle {
  kind: 'color-overlay';
  color: LayerStyleColor;
}

export interface GradientOverlayStyle extends CommonLayerStyle {
  kind: 'gradient-overlay';
  gradient: LayerStyleGradient;
  dither: boolean;
  reverse: boolean;
  style: 'linear' | 'radial' | 'angle' | 'reflected' | 'diamond';
  alignWithLayer: boolean;
  angle: number;
  scale: number;
  offsetX: number;
  offsetY: number;
  method: 'perceptual' | 'linear' | 'classic' | 'smooth';
}

export interface PatternOverlayStyle extends CommonLayerStyle {
  kind: 'pattern-overlay';
  pattern: LayerStylePatternReference | null;
  angle: number;
  scale: number;
  linkWithLayer: boolean;
  offsetX: number;
  offsetY: number;
}

export interface SatinStyle extends CommonLayerStyle, DirectionalLayerStyle {
  kind: 'satin';
  color: LayerStyleColor;
  size: number;
  contour: LayerStyleContour;
  antiAlias: boolean;
  invert: boolean;
}

export type LayerStyleFill =
  | { type: 'color'; color: LayerStyleColor }
  | {
      type: 'gradient';
      gradient: LayerStyleGradient;
      dither: boolean;
      reverse: boolean;
      style: 'linear' | 'radial' | 'angle' | 'reflected' | 'diamond';
      alignWithLayer: boolean;
      angle: number;
      scale: number;
      offsetX: number;
      offsetY: number;
      method: 'perceptual' | 'linear' | 'classic' | 'smooth';
    }
  | { type: 'pattern'; pattern: LayerStylePatternReference | null; scale: number; angle: number };

export interface StrokeStyle extends CommonLayerStyle {
  kind: 'stroke';
  size: number;
  position: 'inside' | 'center' | 'outside';
  overprint: boolean;
  fill: LayerStyleFill;
}

export type LayerStyleInstance =
  | DropShadowStyle
  | InnerShadowStyle
  | OuterGlowStyle
  | InnerGlowStyle
  | BevelEmbossStyle
  | ColorOverlayStyle
  | GradientOverlayStyle
  | PatternOverlayStyle
  | SatinStyle
  | StrokeStyle;

export interface LayerStyleStack {
  enabled: boolean;
  scale: number;
  globalLight: {
    angle: number;
    altitude: number;
  };
  /** Rendering order, bottom-most style first. Same-kind entries are allowed. */
  effects: LayerStyleInstance[];
  revision: number;
}
