const PNG_SIGNATURE_SIZE = 8;
const PNG_CHUNK_OVERHEAD = 12;
const PHYS_CHUNK_TYPE = new Uint8Array([0x70, 0x48, 0x59, 0x73]);

const writeUint32 = (target: Uint8Array, offset: number, value: number): void => {
  new DataView(target.buffer, target.byteOffset, target.byteLength)
    .setUint32(offset, value >>> 0, false);
};

const crc32 = (bytes: Uint8Array): number => {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
};

/** Adds the PNG pHYs chunk immediately after IHDR without re-encoding pixels. */
const addResolutionMetadata = (png: Uint8Array, pixelsPerInch: number): Uint8Array => {
  const ihdrLength = new DataView(png.buffer, png.byteOffset, png.byteLength)
    .getUint32(PNG_SIGNATURE_SIZE, false);
  const insertAt = PNG_SIGNATURE_SIZE + PNG_CHUNK_OVERHEAD + ihdrLength;
  const chunk = new Uint8Array(PNG_CHUNK_OVERHEAD + 9);
  writeUint32(chunk, 0, 9);
  chunk.set(PHYS_CHUNK_TYPE, 4);
  const pixelsPerMeter = Math.max(1, Math.round(pixelsPerInch / 0.0254));
  writeUint32(chunk, 8, pixelsPerMeter);
  writeUint32(chunk, 12, pixelsPerMeter);
  chunk[16] = 1;
  writeUint32(chunk, 17, crc32(chunk.subarray(4, 17)));

  const result = new Uint8Array(png.byteLength + chunk.byteLength);
  result.set(png.subarray(0, insertAt), 0);
  result.set(chunk, insertAt);
  result.set(png.subarray(insertAt), insertAt + chunk.byteLength);
  return result;
};

const canvasToPng = (canvas: HTMLCanvasElement): Promise<Blob> =>
  new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('LightTable could not create the blank document.'));
    }, 'image/png');
  });

export interface BlankPngDocumentOptions {
  width: number;
  height: number;
  resolutionPpi: number;
  name?: string;
  backgroundColor?: string | null;
}

export const createBlankPngFile = async ({
  width,
  height,
  resolutionPpi,
  name = 'Untitled.png',
  backgroundColor = null
}: BlankPngDocumentOptions): Promise<File> => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  if (backgroundColor) {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('LightTable could not create the document background.');
    context.fillStyle = backgroundColor;
    context.fillRect(0, 0, width, height);
  }
  const png = new Uint8Array(await (await canvasToPng(canvas)).arrayBuffer());
  const encoded = addResolutionMetadata(png, resolutionPpi);
  return new File([Uint8Array.from(encoded).buffer], name, {
    type: 'image/png',
    lastModified: Date.now()
  });
};
