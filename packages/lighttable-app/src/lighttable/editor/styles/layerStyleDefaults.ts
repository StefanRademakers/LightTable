import type { BlendMode } from '../document/blendModes';
import type {
  BevelEmbossStyle,
  ColorOverlayStyle,
  DropShadowStyle,
  GradientOverlayStyle,
  InnerGlowStyle,
  InnerShadowStyle,
  LayerStyleColor,
  LayerStyleContour,
  LayerStyleGradient,
  LayerStyleId,
  LayerStyleInstance,
  LayerStyleKind,
  LayerStyleStack,
  OuterGlowStyle,
  PatternOverlayStyle,
  SatinStyle,
  StrokeStyle
} from './layerStyleTypes';

const styleId = () => `style-${crypto.randomUUID()}` as LayerStyleId;
const stopId = () => `stop-${crypto.randomUUID()}`;

export const layerStyleColor = (
  r: number,
  g: number,
  b: number,
  a = 1
): LayerStyleColor => ({ r, g, b, a });

export const LINEAR_CONTOUR: LayerStyleContour = {
  points: [{ position: 0, value: 0 }, { position: 1, value: 1 }]
};

export const createDefaultLayerStyleGradient = (): LayerStyleGradient => ({
  id: `gradient-${crypto.randomUUID()}`,
  name: 'Foreground to Background',
  type: 'solid',
  smoothness: 1,
  colorStops: [
    { id: stopId(), position: 0, midpoint: 0.5, color: layerStyleColor(0, 0, 0) },
    { id: stopId(), position: 1, midpoint: 0.5, color: layerStyleColor(1, 1, 1) }
  ],
  opacityStops: [
    { id: stopId(), position: 0, midpoint: 0.5, opacity: 1 },
    { id: stopId(), position: 1, midpoint: 0.5, opacity: 1 }
  ],
  roughness: 0.5,
  seed: 0
});

const common = <K extends LayerStyleKind>(
  kind: K,
  name: string,
  blendMode: BlendMode,
  opacity: number
) => ({
  id: styleId(),
  kind,
  name,
  enabled: true,
  blendMode,
  opacity
});

export const createDefaultLayerStyleStack = (): LayerStyleStack => ({
  enabled: true,
  scale: 1,
  globalLight: { angle: 120, altitude: 30 },
  effects: [],
  revision: 0
});

export const createDefaultLayerStyle = (kind: LayerStyleKind): LayerStyleInstance => {
  switch (kind) {
    case 'drop-shadow':
      return {
        ...common(kind, 'Drop Shadow', 'multiply', 0.35),
        color: layerStyleColor(0, 0, 0),
        useGlobalLight: false,
        angle: 120,
        distance: 30,
        spread: 0,
        size: 30,
        contour: structuredClone(LINEAR_CONTOUR),
        antiAlias: true,
        noise: 0,
        layerKnocksOut: true
      } satisfies DropShadowStyle;
    case 'inner-shadow':
      return {
        ...common(kind, 'Inner Shadow', 'multiply', 0.35),
        color: layerStyleColor(0, 0, 0),
        useGlobalLight: false,
        angle: 120,
        distance: 3,
        choke: 0,
        size: 7,
        contour: structuredClone(LINEAR_CONTOUR),
        antiAlias: true,
        noise: 0
      } satisfies InnerShadowStyle;
    case 'outer-glow':
      return {
        ...common(kind, 'Outer Glow', 'screen', 0.35),
        color: layerStyleColor(1, 0.96, 0.75),
        gradient: null,
        technique: 'softer',
        choke: 0,
        size: 7,
        contour: structuredClone(LINEAR_CONTOUR),
        antiAlias: true,
        noise: 0,
        range: 1,
        jitter: 0
      } satisfies OuterGlowStyle;
    case 'inner-glow':
      return {
        ...common(kind, 'Inner Glow', 'screen', 0.35),
        color: layerStyleColor(1, 1, 1),
        gradient: null,
        technique: 'softer',
        source: 'edge',
        choke: 0,
        size: 7,
        contour: structuredClone(LINEAR_CONTOUR),
        antiAlias: true,
        noise: 0,
        range: 1,
        jitter: 0
      } satisfies InnerGlowStyle;
    case 'bevel-emboss':
      return {
        ...common(kind, 'Bevel & Emboss', 'normal', 1),
        style: 'inner-bevel',
        technique: 'smooth',
        depth: 1,
        direction: 'up',
        size: 5,
        soften: 0,
        useGlobalLight: false,
        angle: 120,
        altitude: 30,
        contour: structuredClone(LINEAR_CONTOUR),
        antiAlias: true,
        noise: 0,
        highlightMode: 'screen',
        highlightColor: layerStyleColor(1, 1, 1),
        highlightOpacity: 0.75,
        shadowMode: 'multiply',
        shadowColor: layerStyleColor(0, 0, 0),
        shadowOpacity: 0.75,
        texture: {
          enabled: false,
          pattern: null,
          scale: 1,
          depth: 1,
          invert: false,
          linkWithLayer: true
        }
      } satisfies BevelEmbossStyle;
    case 'color-overlay':
      return {
        ...common(kind, 'Color Overlay', 'normal', 1),
        color: layerStyleColor(1, 0.25, 0.25)
      } satisfies ColorOverlayStyle;
    case 'gradient-overlay':
      return {
        ...common(kind, 'Gradient Overlay', 'normal', 1),
        gradient: createDefaultLayerStyleGradient(),
        dither: false,
        reverse: false,
        style: 'linear',
        alignWithLayer: true,
        angle: 90,
        scale: 1,
        offsetX: 0,
        offsetY: 0,
        method: 'perceptual'
      } satisfies GradientOverlayStyle;
    case 'pattern-overlay':
      return {
        ...common(kind, 'Pattern Overlay', 'normal', 1),
        pattern: null,
        angle: 0,
        scale: 1,
        linkWithLayer: true,
        offsetX: 0,
        offsetY: 0
      } satisfies PatternOverlayStyle;
    case 'satin':
      return {
        ...common(kind, 'Satin', 'multiply', 0.5),
        color: layerStyleColor(0, 0, 0),
        useGlobalLight: false,
        angle: 90,
        distance: 50,
        size: 60,
        contour: structuredClone(LINEAR_CONTOUR),
        antiAlias: true,
        invert: true
      } satisfies SatinStyle;
    case 'stroke':
      return {
        ...common(kind, 'Stroke', 'normal', 1),
        size: 3,
        position: 'outside',
        overprint: false,
        fill: { type: 'color', color: layerStyleColor(1, 1, 1) }
      } satisfies StrokeStyle;
  }
};

export const cloneLayerStyleStack = (stack: LayerStyleStack): LayerStyleStack =>
  structuredClone(stack);

export const duplicateLayerStyleStack = (stack: LayerStyleStack): LayerStyleStack => {
  const duplicate = cloneLayerStyleStack(stack);
  duplicate.effects = duplicate.effects.map((effect) => ({
    ...effect,
    id: styleId()
  }));
  duplicate.revision = 0;
  return duplicate;
};

export const layerStyleStackIsActive = (stack: LayerStyleStack) =>
  stack.enabled && stack.effects.some((effect) => effect.enabled && effect.opacity > 0);

export const layerStyleKindLabels: Record<LayerStyleKind, string> = {
  'drop-shadow': 'Drop Shadow',
  'inner-shadow': 'Inner Shadow',
  'outer-glow': 'Outer Glow',
  'inner-glow': 'Inner Glow',
  'bevel-emboss': 'Bevel & Emboss',
  'color-overlay': 'Color Overlay',
  'gradient-overlay': 'Gradient Overlay',
  'pattern-overlay': 'Pattern Overlay',
  satin: 'Satin',
  stroke: 'Stroke'
};
