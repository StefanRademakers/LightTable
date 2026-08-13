const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
export const pngDimensions = (bytes) => {
  if (!Buffer.isBuffer(bytes) || bytes.length < 24 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw Object.assign(new Error('Expected a valid PNG image.'), { code: 'RESULT_INVALID' });
  }
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
};
