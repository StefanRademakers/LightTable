export type NativeBitmapFormatId = 'jpeg' | 'png' | 'webp' | 'tiff';

export interface NativeBitmapFormatDefinition {
  readonly id: NativeBitmapFormatId;
  readonly label: string;
  readonly mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/tiff';
  readonly extensions: readonly string[];
  readonly supportsAlpha: boolean;
  readonly writableBitDepths: readonly (8 | 16)[];
}

export const NATIVE_BITMAP_FORMATS: readonly NativeBitmapFormatDefinition[] = Object.freeze([
  Object.freeze({
    id: 'jpeg', label: 'JPEG', mediaType: 'image/jpeg',
    extensions: Object.freeze(['.jpg', '.jpeg', '.jpe', '.jfif']),
    supportsAlpha: false, writableBitDepths: Object.freeze([8] as const)
  }),
  Object.freeze({
    id: 'png', label: 'PNG', mediaType: 'image/png',
    extensions: Object.freeze(['.png']),
    supportsAlpha: true, writableBitDepths: Object.freeze([8, 16] as const)
  }),
  Object.freeze({
    id: 'webp', label: 'WebP', mediaType: 'image/webp',
    extensions: Object.freeze(['.webp']),
    supportsAlpha: true, writableBitDepths: Object.freeze([8] as const)
  }),
  Object.freeze({
    id: 'tiff', label: 'TIFF', mediaType: 'image/tiff',
    extensions: Object.freeze(['.tif', '.tiff']),
    supportsAlpha: true, writableBitDepths: Object.freeze([8, 16] as const)
  })
]);

const byId = new Map(NATIVE_BITMAP_FORMATS.map((format) => [format.id, format]));
const byMediaType = new Map<string, NativeBitmapFormatDefinition>(
  NATIVE_BITMAP_FORMATS.map((format) => [format.mediaType, format])
);
const byExtension = new Map(NATIVE_BITMAP_FORMATS.flatMap((format) =>
  format.extensions.map((extension) => [extension, format] as const)
));

export const nativeBitmapFormat = (id: NativeBitmapFormatId) => byId.get(id)!;

export const isNativeBitmapFormatId = (value: unknown): value is NativeBitmapFormatId =>
  typeof value === 'string' && byId.has(value as NativeBitmapFormatId);

export const nativeBitmapFormatForFile = (
  name: string,
  mediaType = ''
): NativeBitmapFormatDefinition | null => {
  const normalizedType = mediaType.trim().toLocaleLowerCase('en-US');
  const extension = /(?:^|\.)([^.]+)$/.exec(name.toLocaleLowerCase('en-US'))?.[1];
  const extensionFormat = extension ? byExtension.get(`.${extension}`) : undefined;
  const mediaTypeFormat = normalizedType ? byMediaType.get(normalizedType) : undefined;
  if (mediaTypeFormat && extensionFormat && mediaTypeFormat.id !== extensionFormat.id) return null;
  if (normalizedType && normalizedType !== 'application/octet-stream' && !mediaTypeFormat) return null;
  return mediaTypeFormat ?? extensionFormat ?? null;
};

export const nativeBitmapPickerAccept = () => Object.fromEntries(
  NATIVE_BITMAP_FORMATS.map((format) => [format.mediaType, [...format.extensions]])
) as Record<NativeBitmapFormatDefinition['mediaType'], string[]>;
