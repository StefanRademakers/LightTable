import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import sharp from 'sharp';

const argument = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};

const root = path.resolve(argument('output', 'D:\\mediavibe\\LightTableTests\\ToneBrush'));
const command = argument('command', 'prepare');
const width = 1024;
const height = 256;

const colorBands = [
  { name: 'neutral', color: [128, 128, 128] },
  { name: 'red', color: [255, 0, 0] },
  { name: 'green', color: [0, 255, 0] },
  { name: 'blue', color: [0, 0, 255] },
  { name: 'cyan', color: [0, 255, 255] },
  { name: 'magenta', color: [255, 0, 255] },
  { name: 'yellow', color: [255, 255, 0] },
  { name: 'skin', color: [198, 124, 92] }
];

const interpolate = (from, to, amount) => Math.round(from + (to - from) * amount);

if (command === 'prepare') {
  const source = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = Math.round(x / (width - 1) * 255);
      const offset = (y * width + x) * 4;
      source[offset] = value;
      source[offset + 1] = value;
      source[offset + 2] = value;
      source[offset + 3] = 255;
    }
  }
  const sourceDirectory = path.join(root, 'source');
  await mkdir(sourceDirectory, { recursive: true });
  const output = path.join(sourceDirectory, 'grayscale-ramp.png');
  await sharp(source, { raw: { width, height, channels: 4 } }).png().toFile(output);
  const bandHeight = 96;
  const colorHeight = colorBands.length * bandHeight;
  const colorSource = new Uint8Array(width * colorHeight * 4);
  for (let bandIndex = 0; bandIndex < colorBands.length; bandIndex += 1) {
    const base = colorBands[bandIndex].color;
    for (let x = 0; x < width; x += 1) {
      const normalized = x / (width - 1);
      const amount = normalized <= 0.5 ? normalized * 2 : (normalized - 0.5) * 2;
      const from = normalized <= 0.5 ? [0, 0, 0] : base;
      const to = normalized <= 0.5 ? base : [255, 255, 255];
      const rgb = from.map((channel, index) => interpolate(channel, to[index], amount));
      for (let row = 0; row < bandHeight; row += 1) {
        const y = bandIndex * bandHeight + row;
        const offset = (y * width + x) * 4;
        colorSource[offset] = rgb[0];
        colorSource[offset + 1] = rgb[1];
        colorSource[offset + 2] = rgb[2];
        colorSource[offset + 3] = 255;
      }
    }
  }
  const colorOutput = path.join(sourceDirectory, 'color-gradients.png');
  await sharp(colorSource, { raw: { width, height: colorHeight, channels: 4 } }).png().toFile(colorOutput);
  await writeFile(path.join(root, 'oracle-config.json'), `${JSON.stringify({
    width,
    height,
    sampleRow: height / 2,
    source: output,
    profile: 'sRGB IEC61966-2.1',
    bitDepth: 8,
    note: 'Neutral and color-gradient sources for black-box Dodge/Burn calibration.',
    colorSource: colorOutput,
    colorBands: colorBands.map(({ name }, index) => ({
      name,
      sampleRow: index * bandHeight + Math.floor(bandHeight / 2)
    }))
  }, null, 2)}\n`);
  process.stdout.write(`Tone-brush oracle sources: ${output}, ${colorOutput}\n`);
} else if (command === 'analyze') {
  const photoshopDirectory = path.join(root, 'photoshop');
  const manifestText = await readFile(path.join(root, 'photoshop-manifest.json'), 'utf8');
  const manifest = JSON.parse(manifestText.replace(/^\uFEFF/, ''));
  const cases = manifest
    .filter(({ status }) => status === 'captured')
    .map(({ id }) => id)
    .sort();
  const report = [];
  const csv = ['case,input,output,delta'];
  for (const id of cases) {
    const { data, info } = await sharp(path.join(photoshopDirectory, `${id}.png`))
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    if (info.width !== width || info.height !== height || info.channels !== 3) {
      throw new Error(`${id} has unexpected dimensions or channels.`);
    }
    const curve = [];
    for (let input = 0; input <= 255; input += 1) {
      const x0 = Math.round(input / 255 * (width - 1));
      let sum = 0;
      let count = 0;
      for (let y = 124; y <= 132; y += 1) {
        const offset = (y * width + x0) * 3;
        sum += (data[offset] + data[offset + 1] + data[offset + 2]) / 3;
        count += 1;
      }
      const output = sum / count;
      curve.push({ input, output, delta: output - input });
      csv.push(`${id},${input},${output.toFixed(4)},${(output - input).toFixed(4)}`);
    }
    const active = curve.filter(({ delta }) => Math.abs(delta) >= 0.5);
    const peak = curve.reduce((best, entry) => (
      Math.abs(entry.delta) > Math.abs(best.delta) ? entry : best
    ), curve[0]);
    report.push({
      id,
      activeInputMinimum: active[0]?.input ?? null,
      activeInputMaximum: active.at(-1)?.input ?? null,
      peak,
      curve
    });
  }
  await writeFile(path.join(root, 'photoshop-curves.json'), `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(path.join(root, 'photoshop-curves.csv'), `${csv.join('\n')}\n`);
  process.stdout.write(`${JSON.stringify(report.map(({ id, activeInputMinimum, activeInputMaximum, peak }) => ({
    id,
    activeInputMinimum,
    activeInputMaximum,
    peakInput: peak.input,
    peakDelta: Number(peak.delta.toFixed(3))
  })), null, 2)}\n`);
} else if (command === 'analyze-lighttable') {
  const source = await sharp(path.join(root, 'source', 'grayscale-ramp.png'))
    .removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const results = [];
  const rows = [];
  for (const tool of ['dodge', 'burn']) {
    for (const range of ['shadows', 'midtones', 'highlights']) {
      const id = `${tool}-${range}-20-protected`;
      const photoshopFile = path.join(root, 'photoshop', `${id}.png`);
      const lightTableFile = path.join(root, 'lighttable', `${tool}-${range}-e20-protected.png`);
      const photoshop = await sharp(photoshopFile).removeAlpha().raw()
        .toBuffer({ resolveWithObject: true });
      const lightTablePng = await sharp(lightTableFile).resize(width, height).removeAlpha().png().toBuffer();
      const lightTable = await sharp(lightTablePng).raw().toBuffer({ resolveWithObject: true });
      let squaredError = 0;
      let absoluteError = 0;
      let count = 0;
      const curve = [];
      for (let input = 0; input <= 255; input += 1) {
        const x = Math.round(input / 255 * (width - 1));
        const offset = ((height / 2) * width + x) * 3;
        const photoshopValue = photoshop.data[offset];
        const lightTableValue = lightTable.data[offset];
        const difference = lightTableValue - photoshopValue;
        squaredError += difference * difference;
        absoluteError += Math.abs(difference);
        count += 1;
        curve.push({ input, photoshop: photoshopValue, lightTable: lightTableValue, difference });
      }
      results.push({
        id,
        rmse: Math.sqrt(squaredError / count),
        meanAbsoluteError: absoluteError / count,
        curve
      });
      rows.push(await sharp({
        create: { width: width * 2, height, channels: 3, background: '#000000' }
      }).composite([
        { input: lightTablePng, left: 0, top: 0 },
        { input: await sharp(photoshopFile).removeAlpha().png().toBuffer(), left: width, top: 0 }
      ]).png().toBuffer());
    }
  }
  await writeFile(path.join(root, 'lighttable-parity-protected-20.json'), `${JSON.stringify(results, null, 2)}\n`);
  const exposureResults = [];
  for (const tool of ['dodge', 'burn']) {
    for (const exposure of [5, 20, 50]) {
      const photoshop = await sharp(path.join(
        root, 'photoshop', `${tool}-midtones-${exposure}-protected.png`
      )).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      const lightTable = await sharp(path.join(
        root, 'lighttable', `${tool}-midtones-e${exposure}-protected.png`
      )).resize(width, height).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      let squaredError = 0;
      let absoluteError = 0;
      for (let input = 0; input <= 255; input += 1) {
        const x = Math.round(input / 255 * (width - 1));
        const offset = ((height / 2) * width + x) * 3;
        const difference = lightTable.data[offset] - photoshop.data[offset];
        squaredError += difference * difference;
        absoluteError += Math.abs(difference);
      }
      exposureResults.push({
        tool,
        exposure,
        rmse: Math.sqrt(squaredError / 256),
        meanAbsoluteError: absoluteError / 256
      });
    }
  }
  await writeFile(
    path.join(root, 'lighttable-exposure-parity.json'),
    `${JSON.stringify(exposureResults, null, 2)}\n`
  );
  await sharp({
    create: { width: width * 2, height: height * rows.length, channels: 3, background: '#000000' }
  }).composite(rows.map((input, index) => ({ input, left: 0, top: index * height })))
    .png().toFile(path.join(root, 'lighttable-vs-photoshop-protected-20.png'));
  process.stdout.write(`${JSON.stringify({
    ranges: results.map(({ id, rmse, meanAbsoluteError }) => ({
      id,
      rmse: Number(rmse.toFixed(3)),
      meanAbsoluteError: Number(meanAbsoluteError.toFixed(3))
    })),
    exposure: exposureResults.map(({ tool, exposure, rmse, meanAbsoluteError }) => ({
      tool,
      exposure,
      rmse: Number(rmse.toFixed(3)),
      meanAbsoluteError: Number(meanAbsoluteError.toFixed(3))
    }))
  }, null, 2)}\n`);
} else if (command === 'analyze-color') {
  const config = JSON.parse(await readFile(path.join(root, 'oracle-config.json'), 'utf8'));
  const manifestText = await readFile(path.join(root, 'photoshop-color-manifest.json'), 'utf8');
  const manifest = JSON.parse(manifestText.replace(/^\uFEFF/, ''));
  const sourceImage = await sharp(config.colorSource).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const hueAndSaturation = (red, green, blue) => {
    const r = red / 255; const g = green / 255; const b = blue / 255;
    const maximum = Math.max(r, g, b); const minimum = Math.min(r, g, b);
    const delta = maximum - minimum;
    let hue = 0;
    if (delta > 1e-6) {
      if (maximum === r) hue = ((g - b) / delta) % 6;
      else if (maximum === g) hue = (b - r) / delta + 2;
      else hue = (r - g) / delta + 4;
      hue = ((hue * 60) + 360) % 360;
    }
    return { hue, saturation: maximum <= 1e-6 ? 0 : delta / maximum };
  };
  const results = [];
  const csv = ['case,band,x,inputR,inputG,inputB,outputR,outputG,outputB,hueShift,saturationDelta'];
  for (const entry of manifest.filter(({ status }) => status === 'captured')) {
    const outputImage = await sharp(entry.file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const bands = [];
    for (const band of config.colorBands) {
      let luminanceDelta = 0; let hueShift = 0; let hueSamples = 0;
      let saturationDelta = 0; let newlyClippedChannels = 0;
      for (let x = 0; x < sourceImage.info.width; x += 1) {
        const sourceOffset = (band.sampleRow * sourceImage.info.width + x) * 3;
        const outputOffset = (band.sampleRow * outputImage.info.width + x) * 3;
        const input = [sourceImage.data[sourceOffset], sourceImage.data[sourceOffset + 1], sourceImage.data[sourceOffset + 2]];
        const output = [outputImage.data[outputOffset], outputImage.data[outputOffset + 1], outputImage.data[outputOffset + 2]];
        const inputLuma = input[0] * 0.2126 + input[1] * 0.7152 + input[2] * 0.0722;
        const outputLuma = output[0] * 0.2126 + output[1] * 0.7152 + output[2] * 0.0722;
        luminanceDelta += outputLuma - inputLuma;
        const inputColor = hueAndSaturation(...input);
        const outputColor = hueAndSaturation(...output);
        const rawHueShift = Math.abs(outputColor.hue - inputColor.hue);
        const circularHueShift = Math.min(rawHueShift, 360 - rawHueShift);
        if (inputColor.saturation > 0.1 && outputColor.saturation > 0.1) {
          hueShift += circularHueShift;
          hueSamples += 1;
        }
        saturationDelta += outputColor.saturation - inputColor.saturation;
        for (let channel = 0; channel < 3; channel += 1) {
          if (input[channel] > 0 && input[channel] < 255 && (output[channel] === 0 || output[channel] === 255)) {
            newlyClippedChannels += 1;
          }
        }
        if (x % 4 === 0) csv.push([
          entry.id, band.name, x, ...input, ...output,
          circularHueShift.toFixed(4), (outputColor.saturation - inputColor.saturation).toFixed(6)
        ].join(','));
      }
      bands.push({
        name: band.name,
        meanLuminanceDelta: luminanceDelta / sourceImage.info.width,
        meanHueShiftDegrees: hueSamples ? hueShift / hueSamples : 0,
        meanSaturationDelta: saturationDelta / sourceImage.info.width,
        newlyClippedChannelFraction: newlyClippedChannels / (sourceImage.info.width * 3)
      });
    }
    results.push({ id: entry.id, bands });
  }
  await writeFile(path.join(root, 'photoshop-color-analysis.json'), `${JSON.stringify(results, null, 2)}\n`);
  await writeFile(path.join(root, 'photoshop-color-analysis.csv'), `${csv.join('\n')}\n`);
  process.stdout.write(`${JSON.stringify(results.map(({ id, bands }) => ({
    id,
    maximumMeanHueShiftDegrees: Math.max(...bands.map(({ meanHueShiftDegrees }) => meanHueShiftDegrees)),
    maximumClippedChannelFraction: Math.max(...bands.map(({ newlyClippedChannelFraction }) => newlyClippedChannelFraction))
  })), null, 2)}\n`);
} else {
  throw new Error(`Unknown tone-brush oracle command: ${command}`);
}
