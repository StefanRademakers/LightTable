import { access, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import sharp from 'sharp';

const directory = path.resolve(process.argv[2] ?? 'tmp/face-warp-parity/pukkels-lighttable');
const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'));
const columns = 3;
const cellWidth = 360;
const headerHeight = 26;
const rows = [];
const cases = [];
const caption = (value) => Buffer.from(
  `<svg width="${cellWidth}" height="${headerHeight}"><rect width="100%" height="100%" fill="#202225"/>`
  + `<text x="8" y="18" fill="white" font-family="sans-serif" font-size="13">${value}</text></svg>`
);
const normalize = async (file) => sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const sameDimensions = (left, right) => left.info.width === right.info.width && left.info.height === right.info.height;

let identities = null;
let identityError = null;
try {
  const lightTableIdentityPath = path.join(directory, manifest.identity ?? 'lighttable-identity.png');
  const photoshopIdentityPath = path.join(directory, 'photoshop-identity.png');
  await Promise.all([access(lightTableIdentityPath), access(photoshopIdentityPath)]);
  const [lightTable, photoshop] = await Promise.all([
    normalize(lightTableIdentityPath),
    normalize(photoshopIdentityPath)
  ]);
  if (!sameDimensions(lightTable, photoshop)) throw new Error('LightTable and Photoshop identity dimensions differ.');
  let squaredError = 0;
  for (let index = 0; index < lightTable.data.length; index += 4) {
    for (let channel = 0; channel < 3; channel += 1) {
      const delta = lightTable.data[index + channel] - photoshop.data[index + channel];
      squaredError += delta * delta;
    }
  }
  identities = {
    lightTable, photoshop,
    baselineRmse: Math.sqrt(squaredError / (lightTable.info.width * lightTable.info.height * 3))
  };
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
  identityError = error;
}

for (const entry of manifest.cases) {
  const lightTablePath = path.join(directory, entry.png);
  const photoshopName = `photoshop-${entry.name}.png`;
  const photoshopPath = path.join(directory, photoshopName);
  try {
    await access(photoshopPath);
  } catch {
    cases.push({ name: entry.name, status: 'awaiting-photoshop', lightTable: entry.png, photoshop: photoshopName });
    continue;
  }
  if (!identities) {
    cases.push({
      name: entry.name,
      status: 'invalid-photoshop-reference',
      lightTable: entry.png,
      photoshop: photoshopName,
      reason: `The Photoshop identity export is missing; deformation delta cannot be measured (${identityError?.code ?? 'unavailable'}).`
    });
    continue;
  }
  const [photoshop, lightTable] = await Promise.all([normalize(photoshopPath), normalize(lightTablePath)]);
  if (!sameDimensions(lightTable, photoshop)) {
    throw new Error(`${entry.name} dimensions differ: LightTable ${lightTable.info.width}x${lightTable.info.height}, `
      + `Photoshop ${photoshop.info.width}x${photoshop.info.height}.`);
  }
  const difference = Buffer.alloc(lightTable.data.length);
  const deltaDifference = identities ? Buffer.alloc(lightTable.data.length) : null;
  let squaredError = 0;
  let deltaSquaredError = 0;
  let maximumDifference = 0;
  let maximumDeltaDifference = 0;
  let lightTableEffectSquared = 0;
  let photoshopEffectSquared = 0;
  for (let index = 0; index < difference.length; index += 4) {
    for (let channel = 0; channel < 3; channel += 1) {
      const rawDifference = Math.abs(lightTable.data[index + channel] - photoshop.data[index + channel]);
      difference[index + channel] = rawDifference;
      squaredError += rawDifference * rawDifference;
      maximumDifference = Math.max(maximumDifference, rawDifference);
      if (identities && deltaDifference) {
        const lightTableEffect = lightTable.data[index + channel] - identities.lightTable.data[index + channel];
        const photoshopEffect = photoshop.data[index + channel] - identities.photoshop.data[index + channel];
        const effectDifference = Math.abs(lightTableEffect - photoshopEffect);
        deltaDifference[index + channel] = Math.min(255, effectDifference);
        deltaSquaredError += effectDifference * effectDifference;
        maximumDeltaDifference = Math.max(maximumDeltaDifference, effectDifference);
        lightTableEffectSquared += lightTableEffect * lightTableEffect;
        photoshopEffectSquared += photoshopEffect * photoshopEffect;
      }
    }
    difference[index + 3] = 255;
    if (deltaDifference) deltaDifference[index + 3] = 255;
  }
  const channelCount = lightTable.info.width * lightTable.info.height * 3;
  const rmse = Math.sqrt(squaredError / channelCount);
  const deltaRmse = identities ? Math.sqrt(deltaSquaredError / channelCount) : null;
  const photoshopEffectRms = identities ? Math.sqrt(photoshopEffectSquared / channelCount) : null;
  if (identities && photoshopEffectRms === 0) {
    cases.push({
      name: entry.name,
      status: 'invalid-photoshop-reference',
      lightTable: entry.png,
      photoshop: photoshopName,
      reason: 'The Photoshop export is pixel-identical to its identity export.'
    });
    continue;
  }
  const differenceName = `difference-${entry.name}.png`;
  const deltaDifferenceName = identities ? `delta-difference-${entry.name}.png` : differenceName;
  await sharp(difference, { raw: lightTable.info }).png().toFile(path.join(directory, differenceName));
  if (identities && deltaDifference) {
    await sharp(deltaDifference, { raw: lightTable.info }).png().toFile(path.join(directory, deltaDifferenceName));
  }
  const cells = await Promise.all([
    [lightTablePath, `LightTable · ${entry.name}`],
    [photoshopPath, `Photoshop · ${entry.name}`],
    [path.join(directory, deltaDifferenceName), identities
      ? `Deformation delta · RMSE ${deltaRmse.toFixed(2)}`
      : `Difference · RMSE ${rmse.toFixed(2)}`]
  ].map(async ([file, label]) => ({
    input: await sharp(file).resize({ width: cellWidth, height: cellWidth, fit: 'inside', background: '#111315' })
      .extend({ top: headerHeight, bottom: 0, left: 0, right: 0, background: '#111315' })
      .composite([{ input: caption(label), top: 0, left: 0 }]).png().toBuffer()
  })));
  rows.push(cells);
  cases.push({
    name: entry.name, status: 'compared', lightTable: entry.png, photoshop: photoshopName,
    difference: differenceName, deltaDifference: identities ? deltaDifferenceName : null,
    rmse, maximumDifference, deltaRmse, maximumDeltaDifference: identities ? maximumDeltaDifference : null,
    lightTableEffectRms: identities ? Math.sqrt(lightTableEffectSquared / channelCount) : null,
    photoshopEffectRms
  });
}

if (rows.length > 0) {
  const rowHeight = cellWidth + headerHeight;
  await sharp({ create: { width: columns * cellWidth, height: rows.length * rowHeight,
    channels: 4, background: '#111315' } }).composite(rows.flatMap((row, rowIndex) => row.map((cell, column) => ({
    ...cell, left: column * cellWidth, top: rowIndex * rowHeight
  })))).png().toFile(path.join(directory, 'photoshop-comparison-sheet.png'));
}
const report = {
  sourceFile: manifest.sourceFile,
  identityBaselineRmse: identities?.baselineRmse ?? null,
  compared: cases.filter(({ status }) => status === 'compared').length,
  awaitingPhotoshop: cases.filter(({ status }) => status === 'awaiting-photoshop').length,
  invalidPhotoshop: cases.filter(({ status }) => status === 'invalid-photoshop-reference').length,
  cases
};
await writeFile(path.join(directory, 'comparison-report.json'), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`Face Warp comparison: ${report.compared} compared, ${report.awaitingPhotoshop} awaiting Photoshop, `
  + `${report.invalidPhotoshop} invalid Photoshop references.\n`);
if (report.invalidPhotoshop > 0) process.exitCode = 1;
