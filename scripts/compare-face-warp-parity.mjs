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
const caption = (text) => Buffer.from(
  `<svg width="${cellWidth}" height="${headerHeight}"><rect width="100%" height="100%" fill="#202225"/>`
  + `<text x="8" y="18" fill="white" font-family="sans-serif" font-size="13">${text}</text></svg>`
);
const normalize = async (file) => sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

for (const entry of manifest.cases) {
  const lightTablePath = path.join(directory, entry.png);
  const photoshopName = `photoshop-${entry.name}.png`;
  const photoshopPath = path.join(directory, photoshopName);
  let photoshopAvailable = true;
  try {
    await access(photoshopPath);
  } catch {
    photoshopAvailable = false;
  }
  if (!photoshopAvailable) {
    cases.push({ name: entry.name, status: 'awaiting-photoshop', lightTable: entry.png, photoshop: photoshopName });
    continue;
  }
  const photoshop = await normalize(photoshopPath);
  const lightTable = await normalize(lightTablePath);
  if (lightTable.info.width !== photoshop.info.width || lightTable.info.height !== photoshop.info.height) {
    throw new Error(`${entry.name} dimensions differ: LightTable ${lightTable.info.width}x${lightTable.info.height}, `
      + `Photoshop ${photoshop.info.width}x${photoshop.info.height}.`);
  }
  const difference = Buffer.alloc(lightTable.data.length);
  let squaredError = 0;
  let maximumDifference = 0;
  for (let index = 0; index < difference.length; index += 4) {
    for (let channel = 0; channel < 3; channel += 1) {
      const delta = Math.abs(lightTable.data[index + channel] - photoshop.data[index + channel]);
      difference[index + channel] = delta;
      squaredError += delta * delta;
      maximumDifference = Math.max(maximumDifference, delta);
    }
    difference[index + 3] = 255;
  }
  const rmse = Math.sqrt(squaredError / (lightTable.info.width * lightTable.info.height * 3));
  const differenceName = `difference-${entry.name}.png`;
  await sharp(difference, { raw: lightTable.info }).png().toFile(path.join(directory, differenceName));
  const cells = await Promise.all([
    [lightTablePath, `LightTable · ${entry.name}`],
    [photoshopPath, `Photoshop · ${entry.name}`],
    [path.join(directory, differenceName), `Difference · RMSE ${rmse.toFixed(2)}`]
  ].map(async ([file, label]) => ({
    input: await sharp(file).resize({ width: cellWidth, height: cellWidth, fit: 'inside', background: '#111315' })
      .extend({ top: headerHeight, bottom: 0, left: 0, right: 0, background: '#111315' })
      .composite([{ input: caption(label), top: 0, left: 0 }]).png().toBuffer()
  })));
  rows.push(cells);
  cases.push({ name: entry.name, status: 'compared', lightTable: entry.png, photoshop: photoshopName,
    difference: differenceName, rmse, maximumDifference });
}

if (rows.length > 0) {
  const rowHeight = cellWidth + headerHeight;
  await sharp({ create: { width: columns * cellWidth, height: rows.length * rowHeight,
    channels: 4, background: '#111315' } }).composite(rows.flatMap((row, rowIndex) => row.map((cell, column) => ({
    ...cell, left: column * cellWidth, top: rowIndex * rowHeight
  })))).png().toFile(path.join(directory, 'photoshop-comparison-sheet.png'));
}
const report = { sourceFile: manifest.sourceFile, compared: cases.filter(({ status }) => status === 'compared').length,
  awaitingPhotoshop: cases.filter(({ status }) => status === 'awaiting-photoshop').length, cases };
await writeFile(path.join(directory, 'comparison-report.json'), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`Face Warp comparison: ${report.compared} compared, ${report.awaitingPhotoshop} awaiting Photoshop.\n`);
