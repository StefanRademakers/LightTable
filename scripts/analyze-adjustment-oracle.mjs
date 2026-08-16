import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import sharp from 'sharp';

const argument = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};
const root = path.resolve(argument(
  'root', 'D:\\mediavibe\\LightTableTests\\AdjustmentParity\\exposure'
));
const sourcePath = path.resolve(argument(
  'source', 'D:\\mediavibe\\LightTableTests\\ToneBrush\\source\\grayscale-ramp.png'
));
const manifestText = await readFile(path.join(root, 'photoshop-manifest.json'), 'utf8');
const manifest = JSON.parse(manifestText.replace(/^\uFEFF/u, ''));
const source = await sharp(sourcePath).removeAlpha().raw().toBuffer({ resolveWithObject: true });

const decodeSrgb = (value) => value <= 0.04045
  ? value / 12.92
  : ((value + 0.055) / 1.055) ** 2.4;
const encodeSrgb = (value) => value <= 0.0031308
  ? value * 12.92
  : 1.055 * value ** (1 / 2.4) - 0.055;
const clamp = (value) => Math.max(0, Math.min(1, value));
const evaluate = (input, settings, space) => {
  if (space === 'photoshop-22') {
    const working = input ** 2.2;
    const exposed = Math.max(0, working * 2 ** settings.exposure + settings.offset);
    const encoded = exposed ** (1 / 2.2);
    return clamp(Math.max(0, encoded) ** (1 / Math.max(settings.gamma, 0.01)));
  }
  const working = space === 'linear' ? decodeSrgb(input) : input;
  const exposed = working * 2 ** settings.exposure + settings.offset;
  const adjusted = Math.max(0, exposed) ** (1 / Math.max(settings.gamma, 0.01));
  return clamp(space === 'linear' ? encodeSrgb(adjusted) : adjusted);
};
const candidates = ['linear', 'encoded', 'photoshop-22'];
const report = [];
for (const entry of manifest.filter(({ status }) => status === 'captured')) {
  const photoshop = await sharp(entry.file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  if (photoshop.info.width !== source.info.width || photoshop.info.height !== source.info.height) {
    throw new Error(`${entry.id} dimensions differ from the source.`);
  }
  const sampleY = Math.floor(source.info.height / 2);
  const metrics = {};
  for (const candidate of candidates) {
    let squaredError = 0;
    let absoluteError = 0;
    let maximumError = 0;
    const curve = [];
    for (let input = 0; input <= 255; input += 1) {
      const x = Math.round(input / 255 * (source.info.width - 1));
      const offset = (sampleY * source.info.width + x) * 3;
      const sourceValue = source.data[offset] / 255;
      const expected = photoshop.data[offset] / 255;
      const actual = evaluate(sourceValue, entry, candidate);
      const error = actual - expected;
      squaredError += error * error;
      absoluteError += Math.abs(error);
      maximumError = Math.max(maximumError, Math.abs(error));
      curve.push({ input, expected, actual, error });
    }
    metrics[candidate] = {
      rmse: Math.sqrt(squaredError / 256),
      mae: absoluteError / 256,
      maximumError,
      curve
    };
  }
  report.push({ ...entry, metrics });
}

const summary = Object.fromEntries(candidates.map((candidate) => {
  const values = report.map(({ metrics }) => metrics[candidate]);
  return [candidate, {
    meanRmse: values.reduce((sum, value) => sum + value.rmse, 0) / values.length,
    worstRmse: Math.max(...values.map(({ rmse }) => rmse)),
    worstCase: report[values.findIndex(({ rmse }) => rmse === Math.max(...values.map((value) => value.rmse)))].id
  }];
}));
await writeFile(path.join(root, 'analysis.json'), `${JSON.stringify({
  schema: 1, adjustment: 'exposure', photoshopVersion: '27.11.0', source: sourcePath,
  parameterCoverage: 'neutral, small, mid, 80 percent and endpoint extremes', summary, cases: report
}, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ summary, cases: report.map(({ id, metrics }) => ({
  id,
  linearRmse: Number(metrics.linear.rmse.toFixed(6)),
  encodedRmse: Number(metrics.encoded.rmse.toFixed(6)),
  photoshop22Rmse: Number(metrics['photoshop-22'].rmse.toFixed(6))
})) }, null, 2)}\n`);
