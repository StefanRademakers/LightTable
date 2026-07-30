export type Rgb = readonly [number, number, number];
export type Oklab = readonly [number, number, number];

const signedCubeRoot = (value: number) => Math.sign(value) * Math.cbrt(Math.abs(value));

export const srgbChannelToLinear = (value: number) => (
  value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
);

export const linearChannelToSrgb = (value: number) => (
  value <= 0.0031308 ? value * 12.92 : 1.055 * Math.max(value, 0) ** (1 / 2.4) - 0.055
);

export const srgbToLinear = (rgb: Rgb): Rgb => rgb.map(srgbChannelToLinear) as unknown as Rgb;
export const linearToSrgb = (rgb: Rgb): Rgb => rgb.map(linearChannelToSrgb) as unknown as Rgb;

export const linearRgbToOklab = ([r, g, b]: Rgb): Oklab => {
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  const lRoot = signedCubeRoot(l);
  const mRoot = signedCubeRoot(m);
  const sRoot = signedCubeRoot(s);
  return [
    0.2104542553 * lRoot + 0.793617785 * mRoot - 0.0040720468 * sRoot,
    1.9779984951 * lRoot - 2.428592205 * mRoot + 0.4505937099 * sRoot,
    0.0259040371 * lRoot + 0.7827717662 * mRoot - 0.808675766 * sRoot
  ];
};

export const oklabToLinearRgb = ([l, a, b]: Oklab): Rgb => {
  const lRoot = l + 0.3963377774 * a + 0.2158037573 * b;
  const mRoot = l - 0.1055613458 * a - 0.0638541728 * b;
  const sRoot = l - 0.0894841775 * a - 1.291485548 * b;
  const ll = lRoot ** 3;
  const mm = mRoot ** 3;
  const ss = sRoot ** 3;
  return [
    4.0767416621 * ll - 3.3077115913 * mm + 0.2309699292 * ss,
    -1.2684380046 * ll + 2.6097574011 * mm - 0.3413193965 * ss,
    -0.0041960863 * ll - 0.7034186147 * mm + 1.707614701 * ss
  ];
};

export const applyExposure = (rgb: Rgb, exposureEV: number): Rgb => {
  const multiplier = 2 ** exposureEV;
  return rgb.map((value) => value * multiplier) as unknown as Rgb;
};

/** CPU reference for the shader's continuously-sized highlight shoulder. */
export const applyDisplayShoulder = (value: number, strength: number) => {
  const safeValue = Math.max(value, 0);
  const safeStrength = Math.min(Math.max(strength, 0), 1);
  if (safeStrength <= 1e-8) return safeValue;
  const headroom = 0.28 * safeStrength ** 0.65;
  const knee = 1 - headroom;
  if (safeValue <= knee) return safeValue;
  const distance = safeValue - knee;
  return knee + (headroom * distance) / (distance + headroom);
};

export const isFiniteRgb = (rgb: Rgb) => rgb.every(Number.isFinite);
