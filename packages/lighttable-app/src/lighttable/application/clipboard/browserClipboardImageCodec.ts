import type { PreparedClipboardImage } from './ClipboardHostIntents';

/** Browser decoding owns its bitmap and temporary SVG-mask canvas, never GPU editor resources. */
export const prepareBrowserClipboardImage = async (blob: Blob): Promise<PreparedClipboardImage> => {
  let file = new File([blob], 'Clipboard image.png', { type: blob.type || 'image/png' });
  const bitmap = await createImageBitmap(file);
  try {
    if (bitmap.width < 1 || bitmap.height < 1 || bitmap.width > 32_768
      || bitmap.height > 32_768 || bitmap.width * bitmap.height > 268_435_456) {
      throw new Error('Clipboard image dimensions exceed the supported resource bounds.');
    }
    if (file.type === 'image/svg+xml') {
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      try {
        const context = canvas.getContext('2d');
        if (!context) throw new Error('The SVG clipboard image could not be rasterized for the mask.');
        context.drawImage(bitmap, 0, 0);
        const png = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
          value => value ? resolve(value) : reject(new Error('The SVG clipboard image could not be encoded.')),
          'image/png'
        ));
        file = new File([png], 'Clipboard image.png', { type: 'image/png' });
      } finally {
        canvas.width = 1;
        canvas.height = 1;
      }
    }
    let disposed = false;
    return { file, width: bitmap.width, height: bitmap.height, dispose() {
      if (!disposed) bitmap.close();
      disposed = true;
    } };
  } catch (reason) {
    bitmap.close();
    throw reason;
  }
};
