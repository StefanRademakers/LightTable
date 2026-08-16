import { access, readFile, writeFile } from 'node:fs/promises';
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
const adjustment = manifest[0]?.adjustment ?? 'exposure';
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
const candidates = adjustment === 'exposure' ? ['linear', 'encoded', 'photoshop-22'] : [];
const report = [];
const lightTableDirectory = path.join(root, 'lighttable');
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
  let rendered = null;
  const lightTablePath = path.join(lightTableDirectory, `${entry.id}.png`);
  const hasLightTableCapture = await access(lightTablePath).then(() => true).catch(() => false);
  if (hasLightTableCapture) {
    const lightTable = await sharp(lightTablePath)
      .removeAlpha().raw().toBuffer({ resolveWithObject: true });
    if (lightTable.info.width !== photoshop.info.width || lightTable.info.height !== photoshop.info.height) {
      throw new Error(`${entry.id} LightTable dimensions differ from Photoshop.`);
    }
    let squaredError = 0;
    let absoluteError = 0;
    let maximumError = 0;
    for (let index = 0; index < photoshop.data.length; index += 1) {
      const error = (lightTable.data[index] - photoshop.data[index]) / 255;
      squaredError += error * error;
      absoluteError += Math.abs(error);
      maximumError = Math.max(maximumError, Math.abs(error));
    }
    rendered = {
      rmse: Math.sqrt(squaredError / photoshop.data.length),
      mae: absoluteError / photoshop.data.length,
      maximumError
    };
  }
  report.push({ ...entry, metrics, rendered });
}

const summary = Object.fromEntries(candidates.map((candidate) => {
  const values = report.map(({ metrics }) => metrics[candidate]);
  return [candidate, {
    meanRmse: values.reduce((sum, value) => sum + value.rmse, 0) / values.length,
    worstRmse: Math.max(...values.map(({ rmse }) => rmse)),
    worstCase: report[values.findIndex(({ rmse }) => rmse === Math.max(...values.map((value) => value.rmse)))].id
  }];
}));
const renderedCases = report.filter(({ rendered }) => rendered);
const meanRenderedRmse = renderedCases.length
  ? renderedCases.reduce((sum, { rendered }) => sum + rendered.rmse, 0) / renderedCases.length
  : null;
const passingRenderedCases = renderedCases.filter(({ rendered }) => rendered.rmse <= 0.05).length;
const renderedSummary = meanRenderedRmse === null ? null : {
  meanRmse: meanRenderedRmse,
  worstRmse: Math.max(...renderedCases.map(({ rendered }) => rendered.rmse)),
  parityPercent: (1 - meanRenderedRmse) * 100,
  casePassRatePercent: passingRenderedCases / renderedCases.length * 100,
  withinTwoCodeValues: renderedCases.filter(({ rendered }) => rendered.maximumError <= 2 / 255).length,
  caseCount: renderedCases.length,
  passed95PercentGate: (1 - meanRenderedRmse) >= 0.95
    && passingRenderedCases / renderedCases.length >= 0.95
};
await writeFile(path.join(root, 'analysis.json'), `${JSON.stringify({
  schema: 1, adjustment, photoshopVersion: '27.11.0', source: sourcePath,
  parameterCoverage: 'neutral, small, mid, 80 percent and endpoint extremes', summary,
  renderedSummary, cases: report
}, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ summary, renderedSummary, cases: report.map(({ id, metrics, rendered }) => ({
  id,
  ...(metrics.linear ? {
    linearRmse: Number(metrics.linear.rmse.toFixed(6)),
    encodedRmse: Number(metrics.encoded.rmse.toFixed(6)),
    photoshop22Rmse: Number(metrics['photoshop-22'].rmse.toFixed(6))
  } : {}),
  renderedRmse: rendered ? Number(rendered.rmse.toFixed(6)) : null
})) }, null, 2)}\n`);
if (renderedSummary && !renderedSummary.passed95PercentGate) process.exitCode = 1;
