import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const root = path.resolve(process.argv.find((value) => value.startsWith('--root='))?.slice(7)
  ?? 'D:\\mediavibe\\LightTableTests\\GradeCameraRawCorpus');
const inventory = JSON.parse(await readFile(path.join(root, 'inventory.json'), 'utf8'));
const channels = new Map([['red-s-curve', 0], ['green-s-curve', 1], ['blue-s-curve', 2]]);
const points = [[0, 0], [64 / 255, 32 / 255], [192 / 255, 224 / 255], [1, 1]];

const slopes = (() => {
  const interval = points.slice(1).map((point, index) => point[0] - points[index][0]);
  const delta = interval.map((width, index) => (points[index + 1][1] - points[index][1]) / width);
  const output = new Array(points.length).fill(0);
  for (let index = 1; index < points.length - 1; index += 1) {
    if (Math.sign(delta[index - 1]) !== Math.sign(delta[index])) continue;
    const a = 2 * interval[index] + interval[index - 1];
    const b = interval[index] + 2 * interval[index - 1];
    output[index] = (a + b) / (a / delta[index - 1] + b / delta[index]);
  }
  const endpoint = (h0, h1, d0, d1) => {
    let value = ((2 * h0 + h1) * d0 - h0 * d1) / (h0 + h1);
    if (Math.sign(value) !== Math.sign(d0)) value = 0;
    else if (Math.sign(d0) !== Math.sign(d1) && Math.abs(value) > Math.abs(3 * d0)) value = 3 * d0;
    return value;
  };
  output[0] = endpoint(interval[0], interval[1], delta[0], delta[1]);
  output[output.length - 1] = endpoint(interval.at(-1), interval.at(-2), delta.at(-1), delta.at(-2));
  return output;
})();
const curve = (value) => {
  const x = Math.max(0, Math.min(1, value));
  let index = 0;
  while (index < points.length - 2 && x > points[index + 1][0]) index += 1;
  const left = points[index]; const right = points[index + 1];
  const width = right[0] - left[0]; const t = (x - left[0]) / width;
  const t2 = t * t; const t3 = t2 * t;
  return Math.max(0, Math.min(1, (2 * t3 - 3 * t2 + 1) * left[1]
    + (t3 - 2 * t2 + t) * width * slopes[index]
    + (-2 * t3 + 3 * t2) * right[1]
    + (t3 - t2) * width * slopes[index + 1]));
};
const multiply = (a, b) => a.map((row) => b[0].map((_, column) => row.reduce((sum, value, index) => sum + value * b[index][column], 0)));
const vector = (matrix, value) => matrix.map((row) => row.reduce((sum, item, index) => sum + item * value[index], 0));
const inverse = (m) => {
  const [a, b, c] = m[0]; const [d, e, f] = m[1]; const [g, h, i] = m[2];
  const determinant = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  return [[e * i - f * h, c * h - b * i, b * f - c * e], [f * g - d * i, a * i - c * g, c * d - a * f], [d * h - e * g, b * g - a * h, a * e - b * d]].map((row) => row.map((value) => value / determinant));
};
const srgbToXyzD65 = [[0.4124564, 0.3575761, 0.1804375], [0.2126729, 0.7151522, 0.072175], [0.0193339, 0.119192, 0.9503041]];
const d65ToD50 = [[1.0479298, 0.0229468, -0.0501922], [0.0296278, 0.9904345, -0.0170738], [-0.009243, 0.0150552, 0.7518743]];
const xyzD50ToProPhoto = [[1.3459433, -0.2556075, -0.0511118], [-0.5445989, 1.5081673, 0.0205351], [0, 0, 1.2118128]];
const srgbToProPhoto = multiply(xyzD50ToProPhoto, multiply(d65ToD50, srgbToXyzD65));
const proPhotoToSrgb = inverse(srgbToProPhoto);
const decode = (value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
const encode = (value) => value <= 0.0031308 ? value * 12.92 : 1.055 * Math.max(value, 0) ** (1 / 2.4) - 0.055;
const signedPower = (value, exponent) => Math.sign(value) * Math.abs(value) ** exponent;
const candidates = {
  'encoded-srgb': (rgb, channel) => rgb.map((value, index) => index === channel ? curve(value) : value),
  'prophoto-srgb-trc': (rgb, channel) => {
    const working = vector(srgbToProPhoto, rgb.map(decode));
    working[channel] = decode(curve(encode(working[channel])));
    return vector(proPhotoToSrgb, working).map(encode);
  },
  'prophoto-gamma-1.8': (rgb, channel) => {
    const working = vector(srgbToProPhoto, rgb.map(decode));
    working[channel] = signedPower(curve(signedPower(working[channel], 1 / 1.8)), 1.8);
    return vector(proPhotoToSrgb, working).map(encode);
  }
};
const load = (file) => sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const totals = Object.fromEntries(Object.keys(candidates).map((key) => [key, { squared: 0, dot: 0, target: 0, predicted: 0, samples: 0 }]));
const sources = [];
for (const source of inventory.sources) {
  const directory = path.join(root, 'captures', 'curves', source.id, 'camera-raw');
  const neutral = await load(path.join(directory, 'neutral.png'));
  const stride = Math.max(1, Math.ceil((neutral.info.width * neutral.info.height) / 200_000));
  const sourceResult = { id: source.id, candidates: {} };
  for (const [caseId, channel] of channels) {
    const target = await load(path.join(directory, `${caseId}.png`));
    for (const [name, transform] of Object.entries(candidates)) {
      const metric = { squared: 0, dot: 0, target: 0, predicted: 0, samples: 0 };
      for (let pixel = 0; pixel < neutral.info.width * neutral.info.height; pixel += stride) {
        const offset = pixel * 3;
        const rgb = [neutral.data[offset], neutral.data[offset + 1], neutral.data[offset + 2]].map((value) => value / 255);
        const predicted = transform(rgb, channel);
        for (let component = 0; component < 3; component += 1) {
          const expectedDelta = target.data[offset + component] / 255 - rgb[component];
          const predictedDelta = predicted[component] - rgb[component];
          metric.squared += (expectedDelta - predictedDelta) ** 2;
          metric.dot += expectedDelta * predictedDelta;
          metric.target += expectedDelta ** 2; metric.predicted += predictedDelta ** 2; metric.samples += 1;
        }
      }
      const total = totals[name];
      for (const key of Object.keys(metric)) total[key] += metric[key];
      sourceResult.candidates[`${caseId}:${name}`] = {
        correlation: metric.dot / Math.sqrt(metric.target * metric.predicted),
        magnitudeRatio: Math.sqrt(metric.predicted / metric.target),
        rmse: Math.sqrt(metric.squared / metric.samples)
      };
    }
  }
  sources.push(sourceResult);
}
const summarize = (metric) => ({ correlation: metric.dot / Math.sqrt(metric.target * metric.predicted), magnitudeRatio: Math.sqrt(metric.predicted / metric.target), rmse: Math.sqrt(metric.squared / metric.samples) });
const report = { schema: 1, generatedAt: new Date().toISOString(), note: 'Research-only model comparison against Camera Raw neutral output; sampled to at most 200k pixels per source and channel case.', aggregate: Object.fromEntries(Object.entries(totals).map(([name, metric]) => [name, summarize(metric)])), sources };
await writeFile(path.join(root, 'curves-working-space-analysis.json'), `${JSON.stringify(report, null, 2)}\n`);
for (const [name, metric] of Object.entries(report.aggregate)) console.log(name, metric);
