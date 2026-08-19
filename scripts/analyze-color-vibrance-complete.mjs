import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import sharp from 'sharp';

const rootArgument = process.argv.findIndex((value) => value === '--root');
if (rootArgument < 0 || !process.argv[rootArgument + 1]) {
  throw new Error('Usage: node scripts/analyze-color-vibrance-complete.mjs --root <corpus-root>');
}
const root = path.resolve(process.argv[rootArgument + 1]);
const reportDirectory = path.join(root, 'report');
const parseJson = async (file) => JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/u, ''));
const [manifest, provenance] = await Promise.all([
  parseJson(path.join(root, 'photoshop-manifest.json')),
  parseJson(path.join(root, 'photoshop-provenance.json'))
]);

const srgbToLinear = (value) => {
  const encoded = value / 255;
  return encoded <= 0.04045 ? encoded / 12.92 : ((encoded + 0.055) / 1.055) ** 2.4;
};
const linearRgbToOklab = (red, green, blue) => {
  const l = Math.cbrt(0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue);
  const m = Math.cbrt(0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue);
  const s = Math.cbrt(0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  ];
};
const percentile = (sorted, amount) => sorted[Math.min(
  sorted.length - 1, Math.max(0, Math.ceil(sorted.length * amount) - 1)
)];
const round = (value, digits = 4) => Number(value.toFixed(digits));

const results = [];
for (const entry of manifest.filter(({ status }) => status === 'captured')) {
  const photoshopPath = entry.file;
  const lightTablePath = path.join(root, 'lighttable', `${entry.id}.png`);
  const [photoshop, lightTable] = await Promise.all([
    sharp(photoshopPath).removeAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(lightTablePath).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  ]);
  if (photoshop.info.width !== lightTable.info.width || photoshop.info.height !== lightTable.info.height) {
    throw new Error(`${entry.id}: image dimensions differ`);
  }
  let squared = 0;
  let absolute = 0;
  let maximumCodeError = 0;
  const channelSquared = [0, 0, 0];
  const pixelMaxErrors = [];
  const oklabDistances = [];
  for (let offset = 0; offset < photoshop.data.length; offset += 3) {
    let pixelMaximum = 0;
    for (let channel = 0; channel < 3; channel += 1) {
      const error = lightTable.data[offset + channel] - photoshop.data[offset + channel];
      squared += error * error;
      absolute += Math.abs(error);
      channelSquared[channel] += error * error;
      pixelMaximum = Math.max(pixelMaximum, Math.abs(error));
      maximumCodeError = Math.max(maximumCodeError, Math.abs(error));
    }
    pixelMaxErrors.push(pixelMaximum);
    const expected = linearRgbToOklab(
      srgbToLinear(photoshop.data[offset]),
      srgbToLinear(photoshop.data[offset + 1]),
      srgbToLinear(photoshop.data[offset + 2])
    );
    const actual = linearRgbToOklab(
      srgbToLinear(lightTable.data[offset]),
      srgbToLinear(lightTable.data[offset + 1]),
      srgbToLinear(lightTable.data[offset + 2])
    );
    oklabDistances.push(Math.hypot(
      actual[0] - expected[0], actual[1] - expected[1], actual[2] - expected[2]
    ));
  }
  oklabDistances.sort((left, right) => left - right);
  const channelCount = photoshop.data.length;
  const pixelCount = channelCount / 3;
  const within = (threshold) => pixelMaxErrors.filter((value) => value <= threshold).length / pixelCount * 100;
  results.push({
    id: entry.id,
    parameters: {
      temperature: entry.temperature,
      tint: entry.tint,
      vibrance: entry.vibrance,
      saturation: entry.saturation
    },
    rgb: {
      rmsePercent: Math.sqrt(squared / channelCount) / 255 * 100,
      maePercent: absolute / channelCount / 255 * 100,
      maximumCodeError,
      channelRmseCode: channelSquared.map((value) => Math.sqrt(value / pixelCount)),
      pixelsWithin2CodePercent: within(2),
      pixelsWithin5CodePercent: within(5),
      pixelsWithin10CodePercent: within(10)
    },
    oklab: {
      meanDelta: oklabDistances.reduce((sum, value) => sum + value, 0) / pixelCount,
      p95Delta: percentile(oklabDistances, 0.95),
      maximumDelta: oklabDistances.at(-1)
    },
    images: { photoshop: photoshopPath, lightTable: lightTablePath }
  });
}

const groupFor = ({ id }) => {
  if (id === 'neutral') return 'neutral';
  if (id.startsWith('temperature-')) return 'temperature';
  if (id.startsWith('tint-')) return 'tint';
  if (id.startsWith('vibrance-')) return 'vibrance';
  if (id.startsWith('saturation-')) return 'saturation';
  if (id.startsWith('combined-')) return 'combined';
  return 'heldout';
};
const groups = results.reduce((grouped, entry) => {
  const group = groupFor(entry);
  (grouped[group] ??= []).push(entry);
  return grouped;
}, {});
const summaries = Object.fromEntries(Object.entries(groups).map(([name, cases]) => [name, {
  caseCount: cases.length,
  meanRgbRmsePercent: cases.reduce((sum, entry) => sum + entry.rgb.rmsePercent, 0) / cases.length,
  worstRgbRmsePercent: Math.max(...cases.map((entry) => entry.rgb.rmsePercent)),
  worstCase: [...cases].sort((left, right) => right.rgb.rmsePercent - left.rgb.rmsePercent)[0].id,
  meanOklabDelta: cases.reduce((sum, entry) => sum + entry.oklab.meanDelta, 0) / cases.length
}]))

await mkdir(reportDirectory, { recursive: true });
await writeFile(path.join(reportDirectory, 'metrics.json'), `${JSON.stringify({
  schema: 1,
  interpretation: 'Direct error measurements; no synthetic parity percentage.',
  provenance,
  summaries,
  cases: results
}, null, 2)}\n`);

const coreCases = results.filter((entry) => groupFor(entry) !== 'heldout');
const header = '| Case | Temp | Tint | Vib | Sat | RGB RMSE | RGB MAE | Max code | Pixels <=5 | OKLab mean | OKLab p95 |';
const divider = '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |';
const rows = coreCases.map((entry) => `| ${entry.id} | ${entry.parameters.temperature} | ${entry.parameters.tint} | ${entry.parameters.vibrance} | ${entry.parameters.saturation} | ${round(entry.rgb.rmsePercent, 3)}% | ${round(entry.rgb.maePercent, 3)}% | ${entry.rgb.maximumCodeError} | ${round(entry.rgb.pixelsWithin5CodePercent, 2)}% | ${round(entry.oklab.meanDelta, 4)} | ${round(entry.oklab.p95Delta, 4)} |`);
const summaryRows = Object.entries(summaries).map(([name, summary]) => `| ${name} | ${summary.caseCount} | ${round(summary.meanRgbRmsePercent, 3)}% | ${round(summary.worstRgbRmsePercent, 3)}% | ${summary.worstCase} | ${round(summary.meanOklabDelta, 4)} |`);
await writeFile(path.join(reportDirectory, 'REPORT.md'), `# Color and Vibrance complete portrait comparison\n\nNo \`1 - RMSE\` parity percentage is reported. Lower errors and higher within-threshold coverage are better. Neutral is shown but excluded from every slider group.\n\n## Provenance\n\n- Photoshop: ${provenance.photoshopVersion}\n- Executable: \`${provenance.process.executablePath}\`\n- Executable SHA-256: \`${provenance.process.executableSha256}\`\n- Source SHA-256: \`${provenance.source.sha256}\`\n- Profile/depth: ${provenance.source.profile}, ${provenance.source.bitDepth}-bit\n\n## Per-slider summary\n\n| Group | Cases | Mean RGB RMSE | Worst RGB RMSE | Worst case | Mean OKLab delta |\n| --- | ---: | ---: | ---: | --- | ---: |\n${summaryRows.join('\n')}\n\n## Complete core matrix\n\n${header}\n${divider}\n${rows.join('\n')}\n`);

const escapeXml = (value) => value.replace(/[<>&'"]/gu, (character) => ({
  '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;'
})[character]);
for (const group of ['temperature', 'tint', 'vibrance', 'saturation', 'combined']) {
  const cases = groups[group] ?? [];
  if (!cases.length) continue;
  const thumbSize = 240;
  const labelWidth = 250;
  const rowHeight = thumbSize;
  const width = labelWidth + thumbSize * 2;
  const height = 40 + rowHeight * cases.length;
  const composites = [];
  for (const [index, entry] of cases.entries()) {
    const top = 40 + index * rowHeight;
    const [lightTable, photoshop] = await Promise.all([
      sharp(entry.images.lightTable).resize(thumbSize, thumbSize).png().toBuffer(),
      sharp(entry.images.photoshop).resize(thumbSize, thumbSize).png().toBuffer()
    ]);
    composites.push({ input: lightTable, left: labelWidth, top });
    composites.push({ input: photoshop, left: labelWidth + thumbSize, top });
  }
  const labels = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#202124"/><style>text{font-family:Arial,sans-serif;fill:#fff;font-size:16px} .head{font-weight:bold;font-size:18px}</style><text x="${labelWidth + 70}" y="27" class="head">LightTable</text><text x="${labelWidth + thumbSize + 70}" y="27" class="head">Photoshop</text>${cases.map((entry, index) => `<text x="12" y="${40 + index * rowHeight + 28}">${escapeXml(entry.id)}</text><text x="12" y="${40 + index * rowHeight + 52}">RMSE ${round(entry.rgb.rmsePercent, 3)}%, max ${entry.rgb.maximumCodeError}</text>`).join('')}</svg>`;
  await sharp(Buffer.from(labels)).composite(composites).png().toFile(path.join(reportDirectory, `${group}-contact-sheet.png`));
}

process.stdout.write(`${JSON.stringify({ reportDirectory, summaries }, null, 2)}\n`);
