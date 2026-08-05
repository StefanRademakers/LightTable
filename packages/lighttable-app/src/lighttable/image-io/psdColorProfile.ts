export interface PsdColorProfileInfo {
  readonly disposition: 'untagged' | 'embedded';
  readonly name: string | null;
  readonly bytes: Uint8Array | null;
}

const text = (bytes: Uint8Array, offset: number, length: number) =>
  String.fromCharCode(...bytes.subarray(offset, offset + length));

const uint16 = (view: DataView, offset: number) => view.getUint16(offset, false);
const uint32 = (view: DataView, offset: number) => view.getUint32(offset, false);

const iccDescription = (profile: Uint8Array): string | null => {
  if (profile.byteLength < 132) return null;
  const view = new DataView(profile.buffer, profile.byteOffset, profile.byteLength);
  const count = uint32(view, 128);
  if (count > 4096 || 132 + count * 12 > profile.byteLength) return null;
  for (let index = 0; index < count; index += 1) {
    const record = 132 + index * 12;
    if (text(profile, record, 4) !== 'desc') continue;
    const offset = uint32(view, record + 4);
    const size = uint32(view, record + 8);
    if (offset + size > profile.byteLength || size < 12) return null;
    const type = text(profile, offset, 4);
    if (type === 'desc') {
      const length = uint32(view, offset + 8);
      if (length < 1 || offset + 12 + length > profile.byteLength) return null;
      return text(profile, offset + 12, length - 1).replace(/[\u0000-\u001f]+/g, ' ').trim() || null;
    }
    if (type === 'mluc' && size >= 28) {
      const records = uint32(view, offset + 8);
      const recordSize = uint32(view, offset + 12);
      if (!records || recordSize < 12 || offset + 16 + records * recordSize > profile.byteLength) return null;
      const first = offset + 16;
      const length = uint32(view, first + 4);
      const relativeOffset = uint32(view, first + 8);
      if (length % 2 || relativeOffset + length > size) return null;
      let result = '';
      for (let cursor = offset + relativeOffset; cursor < offset + relativeOffset + length; cursor += 2) {
        result += String.fromCharCode(uint16(view, cursor));
      }
      return result.trim() || null;
    }
  }
  return null;
};

/** Reads only the bounded PSD image-resource directory; layer data is untouched. */
export const readPsdColorProfile = (buffer: ArrayBuffer): PsdColorProfileInfo => {
  const bytes = new Uint8Array(buffer);
  if (bytes.byteLength < 30 || text(bytes, 0, 4) !== '8BPS') {
    throw new Error('The Photoshop color-profile probe received an invalid PSD header.');
  }
  const view = new DataView(buffer);
  const colorModeLength = uint32(view, 26);
  const resourcesLengthOffset = 30 + colorModeLength;
  if (resourcesLengthOffset + 4 > bytes.byteLength) {
    throw new Error('The Photoshop color-mode data exceeds the source bounds.');
  }
  const resourcesLength = uint32(view, resourcesLengthOffset);
  let cursor = resourcesLengthOffset + 4;
  const end = cursor + resourcesLength;
  if (end > bytes.byteLength) throw new Error('The Photoshop image resources exceed the source bounds.');
  let profile: Uint8Array | null = null;
  let explicitlyUntagged = false;
  while (cursor + 12 <= end) {
    const signature = text(bytes, cursor, 4);
    if (signature !== '8BIM' && signature !== 'MeSa') break;
    const resourceId = uint16(view, cursor + 4);
    const nameLength = bytes[cursor + 6];
    const paddedNameLength = (1 + nameLength + 1) & ~1;
    const sizeOffset = cursor + 6 + paddedNameLength;
    if (sizeOffset + 4 > end) break;
    const size = uint32(view, sizeOffset);
    const dataOffset = sizeOffset + 4;
    if (dataOffset + size > end) break;
    if (resourceId === 1039) profile = bytes.slice(dataOffset, dataOffset + size);
    if (resourceId === 1041 && size > 0) explicitlyUntagged = bytes[dataOffset] !== 0;
    cursor = dataOffset + size + (size & 1);
  }
  if (!profile || explicitlyUntagged) {
    return { disposition: 'untagged', name: null, bytes: null };
  }
  return { disposition: 'embedded', name: iccDescription(profile), bytes: profile };
};
