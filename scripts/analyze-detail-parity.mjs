import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import sharp from 'sharp';

const rootArgument = process.argv.find((value) => value.startsWith('--root='));
const root = path.resolve(rootArgument?.slice('--root='.length)
  ?? 'D:\\mediavibe\\LightTableTests\\DetailParity');
const amounts = [25, 50, 80, 100];
const paths = {
  cameraRawNeutral: path.join(root, 'camera-raw', 'neutral.png'),
  lightTableNeutral: path.join(root, 'lighttable', 'neutral.png'),
  ...Object.fromEntries(amounts.flatMap((amount) => ([
    [`cameraRaw${amount}`, path.join(root, 'camera-raw', `luminance-${amount}.png`)],
    [`lightTable${amount}`, path.join(root, 'lighttable', `luminance-${amount}.png`)]
  ])))
};

const load = async (file) => sharp(file).removeAlpha().raw()
  .toBuffer({ resolveWithObject: true });
const images = Object.fromEntries(await Promise.all(Object.entries(paths).map(async ([key, file]) => (
  [key, await load(file)]
))));
const dimensions = new Set(Object.values(images).map(({ info }) => `${info.width}x${info.height}`));
if (dimensions.size !== 1) throw new Error(`Oracle dimensions differ: ${[...dimensions].join(', ')}`);

const normalizedRmse = (left, right) => {
  let squared = 0;
  for (let index = 0; index < left.length; index += 1) {
    const difference = left[index] - right[index];
    squared += difference * difference;
  }
  return Math.sqrt(squared / left.length) / 255;
};
const effect = (neutral, target) => Float64Array.from(
  target, (value, index) => value - neutral[index]
);
const vectorMetrics = (left, right) => {
  let squaredDifference = 0;
  let leftEnergy = 0;
  let rightEnergy = 0;
  let dot = 0;
  for (let index = 0; index < left.length; index += 1) {
    const difference = left[index] - right[index];
    squaredDifference += difference * difference;
    leftEnergy += left[index] * left[index];
    rightEnergy += right[index] * right[index];
    dot += left[index] * right[index];
  }
  return {
    deltaRmse: Math.sqrt(squaredDifference / left.length) / 255,
    correlation: dot / Math.max(1e-12, Math.sqrt(leftEnergy * rightEnergy)),
    cameraRawMagnitude: Math.sqrt(leftEnergy / left.length) / 255,
    lightTableMagnitude: Math.sqrt(rightEnergy / right.length) / 255,
    magnitudeRatio: Math.sqrt(rightEnergy / Math.max(1e-12, leftEnergy))
  };
};
const highFrequencyEnergy = ({ data, info }) => {
  const luminance = (index) => 0.2126 * data[index] + 0.7152 * data[index + 1]
    + 0.0722 * data[index + 2];
  let squared = 0;
  let count = 0;
  for (let y = 1; y < info.height - 1; y += 1) {
    for (let x = 1; x < info.width - 1; x += 1) {
      const center = (y * info.width + x) * info.channels;
      const laplacian = 4 * luminance(center)
        - luminance(center - info.channels) - luminance(center + info.channels)
        - luminance(center - info.width * info.channels)
        - luminance(center + info.width * info.channels);
      squared += laplacian * laplacian;
      count += 1;
    }
  }
  return Math.sqrt(squared / count) / 255;
};

const cameraRawNeutralHighFrequency = highFrequencyEnergy(images.cameraRawNeutral);
const lightTableNeutralHighFrequency = highFrequencyEnergy(images.lightTableNeutral);
const report = {
  schema: 2,
  generatedAt: new Date().toISOString(),
  dimensions: [...dimensions][0],
  neutralRmse: normalizedRmse(images.cameraRawNeutral.data, images.lightTableNeutral.data),
  cases: amounts.map((amount) => {
    const cameraRawTarget = images[`cameraRaw${amount}`];
    const lightTableTarget = images[`lightTable${amount}`];
    const cameraRawTargetHighFrequency = highFrequencyEnergy(cameraRawTarget);
    const lightTableTargetHighFrequency = highFrequencyEnergy(lightTableTarget);
    return {
      amount,
      directTargetRmse: normalizedRmse(cameraRawTarget.data, lightTableTarget.data),
      effectDelta: vectorMetrics(
        effect(images.cameraRawNeutral.data, cameraRawTarget.data),
        effect(images.lightTableNeutral.data, lightTableTarget.data)
      ),
      highFrequency: {
        cameraRawRetention: cameraRawTargetHighFrequency / cameraRawNeutralHighFrequency,
        lightTableRetention: lightTableTargetHighFrequency / lightTableNeutralHighFrequency
      }
    };
  }),
  note: 'Initial characterization only; no parity threshold or tuning decision is encoded.'
};
await mkdir(root, { recursive: true });
await writeFile(path.join(root, 'comparison-report.json'), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
