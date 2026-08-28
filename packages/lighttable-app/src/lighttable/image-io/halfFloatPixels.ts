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

/**
 * Converts normalized unsigned samples into IEEE-754 half-float bit patterns.
 *
 * Precision image ingest runs this in the codec worker. The resulting bytes
 * can be uploaded straight into LightTable's core rgba16float source texture,
 * without depending on the optional rgba16unorm WebGPU feature or allocating
 * a second full-size staging texture.
 */
export const normalizedU16ToHalfFloat = (input: Uint16Array): Uint16Array => {
  const output = new Uint16Array(input.length);
  const float = new Float32Array(1);
  const bits = new Uint32Array(float.buffer);
  for (let index = 0; index < input.length; index += 1) {
    float[0] = input[index]! / 65535;
    const value = bits[0]!;
    const exponent = (value >>> 23) & 0xff;
    const mantissa = value & 0x7fffff;
    const unbiasedExponent = exponent - 127;
    let half: number;
    if (unbiasedExponent < -24) {
      half = 0;
    } else if (unbiasedExponent < -14) {
      const shift = -unbiasedExponent - 14;
      const roundShift = shift + 13;
      half = ((mantissa | 0x800000) + (1 << (roundShift - 1))) >>> roundShift;
    } else if (unbiasedExponent > 15) {
      half = 0x7c00;
    } else {
      const roundedMantissa = mantissa + 0x1000;
      const carry = roundedMantissa > 0x7fffff ? 1 : 0;
      half = ((unbiasedExponent + 15 + carry) << 10)
        | ((roundedMantissa >>> 13) & 0x03ff);
    }
    output[index] = half;
  }
  return output;
};
