import type { LightTableImageDecodeMode } from '../application/rendering/rendererTypes';

interface FilePickerAcceptType {
  description: string;
  accept: Record<string, string[]>;
}

interface FileSystemFileHandle {
  getFile(): Promise<File>;
}

type FilePickerWindow = Window & {
  showOpenFilePicker?: (options: {
    multiple?: boolean;
    excludeAcceptAllOption?: boolean;
    types?: FilePickerAcceptType[];
  }) => Promise<FileSystemFileHandle[]>;
};

const AUTOMATIC_FORMATS: FilePickerAcceptType[] = [
  {
    description: 'LightTable documents and images (PNG, JPEG, WebP, TIFF, PSD/PSB)',
    accept: {
      'image/jpeg': ['.jpg', '.jpeg', '.jpe', '.jfif'],
      'image/png': ['.png'],
      'image/webp': ['.webp'],
      'image/tiff': ['.tif', '.tiff'],
      'image/vnd.adobe.photoshop': ['.psd', '.psb']
    }
  }
];

const PRECISION_FORMATS: FilePickerAcceptType[] = [
  {
    description: 'Precision images (PNG, TIFF, JPEG, WebP)',
    accept: {
      'image/png': ['.png'],
      'image/tiff': ['.tif', '.tiff'],
      'image/jpeg': ['.jpg', '.jpeg', '.jpe', '.jfif'],
      'image/webp': ['.webp']
    }
  }
];

const formatsForMode = (mode: LightTableImageDecodeMode) =>
  mode === 'preserve-precision' ? PRECISION_FORMATS : AUTOMATIC_FORMATS;

export const imagePickerAccept = (mode: LightTableImageDecodeMode) =>
  formatsForMode(mode)
    .flatMap((type) => Object.entries(type.accept))
    .flatMap(([mime, extensions]) => [mime, ...extensions])
    .join(',');

export const imagePickerDescription = (mode: LightTableImageDecodeMode) =>
  formatsForMode(mode)[0].description;

export const imagePickerFormatNames = (mode: LightTableImageDecodeMode) =>
  mode === 'preserve-precision'
    ? 'PNG, TIFF, JPEG, WebP'
    : 'PNG, JPEG, WebP, TIFF, PSD/PSB';

export const isPhotoshopDocument = (blob: Blob, name: string) =>
  blob.type.toLowerCase() === 'image/vnd.adobe.photoshop'
  || name.toLowerCase().endsWith('.psd');

export const isSupportedImageFile = (
  blob: Blob,
  name: string,
  mode: LightTableImageDecodeMode
) => {
  const normalizedType = blob.type.toLowerCase();
  const acceptedTypes = new Set(formatsForMode(mode).flatMap((type) => Object.keys(type.accept)));
  if (acceptedTypes.has(normalizedType)) return true;
  if (normalizedType && normalizedType !== 'application/octet-stream') return false;
  return formatsForMode(mode).some((type) =>
    Object.values(type.accept).flat().some((extension) => name.toLowerCase().endsWith(extension))
  );
};

/**
 * Uses the richer system picker when Chromium exposes it. Its named filters
 * make the actually supported formats visible in the Windows file dialog.
 * Other browsers retain the hidden input fallback supplied by the caller.
 */
export const pickSupportedImageFile = async (
  mode: LightTableImageDecodeMode,
  fallbackInput: HTMLInputElement | null
): Promise<File | null> => {
  const picker = (window as FilePickerWindow).showOpenFilePicker;
  if (!picker) {
    fallbackInput?.click();
    return null;
  }

  try {
    const [handle] = await picker({
      multiple: false,
      excludeAcceptAllOption: true,
      types: formatsForMode(mode)
    });
    return handle ? await handle.getFile() : null;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return null;
    throw error;
  }
};
