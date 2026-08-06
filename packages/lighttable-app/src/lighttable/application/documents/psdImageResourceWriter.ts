const uint32 = (view: DataView, offset: number) => view.getUint32(offset, false);

/**
 * Adds one bounded 8BIM image resource without re-encoding layer data.
 * ag-psd does not currently expose ICC resource 1039 in production builds.
 */
export const appendPsdImageResource = (
  source: Uint8Array,
  resourceId: number,
  payload: Uint8Array
) => {
  if (source.byteLength < 34 || String.fromCharCode(...source.subarray(0, 4)) !== '8BPS') {
    throw new Error('Cannot append an image resource to an invalid PSD.');
  }
  if (!Number.isInteger(resourceId) || resourceId < 0 || resourceId > 0xffff) {
    throw new Error('PSD image resource identifiers are unsigned 16-bit values.');
  }
  const sourceView = new DataView(source.buffer, source.byteOffset, source.byteLength);
  const colorModeLength = uint32(sourceView, 26);
  const resourceLengthOffset = 30 + colorModeLength;
  if (resourceLengthOffset + 4 > source.byteLength) {
    throw new Error('The PSD color-mode section exceeds the file bounds.');
  }
  const resourceLength = uint32(sourceView, resourceLengthOffset);
  const resourceStart = resourceLengthOffset + 4;
  const resourceEnd = resourceStart + resourceLength;
  if (resourceEnd > source.byteLength) {
    throw new Error('The PSD image-resource section exceeds the file bounds.');
  }
  const paddedPayloadLength = payload.byteLength + (payload.byteLength & 1);
  const recordLength = 12 + paddedPayloadLength;
  const output = new Uint8Array(source.byteLength + recordLength);
  output.set(source.subarray(0, resourceStart), 0);
  const outputView = new DataView(output.buffer);
  outputView.setUint32(resourceLengthOffset, resourceLength + recordLength, false);
  let cursor = resourceStart;
  output.set([0x38, 0x42, 0x49, 0x4d], cursor); cursor += 4;
  outputView.setUint16(cursor, resourceId, false); cursor += 2;
  // Empty Pascal name plus its even-byte padding.
  output[cursor] = 0; output[cursor + 1] = 0; cursor += 2;
  outputView.setUint32(cursor, payload.byteLength, false); cursor += 4;
  output.set(payload, cursor); cursor += paddedPayloadLength;
  output.set(source.subarray(resourceStart), cursor);
  return output;
};
