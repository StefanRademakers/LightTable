export const normalizedFloatToHalf = (input: number) => {
  const value = Math.max(0, Math.min(1, Number.isFinite(input) ? input : 0));
  if (value === 0) return 0;
  const exponent = Math.floor(Math.log2(value));
  let biasedExponent = exponent + 15;
  if (biasedExponent <= 0) return Math.max(1, Math.min(0x03ff, Math.round(value * 16_777_216)));
  let mantissa = Math.round((value / (2 ** exponent) - 1) * 1024);
  if (mantissa === 1024) {
    mantissa = 0;
    biasedExponent += 1;
  }
  return (Math.min(30, biasedExponent) << 10) | Math.min(0x03ff, mantissa);
};

export const normalizedDepthToHalf = (depth: Float32Array) => {
  const result = new Uint16Array(depth.length);
  for (let index = 0; index < depth.length; index += 1) result[index] = normalizedFloatToHalf(depth[index]);
  return result;
};
