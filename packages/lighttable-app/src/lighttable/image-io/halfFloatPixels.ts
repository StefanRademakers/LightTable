/** Converts clamped display-encoded IEEE-754 half floats into unsigned 16-bit samples. */
export const halfFloatToNormalizedU16 = (input: Uint16Array): Uint16Array => {
  const output = new Uint16Array(input.length);
  for (let index = 0; index < input.length; index += 1) {
    const bits = input[index]!;
    const sign = bits >>> 15;
    const exponent = (bits >>> 10) & 0x1f;
    const mantissa = bits & 0x03ff;
    let value: number;
    if (sign) value = 0;
    else if (exponent === 0) value = mantissa * 2 ** -24;
    else if (exponent === 0x1f) value = mantissa === 0 ? 1 : 0;
    else value = (1 + mantissa / 1024) * 2 ** (exponent - 15);
    output[index] = Math.round(Math.max(0, Math.min(1, value)) * 65535);
  }
  return output;
};
