import type { LightTableCreateDocumentOptions,
  LightTableGestureKind, LightTableGestureSample } from './lightTableCommandContract';
import { isLightTableCommandId } from '@lighttable/command-contract';
import type { BrushSettings } from '../../editor/session/editorSession';
import { BRUSH_PRESET_IDS } from '../../editor/tools/brush/brushPresets';

const record = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);
export { isLightTableCommandId };
export const isLightTableGestureKind = (value: unknown): value is LightTableGestureKind => (
  value === 'brush-stroke' || value === 'selection-rectangle' || value === 'layer-translate'
);
export const isLightTableGestureSample = (value: unknown): value is LightTableGestureSample => record(value)
  && typeof value.x === 'number' && Number.isFinite(value.x) && Math.abs(value.x) <= 10_000_000
  && typeof value.y === 'number' && Number.isFinite(value.y) && Math.abs(value.y) <= 10_000_000
  && (value.pressure === undefined || (typeof value.pressure === 'number' && Number.isFinite(value.pressure)
    && value.pressure >= 0 && value.pressure <= 1));

export interface CommittedGestureRequest {
  readonly kind: LightTableGestureKind;
  readonly parameters: Record<string, unknown>;
  readonly samples: readonly LightTableGestureSample[];
}

const unitInterval = (value: unknown): value is number => (
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
);
const hexColor = (value: unknown): value is string => (
  typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
);

export const parseAutomationBrushSettings = (value: unknown): BrushSettings | null => {
  if (!record(value) || typeof value.presetId !== 'string'
    || !BRUSH_PRESET_IDS.includes(value.presetId as BrushSettings['presetId'])
    || typeof value.size !== 'number' || !Number.isFinite(value.size) || value.size < 0.1 || value.size > 5000
    || !unitInterval(value.hardness) || !unitInterval(value.opacity) || !unitInterval(value.flow)
    || typeof value.spacing !== 'number' || !Number.isFinite(value.spacing)
    || value.spacing < 0.001 || value.spacing > 2 || !unitInterval(value.smooth)
    || !hexColor(value.color) || !hexColor(value.backgroundColor)) return null;
  return {
    presetId: value.presetId as BrushSettings['presetId'],
    size: value.size,
    hardness: value.hardness,
    opacity: value.opacity,
    flow: value.flow,
    spacing: value.spacing,
    smooth: value.smooth,
    color: value.color,
    backgroundColor: value.backgroundColor
  };
};

export const parseCommittedGestureRequest = (
  value: unknown
): CommittedGestureRequest | { readonly message: string } => {
  if (!record(value) || !isLightTableGestureKind(value.kind) || !record(value.parameters)
    || !Array.isArray(value.samples) || value.samples.length < 1 || value.samples.length > 4096
    || !value.samples.every(isLightTableGestureSample)) {
    return { message: 'Committed gesture requires a supported kind, parameters and 1-4096 finite samples.' };
  }
  let byteLength = Number.POSITIVE_INFINITY;
  try { byteLength = new TextEncoder().encode(JSON.stringify(value)).byteLength; } catch { /* rejected below */ }
  if (byteLength > 240 * 1024) {
    return { message: 'Committed gesture payload exceeds the 240 KiB Actions boundary.' };
  }
  let parameters: Record<string, unknown>;
  if (value.kind === 'brush-stroke') {
    const brush = parseAutomationBrushSettings(value.parameters.brush);
    if (typeof value.parameters.layerId !== 'string' || !value.parameters.layerId
      || !brush || (value.parameters.channel !== 'pixels' && value.parameters.channel !== 'mask')
      || (value.parameters.erase !== undefined && typeof value.parameters.erase !== 'boolean')) {
      return { message: 'Committed brush stroke requires layerId, channel and complete bounded brush settings.' };
    }
    parameters = { layerId: value.parameters.layerId, channel: value.parameters.channel,
      erase: value.parameters.erase === true, brush };
  } else if (value.kind === 'layer-translate') {
    if (typeof value.parameters.layerId !== 'string' || !value.parameters.layerId) {
      return { message: 'Committed layer translation requires layerId.' };
    }
    parameters = { layerId: value.parameters.layerId };
  } else {
    const mode = value.parameters.mode;
    if (mode !== 'replace' && mode !== 'add' && mode !== 'subtract' && mode !== 'intersect') {
      return { message: 'Committed selection rectangle requires a combine mode.' };
    }
    parameters = { mode };
  }
  return {
    kind: value.kind,
    parameters,
    samples: value.samples as LightTableGestureSample[]
  };
};

export const parseCreateDocumentOptions = (value: unknown): LightTableCreateDocumentOptions | { message: string } => {
  if (!record(value)) return { message: 'Create document parameters must be an object.' };
  const { width, height, resolutionPpi, bitDepth, profile, background } = value;
  if (!Number.isInteger(width) || !Number.isInteger(height) || Number(width) < 1 || Number(height) < 1
    || Number(width) > 32_768 || Number(height) > 32_768 || Number(width) * Number(height) > 268_435_456) {
    return { message: 'Document dimensions must be 1-32768 px and at most 268435456 pixels.' };
  }
  if (typeof resolutionPpi !== 'number' || !Number.isFinite(resolutionPpi) || resolutionPpi < 1 || resolutionPpi > 2_400) {
    return { message: 'Document resolution must be between 1 and 2400 ppi.' };
  }
  if (bitDepth !== 8 && bitDepth !== 16) return { message: 'Document bitDepth must be 8 or 16.' };
  if (profile !== 'srgb' && profile !== 'adobe-rgb-1998') return { message: 'Document profile is unsupported.' };
  if (!record(background) || (background.kind !== 'transparent' && background.kind !== 'solid')
    || (background.kind === 'solid' && (typeof background.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(background.color)))) {
    return { message: 'Background must be transparent or a solid #RRGGBB color.' };
  }
  const name = typeof value.name === 'string' && value.name.trim() ? value.name.trim() : 'Untitled';
  if (name.length > 255) return { message: 'Document name must not exceed 255 characters.' };
  return { name, width: Number(width), height: Number(height), resolutionPpi, bitDepth, profile,
    background: background as LightTableCreateDocumentOptions['background'] };
};
