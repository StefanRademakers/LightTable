import { parseCubeLut, type ParsedCubeLut } from './colorLookupCube';

const PROFILE_GRID_SIZE = 17;
const align4 = (value: number) => (value + 3) & ~3;

const ascii = (value: string) => new TextEncoder().encode(value);
const writeAscii = (target: Uint8Array, offset: number, value: string) => {
  target.set(ascii(value), offset);
};
const writeU16 = (target: Uint8Array, offset: number, value: number) => {
  new DataView(target.buffer, target.byteOffset, target.byteLength).setUint16(offset, value, false);
};
const writeU32 = (target: Uint8Array, offset: number, value: number) => {
  new DataView(target.buffer, target.byteOffset, target.byteLength).setUint32(offset, value, false);
};
const writeFloat = (target: Uint8Array, offset: number, value: number) => {
  new DataView(target.buffer, target.byteOffset, target.byteLength).setFloat32(offset, value, false);
};

const multiLocalizedUnicode = (value: string): Uint8Array => {
  const encoded = new Uint8Array(value.length * 2);
  value.split('').forEach((character, index) => writeU16(encoded, index * 2, character.charCodeAt(0)));
  const result = new Uint8Array(align4(28 + encoded.length));
  writeAscii(result, 0, 'mluc');
  writeU32(result, 8, 1);
  writeU32(result, 12, 12);
  writeAscii(result, 16, 'enUS');
  writeU32(result, 20, encoded.length);
  writeU32(result, 24, 28);
  result.set(encoded, 28);
  return result;
};

const profileSequence = (): Uint8Array => {
  const result = new Uint8Array(116);
  writeAscii(result, 0, 'pseq');
  writeU32(result, 8, 2);
  for (const record of [12, 64]) {
    writeAscii(result, record, 'LTBL');
    writeAscii(result, record + 4, 'LUT ');
    writeAscii(result, record + 16, 'fscn');
    writeAscii(result, record + 20, 'mluc');
    writeU32(result, record + 32, 12);
    writeAscii(result, record + 36, 'mluc');
    writeU32(result, record + 48, 12);
  }
  return result;
};

const sampleCube = (lut: ParsedCubeLut, input: readonly [number, number, number]) => {
  const position = input.map((value, channel) => Math.max(0, Math.min(1,
    (value - lut.domainMin[channel]!) / (lut.domainMax[channel]! - lut.domainMin[channel]!))))
    .map((value) => value * (lut.size - 1));
  const lower = position.map(Math.floor);
  const upper = lower.map((value) => Math.min(value + 1, lut.size - 1));
  const fraction = position.map((value, channel) => value - lower[channel]!);
  const value = (red: number, green: number, blue: number, channel: number) =>
    lut.values[((blue * lut.size * lut.size + green * lut.size + red) * 3) + channel]!;
  return [0, 1, 2].map((channel) => {
    const z0y0 = value(lower[0]!, lower[1]!, lower[2]!, channel)
      * (1 - fraction[0]!) + value(upper[0]!, lower[1]!, lower[2]!, channel) * fraction[0]!;
    const z0y1 = value(lower[0]!, upper[1]!, lower[2]!, channel)
      * (1 - fraction[0]!) + value(upper[0]!, upper[1]!, lower[2]!, channel) * fraction[0]!;
    const z1y0 = value(lower[0]!, lower[1]!, upper[2]!, channel)
      * (1 - fraction[0]!) + value(upper[0]!, lower[1]!, upper[2]!, channel) * fraction[0]!;
    const z1y1 = value(lower[0]!, upper[1]!, upper[2]!, channel)
      * (1 - fraction[0]!) + value(upper[0]!, upper[1]!, upper[2]!, channel) * fraction[0]!;
    const z0 = z0y0 * (1 - fraction[1]!) + z0y1 * fraction[1]!;
    const z1 = z1y0 * (1 - fraction[1]!) + z1y1 * fraction[1]!;
    return z0 * (1 - fraction[2]!) + z1 * fraction[2]!;
  });
};

const multiProcessClut = (lut: ParsedCubeLut): Uint8Array => {
  const sampleCount = PROFILE_GRID_SIZE ** 3;
  const elementLength = 28 + sampleCount * 3 * Float32Array.BYTES_PER_ELEMENT;
  const result = new Uint8Array(24 + elementLength);
  writeAscii(result, 0, 'mpet');
  writeU16(result, 8, 3);
  writeU16(result, 10, 3);
  writeU32(result, 12, 1);
  writeU32(result, 16, 24);
  writeU32(result, 20, elementLength);
  writeAscii(result, 24, 'clut');
  writeU16(result, 32, 3);
  writeU16(result, 34, 3);
  result[36] = PROFILE_GRID_SIZE;
  result[37] = PROFILE_GRID_SIZE;
  result[38] = PROFILE_GRID_SIZE;
  let offset = 52;
  // ICC CLUT traversal changes the final input channel fastest. Photoshop's
  // descriptor labels this BGR table order, while .cube changes red fastest.
  for (let red = 0; red < PROFILE_GRID_SIZE; red += 1) {
    for (let green = 0; green < PROFILE_GRID_SIZE; green += 1) {
      for (let blue = 0; blue < PROFILE_GRID_SIZE; blue += 1) {
        for (const value of sampleCube(lut, [
          red / (PROFILE_GRID_SIZE - 1),
          green / (PROFILE_GRID_SIZE - 1),
          blue / (PROFILE_GRID_SIZE - 1)
        ])) {
          writeFloat(result, offset, value);
          offset += 4;
        }
      }
    }
  }
  return result;
};

/** Builds the ICC v4 DeviceLink payload Photoshop requires to render an embedded .cube LUT. */
export const createColorLookupDeviceLinkProfile = (cube: Uint8Array): Uint8Array => {
  const lut = parseCubeLut(new TextDecoder().decode(cube));
  const tags = [
    { signature: 'desc', data: multiLocalizedUnicode(lut.title ?? 'LightTable Color Lookup') },
    { signature: 'cprt', data: multiLocalizedUnicode('Copyright MediaVibe') },
    { signature: 'pseq', data: profileSequence() },
    { signature: 'D2B0', data: multiProcessClut(lut) }
  ];
  const tableLength = 4 + tags.length * 12;
  let cursor = align4(128 + tableLength);
  const placements = tags.map((tag) => {
    const placement = { ...tag, offset: cursor };
    cursor += align4(tag.data.length);
    return placement;
  });
  const profile = new Uint8Array(cursor);
  writeU32(profile, 0, profile.length);
  writeAscii(profile, 4, 'LTBL');
  writeU32(profile, 8, 0x04000000);
  writeAscii(profile, 12, 'link');
  writeAscii(profile, 16, 'RGB ');
  writeAscii(profile, 20, 'RGB ');
  writeU16(profile, 24, 2026);
  writeU16(profile, 26, 1);
  writeU16(profile, 28, 1);
  writeAscii(profile, 36, 'acsp');
  writeAscii(profile, 40, 'MSFT');
  writeU32(profile, 64, 0);
  writeU32(profile, 68, 0x0000f6d6);
  writeU32(profile, 72, 0x00010000);
  writeU32(profile, 76, 0x0000d32d);
  writeAscii(profile, 80, 'LTBL');
  writeU32(profile, 128, placements.length);
  placements.forEach((tag, index) => {
    const entry = 132 + index * 12;
    writeAscii(profile, entry, tag.signature);
    writeU32(profile, entry + 4, tag.offset);
    writeU32(profile, entry + 8, tag.data.length);
    profile.set(tag.data, tag.offset);
  });
  return profile;
};
