import type { VectorElement, VectorStyle } from '@lighttable/vector-core';
import { cloneGradientPaint } from '@lighttable/paint-core';
import type { VectorToolStyleSettings } from '../../editor/session/editorSession';

const linearToSrgb = (value: number) => value <= 0.0031308
  ? value * 12.92
  : 1.055 * value ** (1 / 2.4) - 0.055;

const channelHex = (value: number) => Math.round(
  Math.max(0, Math.min(1, linearToSrgb(value))) * 255
).toString(16).padStart(2, '0');

const srgbChannelHex = (value: number) => Math.round(
  Math.max(0, Math.min(1, value)) * 255
).toString(16).padStart(2, '0');

export const linearRgbaToCssHex = (color: readonly number[]) =>
  `#${channelHex(color[0] ?? 0)}${channelHex(color[1] ?? 0)}${channelHex(color[2] ?? 0)}`;

const paintCssColor = (paint: VectorStyle['fill'], fallback: string) => {
  if (!paint) return fallback;
  if (!('kind' in paint)) return linearRgbaToCssHex(paint.color);
  const color = [...paint.asset.colorStops].sort((left, right) => left.position - right.position)[0]?.color;
  return color
    ? `#${srgbChannelHex(color.r)}${srgbChannelHex(color.g)}${srgbChannelHex(color.b)}`
    : fallback;
};

const srgbToLinear = (value: number) => value <= 0.04045
  ? value / 12.92
  : ((value + 0.055) / 1.055) ** 2.4;

export const cssHexToLinearRgba = (color: string): [number, number, number, number] => {
  const match = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(color);
  if (!match) return [0, 0, 0, 1];
  return [
    srgbToLinear(Number.parseInt(match[1]!, 16) / 255),
    srgbToLinear(Number.parseInt(match[2]!, 16) / 255),
    srgbToLinear(Number.parseInt(match[3]!, 16) / 255),
    1
  ];
};

const cloneVectorPaint = (paint: NonNullable<VectorStyle['fill']>) => 'kind' in paint
  ? cloneGradientPaint(paint)
  : { ...paint, color: [...paint.color] as [number, number, number, number] };

const safeStrokeWidth = (width: number) => Math.max(0.1, width);

/** Preset dash lengths are multiples of stroke width, not fixed document pixels. */
export const vectorStrokeDashForStyle = (
  style: NonNullable<VectorToolStyleSettings['strokeStyle']>,
  width: number
): number[] => {
  const unit = safeStrokeWidth(width);
  return style === 'dashed' ? [4 * unit, 3 * unit]
    : style === 'dotted' ? [unit, 2 * unit]
      : [];
};

const vectorStrokeStyle = (stroke: NonNullable<VectorStyle['stroke']>) => {
  if (!stroke.dash.length) return 'solid' as const;
  return stroke.dash[0]! <= safeStrokeWidth(stroke.width) * 1.5
    ? 'dotted' as const
    : 'dashed' as const;
};

/** Canonical projection used for every newly authored Pen/live-shape element. */
export const vectorStyleFromToolSettings = (settings: VectorToolStyleSettings): VectorStyle => ({
  fill: settings.fillEnabled
    ? settings.fillPaint
      ? cloneVectorPaint(settings.fillPaint)
      : { type: 'solid', color: cssHexToLinearRgba(settings.fillColor) }
    : null,
  stroke: settings.strokeEnabled ? {
    paint: settings.strokePaint
      ? cloneVectorPaint(settings.strokePaint)
      : { type: 'solid', color: cssHexToLinearRgba(settings.strokeColor) },
    opacity: Math.max(0, Math.min(1, settings.strokeOpacity ?? 1)),
    width: safeStrokeWidth(settings.strokeWidth),
    alignment: settings.strokeAlignment,
    cap: settings.strokeCap ?? 'round',
    join: settings.strokeJoin ?? 'round',
    miterLimit: Math.max(1, settings.strokeMiterLimit ?? 4),
    dash: vectorStrokeDashForStyle(settings.strokeStyle ?? 'solid', settings.strokeWidth),
    dashOffset: 0
  } : null,
  opacity: Math.max(0, Math.min(1, settings.opacity ?? 1))
});

export const vectorElementStyleSettings = (
  element: VectorElement
): VectorToolStyleSettings => ({
  fillEnabled: element.style.fill !== null,
  fillColor: paintCssColor(element.style.fill, '#000000'),
  ...(element.style.fill ? {
    fillPaint: 'kind' in element.style.fill
      ? cloneGradientPaint(element.style.fill)
      : { ...element.style.fill, color: [...element.style.fill.color] }
  } : {}),
  strokeEnabled: element.style.stroke !== null,
  strokeColor: paintCssColor(element.style.stroke?.paint ?? null, '#ffffff'),
  strokeOpacity: element.style.stroke?.opacity ?? 1,
  ...(element.style.stroke ? {
    strokePaint: 'kind' in element.style.stroke.paint
      ? cloneGradientPaint(element.style.stroke.paint)
      : { ...element.style.stroke.paint, color: [...element.style.stroke.paint.color] }
  } : {}),
  strokeWidth: element.style.stroke?.width ?? 3,
  strokeAlignment: element.style.stroke?.alignment ?? 'center',
  strokeCap: element.style.stroke?.cap ?? 'round',
  strokeJoin: element.style.stroke?.join ?? 'round',
  strokeMiterLimit: element.style.stroke?.miterLimit ?? 4,
  strokeStyle: element.style.stroke ? vectorStrokeStyle(element.style.stroke) : 'solid',
  opacity: element.style.opacity
});

export const patchVectorStyle = (
  style: VectorStyle,
  change: Partial<VectorToolStyleSettings>
): VectorStyle => {
  const wantsStroke = style.stroke !== null || change.strokeEnabled === true
    || change.strokeColor !== undefined || change.strokePaint !== undefined;
  const previousStrokeWidth = safeStrokeWidth(style.stroke?.width ?? 3);
  const nextStrokeWidth = safeStrokeWidth(change.strokeWidth ?? previousStrokeWidth);
  const strokeWidthScale = nextStrokeWidth / previousStrokeWidth;
  const nextDash = change.strokeStyle !== undefined
    ? vectorStrokeDashForStyle(change.strokeStyle, nextStrokeWidth)
    : change.strokeWidth !== undefined && style.stroke?.dash.length
      ? style.stroke.dash.map((value) => value * strokeWidthScale)
      : [...(style.stroke?.dash ?? [])];
  return {
    ...style,
    opacity: change.opacity ?? style.opacity,
    fill: change.fillEnabled === false ? null
    : change.fillPaint !== undefined
      ? change.fillPaint === null
        ? { type: 'solid', color: cssHexToLinearRgba(change.fillColor ?? paintCssColor(style.fill, '#000000')) }
        : ('kind' in change.fillPaint
            ? cloneGradientPaint(change.fillPaint)
            : cloneVectorPaint(change.fillPaint))
    : change.fillColor !== undefined
      ? { type: 'solid', color: cssHexToLinearRgba(change.fillColor) }
      : change.fillEnabled === true && !style.fill
        ? { type: 'solid', color: [0, 0, 0, 1] }
        : style.fill,
    stroke: change.strokeEnabled === false || !wantsStroke ? null : {
      paint: change.strokePaint !== undefined
        ? change.strokePaint === null
          ? { type: 'solid', color: cssHexToLinearRgba(change.strokeColor ?? paintCssColor(style.stroke?.paint ?? null, '#ffffff')) }
          : ('kind' in change.strokePaint
              ? cloneGradientPaint(change.strokePaint)
              : cloneVectorPaint(change.strokePaint))
        : change.strokeColor !== undefined
          ? { type: 'solid', color: cssHexToLinearRgba(change.strokeColor) }
          : style.stroke?.paint ?? { type: 'solid', color: [1, 1, 1, 1] },
      opacity: change.strokeOpacity ?? style.stroke?.opacity ?? 1,
      width: nextStrokeWidth,
      alignment: change.strokeAlignment ?? style.stroke?.alignment ?? 'center',
      cap: change.strokeCap ?? style.stroke?.cap ?? 'round',
      join: change.strokeJoin ?? style.stroke?.join ?? 'round',
      miterLimit: change.strokeMiterLimit ?? style.stroke?.miterLimit ?? 4,
      dash: nextDash,
      dashOffset: change.strokeWidth !== undefined
        ? (style.stroke?.dashOffset ?? 0) * strokeWidthScale
        : style.stroke?.dashOffset ?? 0
    }
  };
};
