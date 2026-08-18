import type { LightTableCommandId, LightTableCreateDocumentOptions,
  LightTableGestureKind, LightTableGestureSample } from './lightTableCommandContract';

const record = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);
const commandIds = new Set<string>([
  'document.create', 'document.duplicate', 'document.resizeImage', 'view.setZoom', 'layer.createRaster', 'layer.placeArtifact',
  'layer.rename', 'layer.setVisibility', 'layer.setFillOpacity', 'layer.style.setEnabled',
  'layer.effect.setEnabled', 'text.create', 'text.replaceRange', 'text.format', 'text.setLayout',
  'vector.create', 'vector.update', 'vector.remove', 'layer.effect.add', 'layer.effect.update',
  'faceWarp.applyOperation',
  'layer.effect.remove', 'layer.effect.move', 'command.batch', 'task.cancel', 'file.openArtifact',
  'file.exportNative', 'file.exportPng', 'file.exportPsd', 'history.undo', 'history.redo'
]);

export const isLightTableCommandId = (value: string): value is LightTableCommandId => commandIds.has(value);
export const isLightTableGestureKind = (value: unknown): value is LightTableGestureKind => (
  value === 'brush-stroke' || value === 'selection-rectangle' || value === 'layer-translate'
);
export const isLightTableGestureSample = (value: unknown): value is LightTableGestureSample => record(value)
  && typeof value.x === 'number' && Number.isFinite(value.x) && Math.abs(value.x) <= 10_000_000
  && typeof value.y === 'number' && Number.isFinite(value.y) && Math.abs(value.y) <= 10_000_000
  && (value.pressure === undefined || (typeof value.pressure === 'number' && Number.isFinite(value.pressure)
    && value.pressure >= 0 && value.pressure <= 1));

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
