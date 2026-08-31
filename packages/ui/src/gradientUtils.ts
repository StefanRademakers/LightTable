import type { GradientColor, GradientColorStop, GradientOpacityStop, GradientValue } from './GradientEditor';

export const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
export const stopId = () => `stop-${crypto.randomUUID()}`;
const channelHex = (value: number) =>
  Math.round(clamp01(value) * 255).toString(16).padStart(2, '0');
export const colorHex = (color: GradientColor) =>
  `#${channelHex(color.r)}${channelHex(color.g)}${channelHex(color.b)}`;
export const gradientStopPosition = (clientX: number, left: number, width: number) =>
  clamp01((clientX - left) / Math.max(1, width));

export const gradientMidpointPosition = (
  leftPosition: number,
  rightPosition: number,
  midpoint: number
) => leftPosition + (rightPosition - leftPosition) * clamp01(midpoint);

export const gradientMidpointValue = (
  position: number,
  leftPosition: number,
  rightPosition: number
) => Math.max(0.05, Math.min(0.95,
  (position - leftPosition) / Math.max(1e-6, rightPosition - leftPosition)
));

export const removableGradientStops = <T extends { id: string }>(
  stops: T[],
  id: string
) => stops.length > 2 ? stops.filter((stop) => stop.id !== id) : stops;

export const sampleColor = (stops: GradientColorStop[], position: number) => {
  const sorted = [...stops].sort((a, b) => a.position - b.position);
  const upperIndex = sorted.findIndex((stop) => stop.position >= position);
  if (upperIndex === 0) return sorted[0]?.color ?? { r: 0, g: 0, b: 0, a: 1 };
  if (upperIndex < 0) return sorted.at(-1)?.color ?? { r: 1, g: 1, b: 1, a: 1 };
  const lower = sorted[upperIndex - 1];
  const upper = sorted[upperIndex];
  const relative = (position - lower.position) / Math.max(1e-6, upper.position - lower.position);
  const amount = Math.pow(clamp01(relative), Math.log(0.5) / Math.log(Math.max(0.05, Math.min(0.95, lower.midpoint))));
  return {
    r: lower.color.r + (upper.color.r - lower.color.r) * amount,
    g: lower.color.g + (upper.color.g - lower.color.g) * amount,
    b: lower.color.b + (upper.color.b - lower.color.b) * amount,
    a: lower.color.a + (upper.color.a - lower.color.a) * amount
  };
};

export const sampleOpacity = (stops: GradientOpacityStop[], position: number) => {
  const sorted = [...stops].sort((a, b) => a.position - b.position);
  const upperIndex = sorted.findIndex((stop) => stop.position >= position);
  if (upperIndex === 0) return sorted[0]?.opacity ?? 1;
  if (upperIndex < 0) return sorted.at(-1)?.opacity ?? 1;
  const lower = sorted[upperIndex - 1];
  const upper = sorted[upperIndex];
  const relative = (position - lower.position) / Math.max(1e-6, upper.position - lower.position);
  const amount = Math.pow(clamp01(relative), Math.log(0.5) / Math.log(Math.max(0.05, Math.min(0.95, lower.midpoint))));
  return lower.opacity + (upper.opacity - lower.opacity) * amount;
};

/** Bounded display-only ramp; authored stops and midpoint values are unchanged. */
export function gradientPreview(value: GradientValue): string {
  const positions = new Set(Array.from({ length: 33 }, (_, i) => i / 32));
  for (const stop of [...value.colorStops, ...value.opacityStops]) positions.add(stop.position);
  return `linear-gradient(to right, ${[...positions].sort((a, b) => a - b).map(position => {
    const color = sampleColor(value.colorStops, position);
    const alpha = color.a * sampleOpacity(value.opacityStops, position);
    return `rgba(${Math.round(color.r * 255)}, ${Math.round(color.g * 255)}, ${Math.round(color.b * 255)}, ${alpha}) ${position * 100}%`;
  }).join(', ')})`;
}
