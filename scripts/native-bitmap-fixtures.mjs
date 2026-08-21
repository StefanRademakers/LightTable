import { deflateSync } from 'node:zlib';

const crcTable = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});

const crc32 = (bytes) => {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};

const pngChunk = (name, data) => {
  const type = Buffer.from(name, 'ascii');
  const body = Buffer.concat([type, data]);
  const result = Buffer.alloc(12 + data.length);
  result.writeUInt32BE(data.length, 0);
  body.copy(result, 4);
  result.writeUInt32BE(crc32(body), result.length - 4);
  return result;
};

export const createRgba16Png = (width, height) => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([16, 6, 0, 0, 0], 8);
  const rows = Buffer.alloc(height * (1 + width * 8));
  for (let y = 0; y < height; y += 1) {
    const row = y * (1 + width * 8);
    rows[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = row + 1 + x * 8;
      rows.writeUInt16BE(Math.round((x / Math.max(1, width - 1)) * 65535), offset);
      rows.writeUInt16BE(Math.round((y / Math.max(1, height - 1)) * 65535), offset + 2);
      rows.writeUInt16BE(32768, offset + 4);
      rows.writeUInt16BE(65535, offset + 6);
    }
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(rows)),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
};

export const createRgba16Tiff = (width, height) => {
  const entries = 11;
  const ifdOffset = 8;
  const arraysOffset = ifdOffset + 2 + entries * 12 + 4;
  const bitsOffset = arraysOffset;
  const sampleFormatOffset = bitsOffset + 8;
  const pixelOffset = sampleFormatOffset + 8;
  const pixelBytes = width * height * 8;
  const result = Buffer.alloc(pixelOffset + pixelBytes);
  result.write('II', 0, 'ascii');
  result.writeUInt16LE(42, 2);
  result.writeUInt32LE(ifdOffset, 4);
  result.writeUInt16LE(entries, ifdOffset);
  let entry = ifdOffset + 2;
  const writeEntry = (tag, type, count, value) => {
    result.writeUInt16LE(tag, entry);
    result.writeUInt16LE(type, entry + 2);
    result.writeUInt32LE(count, entry + 4);
    if (type === 3 && count === 1) result.writeUInt16LE(value, entry + 8);
    else result.writeUInt32LE(value, entry + 8);
    entry += 12;
  };
  writeEntry(256, 4, 1, width);
  writeEntry(257, 4, 1, height);
  writeEntry(258, 3, 4, bitsOffset);
  writeEntry(259, 3, 1, 1);
  writeEntry(262, 3, 1, 2);
  writeEntry(273, 4, 1, pixelOffset);
  writeEntry(277, 3, 1, 4);
  writeEntry(278, 4, 1, height);
  writeEntry(279, 4, 1, pixelBytes);
  writeEntry(284, 3, 1, 1);
  writeEntry(338, 3, 1, 1);
  result.writeUInt32LE(0, entry);
  for (let index = 0; index < 4; index += 1) {
    result.writeUInt16LE(16, bitsOffset + index * 2);
    result.writeUInt16LE(1, sampleFormatOffset + index * 2);
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = pixelOffset + (y * width + x) * 8;
      result.writeUInt16LE(Math.round((x / Math.max(1, width - 1)) * 65535), offset);
      result.writeUInt16LE(Math.round((y / Math.max(1, height - 1)) * 65535), offset + 2);
      result.writeUInt16LE(32768, offset + 4);
      result.writeUInt16LE(65535, offset + 6);
    }
  }
  return result;
};
