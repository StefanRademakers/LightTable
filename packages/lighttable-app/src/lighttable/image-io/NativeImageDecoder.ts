import type { NativeDecodedImage } from './types';

const bitmapOptions: ImageBitmapOptions = {
  colorSpaceConversion: 'none',
  premultiplyAlpha: 'none'
};

const decodeSvgBitmap = async (blob: Blob): Promise<ImageBitmap> => {
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.decoding = 'async';
    image.src = url;
    await image.decode();
    return createImageBitmap(image, bitmapOptions);
  } finally {
    URL.revokeObjectURL(url);
  }
};

/**
 * Fast path for ordinary web images.
 *
 * Keep this function deliberately small: calling it must not initialize a
 * worker, inspect the complete Blob, or import an optional WASM decoder.
 */
export const decodeNativeImage = async (blob: Blob): Promise<NativeDecodedImage> => {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob, bitmapOptions);
  } catch (reason) {
    if (blob.type !== 'image/svg+xml') throw reason;
    // Chromium's Blob overload rejects SVG while its decoded-image overload
    // renders the same sanitized source correctly. Keep this fallback SVG-only
    // so ordinary bitmap ingest remains the single-call native fast path.
    bitmap = await decodeSvgBitmap(blob);
  }

  if (!bitmap.width || !bitmap.height) {
    bitmap.close();
    throw new Error('The selected image has no valid dimensions.');
  }

  return {
    kind: 'native-bitmap',
    bitmap,
    descriptor: {
      width: bitmap.width,
      height: bitmap.height,
      channels: 4,
      storage: 'external-image',
      colorSpace: 'srgb',
      transferFunction: 'srgb',
      alphaMode: 'straight',
      // createImageBitmap uses the image's encoded orientation by default.
      orientationApplied: true,
      sourceBitDepth: 8,
      contentType: blob.type || 'image/png'
    },
    close: () => bitmap.close()
  };
};
