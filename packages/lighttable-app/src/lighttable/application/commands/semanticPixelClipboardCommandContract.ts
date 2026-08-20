export type PixelClipboardSource = 'active-layer' | 'merged';

export interface SemanticCopyPixelsCommand {
  readonly source: PixelClipboardSource;
}

export interface PixelClipboardBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface SemanticPastePixelsCommand {
  readonly artifactId: string;
  readonly bounds: PixelClipboardBounds;
  readonly name?: string;
}

const record = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

export const parseSemanticCopyPixelsCommand = (
  value: unknown
): SemanticCopyPixelsCommand | { readonly message: string } => {
  if (!record(value) || Object.keys(value).length !== 1
    || (value.source !== 'active-layer' && value.source !== 'merged')) {
    return { message: 'Copy Pixels requires exactly source "active-layer" or "merged".' };
  }
  return { source: value.source };
};

export const parseSemanticPastePixelsCommand = (
  value: unknown
): SemanticPastePixelsCommand | { readonly message: string } => {
  if (!record(value) || Object.keys(value).some((key) => !['artifactId', 'bounds', 'name'].includes(key))
    || typeof value.artifactId !== 'string' || value.artifactId.length < 1
    || value.artifactId.length > 256 || !record(value.bounds)
    || Object.keys(value.bounds).some((key) => !['x', 'y', 'width', 'height'].includes(key))) {
    return { message: 'Paste Pixels requires an artifactId and closed document bounds.' };
  }
  const { x, y, width, height } = value.bounds;
  if (![x, y, width, height].every((entry) => typeof entry === 'number'
      && Number.isFinite(entry) && Math.abs(entry) <= 10_000_000)
    || Number(width) <= 0 || Number(height) <= 0
    || (value.name !== undefined && (typeof value.name !== 'string'
      || !value.name.trim() || value.name.length > 255
      || /[\u0000-\u001f\u007f]/u.test(value.name)))) {
    return { message: 'Paste Pixels bounds or layer name are invalid.' };
  }
  return {
    artifactId: value.artifactId,
    bounds: { x: Number(x), y: Number(y), width: Number(width), height: Number(height) },
    ...(typeof value.name === 'string' ? { name: value.name } : {})
  };
};
