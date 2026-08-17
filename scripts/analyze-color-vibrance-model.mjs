import path from 'node:path';
import process from 'node:process';
import sharp from 'sharp';

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index], process.argv[index + 1]);
}

const root = args.get('--root');
const sourcePath = args.get('--source');
if (!root || !sourcePath) {
  throw new Error('Usage: node scripts/analyze-color-vibrance-model.mjs --root <oracle-root> --source <source.png>');
}

const CASES = [
  ['temperature-neg-100', -100, 0, 0, 0], ['temperature-neg-80', -80, 0, 0, 0],
  ['temperature-neg-20', -20, 0, 0, 0], ['temperature-pos-20', 20, 0, 0, 0],
  ['temperature-pos-80', 80, 0, 0, 0], ['temperature-pos-100', 100, 0, 0, 0],
  ['tint-neg-100', 0, -100, 0, 0], ['tint-neg-80', 0, -80, 0, 0],
  ['tint-neg-20', 0, -20, 0, 0], ['tint-pos-20', 0, 20, 0, 0],
  ['tint-pos-80', 0, 80, 0, 0], ['tint-pos-100', 0, 100, 0, 0],
  ['vibrance-neg-100', 0, 0, -100, 0], ['vibrance-neg-80', 0, 0, -80, 0],
  ['vibrance-neg-20', 0, 0, -20, 0], ['vibrance-pos-20', 0, 0, 20, 0],
  ['vibrance-pos-80', 0, 0, 80, 0], ['vibrance-pos-100', 0, 0, 100, 0],
  ['saturation-neg-100', 0, 0, 0, -100], ['saturation-neg-80', 0, 0, 0, -80],
  ['saturation-neg-20', 0, 0, 0, -20], ['saturation-pos-20', 0, 0, 0, 20],
  ['saturation-pos-80', 0, 0, 0, 80], ['saturation-pos-100', 0, 0, 0, 100],
  ['combined-negative-80', -80, -80, -80, -80],
  ['combined-positive-80', 80, 80, 80, 80]
];

const multiply = (matrix, vector) => matrix.map((row) => (
  row[0] * vector[0] + row[1] * vector[1] + row[2] * vector[2]
));
const clamp = (value, minimum = 0, maximum = 1) => Math.max(minimum, Math.min(maximum, value));
const smoothstep = (minimum, maximum, value) => {
  const amount = clamp((value - minimum) / (maximum - minimum));
  return amount * amount * (3 - 2 * amount);
};
const srgbToLinear = (value) => value <= 0.04045
  ? value / 12.92
  : ((value + 0.055) / 1.055) ** 2.4;
const linearToSrgb = (value) => value <= 0.0031308
  ? value * 12.92
  : 1.055 * Math.max(value, 0) ** (1 / 2.4) - 0.055;

const RGB_TO_XYZ = [
  [0.4124564, 0.3575761, 0.1804375],
  [0.2126729, 0.7151522, 0.0721750],
  [0.0193339, 0.1191920, 0.9503041]
];
const XYZ_TO_RGB = [
  [3.2404542, -1.5371385, -0.4985314],
  [-0.9692660, 1.8760108, 0.0415560],
  [0.0556434, -0.2040259, 1.0572252]
];
const CAT16 = [
  [0.401288, 0.650173, -0.051461],
  [-0.250268, 1.204414, 0.045854],
  [-0.002079, 0.048952, 0.953127]
];
const INVERSE_CAT16 = [
  [1.862068, -1.011255, 0.149187],
  [0.387520, 0.621447, -0.008974],
  [-0.015841, -0.034123, 1.049964]
];

const temperatureSliderToCct = (temperature) => {
  const d65Mired = 1_000_000 / 6504;
  let targetMired = d65Mired;
  if (temperature > 0) {
    const amount = clamp(temperature / 100) ** 1.08;
    targetMired = d65Mired + (1_000_000 / 2500 - d65Mired) * amount;
  } else if (temperature < 0) {
    const amount = clamp(-temperature / 150) ** 1.08;
    targetMired = d65Mired + (1_000_000 / 20000 - d65Mired) * amount;
  }
  return 1_000_000 / targetMired;
};

const cctToChromaticity = (temperature) => {
  const t = clamp(temperature, 1667, 25000);
  let x;
  let y;
  if (t < 4000) {
    x = ((-0.2661239e9 / t - 0.2343589e6) / t + 0.8776956e3) / t + 0.179910;
    y = t <= 2222
      ? ((-1.1063814 * x - 1.34811020) * x + 2.18555832) * x - 0.20219683
      : ((-0.9549476 * x - 1.37418593) * x + 2.09137015) * x - 0.16748867;
  } else {
    x = t <= 7000
      ? ((-4.6070e9 / t + 2.9678e6) / t + 0.09911e3) / t + 0.244063
      : ((-2.0064e9 / t + 1.9018e6) / t + 0.24748e3) / t + 0.237040;
    y = (-3 * x + 2.87) * x - 0.275;
  }
  return [x, y];
};

const applyTintToChromaticity = (xy, cct, tint) => {
  const x = xy[0];
  const normalSlope = cct <= 2222
    ? (-3.3191442 * x - 2.69622040) * x + 2.18555832
    : cct <= 4000
      ? (-2.8648428 * x - 2.74837186) * x + 2.09137015
      : (9.2452740 * x - 11.7467734) * x + 3.75112997;
  const normalLength = Math.sqrt(1 + normalSlope * normalSlope);
  const offset = clamp(tint / 100, -1, 1) * 0.035;
  return [x + offset * normalSlope / normalLength, xy[1] - offset / normalLength];
};

const applyChromaticAdaptation = (rgb, temperature, tint) => {
  if (temperature === 0 && tint === 0) return rgb;
  const cct = temperatureSliderToCct(temperature);
  const xy = applyTintToChromaticity(cctToChromaticity(cct), cct, tint);
  const targetWhite = [xy[0] / xy[1], 1, (1 - xy[0] - xy[1]) / xy[1]];
  const sourceLms = multiply(CAT16, [0.95047, 1, 1.08883]);
  const targetLms = multiply(CAT16, targetWhite);
  const lms = multiply(CAT16, multiply(RGB_TO_XYZ, rgb));
  return multiply(XYZ_TO_RGB, multiply(INVERSE_CAT16, lms.map((value, index) => (
    value * targetLms[index] / sourceLms[index]
  ))));
};

const linearRgbToOklab = (rgb) => {
  const lms = multiply([
    [0.4122214708, 0.5363325363, 0.0514459929],
    [0.2119034982, 0.6806995451, 0.1073969566],
    [0.0883024619, 0.2817188376, 0.6299787005]
  ], rgb).map((value) => Math.sign(value) * Math.cbrt(Math.abs(value)));
  return multiply([
    [0.2104542553, 0.7936177850, -0.0040720468],
    [1.9779984951, -2.4285922050, 0.4505937099],
    [0.0259040371, 0.7827717662, -0.8086757660]
  ], lms);
};

const oklabToLinearRgb = (lab) => {
  const lms = multiply([
    [1, 0.3963377774, 0.2158037573],
    [1, -0.1055613458, -0.0638541728],
    [1, -0.0894841775, -1.2914855480]
  ], lab).map((value) => value ** 3);
  return multiply([
    [4.0767416621, -3.3077115913, 0.2309699292],
    [-1.2684380046, 2.6097574011, -0.3413193965],
    [-0.0041960863, -0.7034186147, 1.7076147010]
  ], lms);
};

const applyCurrentGradeModel = (rgb, temperature, tint, vibrance, saturation) => {
  const balanced = applyChromaticAdaptation(rgb, temperature, tint);
  if (vibrance === 0 && saturation === 0) return balanced;
  const lab = linearRgbToOklab(balanced);
  const chroma = Math.hypot(lab[1], lab[2]);
  const saturationScale = Math.max(0, 1 + saturation / 100);
  const lowChromaWeight = 1 - smoothstep(0.04, 0.32, chroma);
  const vibranceScale = Math.max(0, 1 + vibrance / 100 * (0.35 + lowChromaWeight * 0.75));
  const scale = saturationScale * vibranceScale;
  return oklabToLinearRgb([lab[0], lab[1] * scale, lab[2] * scale]);
};

const source = await sharp(sourcePath).removeAlpha().raw().toBuffer({ resolveWithObject: true });
console.log('Current native Grade model vs Photoshop Color and Vibrance');
for (const [name, temperature, tint, vibrance, saturation] of CASES) {
  const reference = await sharp(path.join(root, 'photoshop', `${name}.png`))
    .removeAlpha().raw().toBuffer();
  let squaredError = 0;
  let maximumError = 0;
  for (let offset = 0; offset < source.data.length; offset += 3) {
    const input = [0, 1, 2].map((channel) => srgbToLinear(source.data[offset + channel] / 255));
    const output = applyCurrentGradeModel(input, temperature, tint, vibrance, saturation)
      .map((value) => Math.round(clamp(linearToSrgb(value)) * 255));
    for (let channel = 0; channel < 3; channel += 1) {
      const error = output[channel] - reference[offset + channel];
      squaredError += error * error;
      maximumError = Math.max(maximumError, Math.abs(error));
    }
  }
  const rmse = Math.sqrt(squaredError / source.data.length) / 255 * 100;
  console.log(`${name.padEnd(24)} ${rmse.toFixed(3).padStart(7)}%  max ${maximumError}`);
}
