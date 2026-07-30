import type { NativeDecodedImage } from './types';

/**
 * Fast path for ordinary web images.
 *
 * Keep this function deliberately small: calling it must not initialize a
 * worker, inspect the complete Blob, or import an optional WASM decoder.
 */
export const decodeNativeImage = async (blob: Blob): Promise<NativeDecodedImage> => {
  const bitmap = await createImageBitmap(blob, {
    colorSpaceConversion: 'none',
    premultiplyAlpha: 'none'
  });

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
