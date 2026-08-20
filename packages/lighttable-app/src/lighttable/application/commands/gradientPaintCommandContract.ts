import { gradientPaintIsValid, type GradientPaintInstance } from '@lighttable/paint-core';

const record = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);
const boundedString = (value: unknown) => typeof value === 'string' && value.length > 0 && value.length <= 255;
const boundedTransform = (value: unknown) => record(value)
  && ['a', 'b', 'c', 'd', 'tx', 'ty'].every((key) => typeof value[key] === 'number'
    && Number.isFinite(value[key]) && Math.abs(Number(value[key])) <= 10_000_000);

export const validGradientPaintCommand = (
  value: unknown,
  coordinateSpaces: readonly GradientPaintInstance['coordinateSpace'][] = ['object-bounds', 'layer', 'document']
): value is GradientPaintInstance => {
  if (!record(value) || value.kind !== 'gradient' || !record(value.asset)
    || !Array.isArray(value.asset.colorStops) || !Array.isArray(value.asset.opacityStops)
    || value.asset.colorStops.length < 2 || value.asset.colorStops.length > 64
    || value.asset.opacityStops.length < 2 || value.asset.opacityStops.length > 64
    || !boundedString(value.asset.id) || !boundedString(value.asset.name)
    || !boundedTransform(value.transform) || !coordinateSpaces.includes(value.coordinateSpace as never)) return false;
  const stopIds = [...value.asset.colorStops, ...value.asset.opacityStops]
    .map((stop) => record(stop) ? stop.id : null);
  if (stopIds.some((id) => !boundedString(id)) || new Set(stopIds).size !== stopIds.length) return false;
  try { return gradientPaintIsValid(value as unknown as GradientPaintInstance); } catch { return false; }
};

export const parseGradientPaintCommand = (
  value: unknown,
  coordinateSpaces?: readonly GradientPaintInstance['coordinateSpace'][]
): GradientPaintInstance | { readonly message: string } => {
  if (!validGradientPaintCommand(value, coordinateSpaces)) {
    return { message: 'Gradient paint is malformed or exceeds the 64-stop geometry limits.' };
  }
  let bytes = Number.POSITIVE_INFINITY;
  try { bytes = new TextEncoder().encode(JSON.stringify(value)).byteLength; } catch { /* rejected below */ }
  if (bytes > 64 * 1024) return { message: 'Gradient paint exceeds the 64 KiB command boundary.' };
  return structuredClone(value);
};
