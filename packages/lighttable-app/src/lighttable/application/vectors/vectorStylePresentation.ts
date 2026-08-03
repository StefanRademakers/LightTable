import type { VectorElement, VectorStyle } from '@lighttable/vector-core';
import type { VectorToolStyleSettings } from '../../editor/session/editorSession';

const linearToSrgb = (value: number) => value <= 0.0031308
  ? value * 12.92
  : 1.055 * value ** (1 / 2.4) - 0.055;

const channelHex = (value: number) => Math.round(
  Math.max(0, Math.min(1, linearToSrgb(value))) * 255
).toString(16).padStart(2, '0');

export const linearRgbaToCssHex = (color: readonly number[]) =>
  `#${channelHex(color[0] ?? 0)}${channelHex(color[1] ?? 0)}${channelHex(color[2] ?? 0)}`;

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
  fillColor: linearRgbaToCssHex(element.style.fill?.color ?? [0, 0, 0, 1]),
  strokeEnabled: element.style.stroke !== null,
  strokeColor: linearRgbaToCssHex(element.style.stroke?.paint.color ?? [1, 1, 1, 1]),
  strokeWidth: element.style.stroke?.width ?? 3,
  strokeAlignment: element.style.stroke?.alignment ?? 'center'
});

export const patchVectorStyle = (
  style: VectorStyle,
  change: Partial<VectorToolStyleSettings>
): VectorStyle => ({
  ...style,
  fill: change.fillEnabled === false ? null
    : change.fillColor !== undefined
      ? { type: 'solid', color: cssHexToLinearRgba(change.fillColor) }
      : change.fillEnabled === true && !style.fill
        ? { type: 'solid', color: [0, 0, 0, 1] }
        : style.fill,
  stroke: change.strokeEnabled === false ? null : {
    paint: {
      type: 'solid',
      color: change.strokeColor === undefined
        ? style.stroke?.paint.color ?? [1, 1, 1, 1]
        : cssHexToLinearRgba(change.strokeColor)
    },
    width: change.strokeWidth ?? style.stroke?.width ?? 3,
    alignment: change.strokeAlignment ?? style.stroke?.alignment ?? 'center',
    cap: style.stroke?.cap ?? 'round',
    join: style.stroke?.join ?? 'round',
    miterLimit: style.stroke?.miterLimit ?? 4,
    dash: [...(style.stroke?.dash ?? [])],
    dashOffset: style.stroke?.dashOffset ?? 0
  }
});
