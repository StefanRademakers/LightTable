export const GPU_COPY_BYTES_PER_ROW_ALIGNMENT = 256;

interface PendingPngEncoding {
  readonly resolve: (blob: Blob) => void;
  readonly reject: (error: Error) => void;
}

let pngWorker: Worker | null = null;
let pngWorkerSequence = 0;
const pendingPngEncodings = new Map<number, PendingPngEncoding>();

const getPngWorker = (): Worker | null => {
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') return null;
  if (pngWorker) return pngWorker;
  pngWorker = new Worker(new URL('./pngEncodingWorker.ts', import.meta.url), { type: 'module' });
  pngWorker.onmessage = ({ data }: MessageEvent<{ id: number; blob?: Blob; error?: string }>) => {
    const pending = pendingPngEncodings.get(data.id);
    if (!pending) return;
    pendingPngEncodings.delete(data.id);
    if (data.blob) pending.resolve(data.blob);
    else pending.reject(new Error(data.error ?? 'PNG worker encoding failed.'));
  };
  pngWorker.onerror = (event) => {
    const error = new Error(event.message || 'PNG worker stopped unexpectedly.');
    for (const pending of pendingPngEncodings.values()) pending.reject(error);
    pendingPngEncodings.clear();
    pngWorker?.terminate();
    pngWorker = null;
  };
  return pngWorker;
};

export const alignGpuBytesPerRow = (
  value: number,
  alignment = GPU_COPY_BYTES_PER_ROW_ALIGNMENT
) => Math.ceil(value / alignment) * alignment;

export const stripTextureRowPadding = (
  mapped: Uint8Array,
  width: number,
  height: number,
  bytesPerPixel: number,
  paddedBytesPerRow: number
) => {
  const unpaddedBytesPerRow = width * bytesPerPixel;
  const pixels = new Uint8ClampedArray(unpaddedBytesPerRow * height);
  for (let row = 0; row < height; row += 1) {
    const sourceStart = row * paddedBytesPerRow;
    pixels.set(
      mapped.subarray(sourceStart, sourceStart + unpaddedBytesPerRow),
      row * unpaddedBytesPerRow
    );
  }
  return pixels;
};

export const mapGpuBufferCopy = async (buffer: GPUBuffer) => {
  await buffer.mapAsync(GPUMapMode.READ);
  try {
    return buffer.getMappedRange().slice(0);
  } finally {
    buffer.unmap();
  }
};

export const readRgba8Texture = async (
  device: GPUDevice,
  texture: GPUTexture,
  width: number,
  height: number,
  label = 'LightTable RGBA8 texture readback'
) => {
  const bytesPerPixel = 4;
  const unpaddedBytesPerRow = width * bytesPerPixel;
  const bytesPerRow = alignGpuBytesPerRow(unpaddedBytesPerRow);
  const readBuffer = device.createBuffer({
    label,
    size: bytesPerRow * height,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
  });

  try {
    const encoder = device.createCommandEncoder({ label });
    encoder.copyTextureToBuffer(
      { texture },
      { buffer: readBuffer, bytesPerRow, rowsPerImage: height },
      [width, height]
    );
    device.queue.submit([encoder.finish()]);
    const mapped = new Uint8Array(await mapGpuBufferCopy(readBuffer));
    return stripTextureRowPadding(mapped, width, height, bytesPerPixel, bytesPerRow);
  } finally {
    if (readBuffer.mapState === 'mapped') readBuffer.unmap();
    readBuffer.destroy();
  }
};

export const readRgba8TexturePixel = async (
  device: GPUDevice,
  texture: GPUTexture,
  x: number,
  y: number,
  label = 'LightTable RGBA8 pixel readback'
) => {
  const bytesPerRow = GPU_COPY_BYTES_PER_ROW_ALIGNMENT;
  const readBuffer = device.createBuffer({
    label,
    size: bytesPerRow,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
  });
  try {
    const encoder = device.createCommandEncoder({ label });
    encoder.copyTextureToBuffer(
      { texture, origin: { x, y } },
      { buffer: readBuffer, bytesPerRow, rowsPerImage: 1 },
      [1, 1]
    );
    device.queue.submit([encoder.finish()]);
    const mapped = new Uint8Array(await mapGpuBufferCopy(readBuffer));
    return [mapped[0]!, mapped[1]!, mapped[2]!, mapped[3]!] as const;
  } finally {
    if (readBuffer.mapState === 'mapped') readBuffer.unmap();
    readBuffer.destroy();
  }
};

/**
 * Browser-backed encoder kept behind one function so the desktop host can
 * replace it with a native/precision-preserving codec without touching the
 * renderer or document model.
 */
export const encodeRgba8Png = async (
  pixels: Uint8ClampedArray,
  width: number,
  height: number
) => {
  const worker = getPngWorker();
  if (worker) {
    const id = ++pngWorkerSequence;
    const result = new Promise<Blob>((resolve, reject) => {
      pendingPngEncodings.set(id, { resolve, reject });
    });
    worker.postMessage({ id, width, height, pixels: pixels.buffer }, [pixels.buffer]);
    return result;
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('PNG encoder canvas could not be created.');
  // ImageData's DOM type intentionally rejects SharedArrayBuffer-backed views.
  // Copy into an owned ArrayBuffer so web and Electron follow the same path.
  const imagePixels = new Uint8ClampedArray(pixels.length);
  imagePixels.set(pixels);
  context.putImageData(new ImageData(imagePixels, width, height), 0, 0);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (result) => result ? resolve(result) : reject(new Error('PNG encoding failed.')),
      'image/png'
    );
  });
};
