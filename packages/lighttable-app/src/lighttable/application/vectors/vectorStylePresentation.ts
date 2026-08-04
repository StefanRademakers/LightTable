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
  strokeWidth: element.style.stroke?.width ?? 3,
  strokeAlignment: element.style.stroke?.alignment ?? 'center',
  strokeStyle: !element.style.stroke?.dash.length
    ? 'solid' : element.style.stroke.dash[0]! <= 1 ? 'dotted' : 'dashed'
});

export const patchVectorStyle = (
  style: VectorStyle,
  change: Partial<VectorToolStyleSettings>
): VectorStyle => ({
  ...style,
  fill: change.fillEnabled === false ? null
    : change.fillPaint !== undefined
      ? ('kind' in change.fillPaint
          ? cloneGradientPaint(change.fillPaint)
          : { ...change.fillPaint, color: [...change.fillPaint.color] })
    : change.fillColor !== undefined
      ? { type: 'solid', color: cssHexToLinearRgba(change.fillColor) }
      : change.fillEnabled === true && !style.fill
        ? { type: 'solid', color: [0, 0, 0, 1] }
        : style.fill,
  stroke: change.strokeEnabled === false ? null : {
    paint: change.strokeColor !== undefined
      ? { type: 'solid', color: cssHexToLinearRgba(change.strokeColor) }
      : style.stroke?.paint ?? { type: 'solid', color: [1, 1, 1, 1] },
    width: change.strokeWidth ?? style.stroke?.width ?? 3,
    alignment: change.strokeAlignment ?? style.stroke?.alignment ?? 'center',
    cap: style.stroke?.cap ?? 'round',
    join: style.stroke?.join ?? 'round',
    miterLimit: style.stroke?.miterLimit ?? 4,
    dash: change.strokeStyle === 'solid' ? []
      : change.strokeStyle === 'dotted' ? [1, 2]
        : change.strokeStyle === 'dashed' ? [4, 3]
          : [...(style.stroke?.dash ?? [])],
    dashOffset: style.stroke?.dashOffset ?? 0
  }
});
