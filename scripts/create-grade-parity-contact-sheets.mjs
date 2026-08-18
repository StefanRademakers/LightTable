import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import sharp from 'sharp';

const rootArgument = process.argv.find((value) => value.startsWith('--root='));
const root = path.resolve(rootArgument?.slice('--root='.length)
  ?? 'D:\\mediavibe\\LightTableTests\\GradeLightParity');
const parse = async (file) => JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/u, ''));
const [cameraRawReport, lightTableReport] = await Promise.all([
  parse(path.join(root, 'camera-raw', 'capture-report.json')),
  parse(path.join(root, 'lighttable', 'capture-report.json'))
]);
const outputDirectory = path.join(root, 'contact-sheets');
await mkdir(outputDirectory, { recursive: true });

const cameraCases = new Map(cameraRawReport.cases.map((entry) => [entry.id, entry]));
const lightTableCases = new Map(lightTableReport.cases.map((entry) => [entry.id, entry]));
const cameraNeutral = await sharp(path.join(root, 'camera-raw', 'neutral.png'))
  .removeAlpha().raw().toBuffer({ resolveWithObject: true });
const lightNeutral = await sharp(path.join(root, 'lighttable', 'neutral.png'))
  .removeAlpha().raw().toBuffer({ resolveWithObject: true });
if (cameraNeutral.info.width !== lightNeutral.info.width
  || cameraNeutral.info.height !== lightNeutral.info.height) {
  throw new Error('Contact-sheet neutral dimensions do not match.');
}

const controls = new Map();
for (const entry of cameraRawReport.cases.filter(({ id, isBaseline }) => id !== 'neutral' && !isBaseline)) {
  const entries = controls.get(entry.key) ?? [];
  entries.push(entry);
  controls.set(entry.key, entries);
}
const chosenValues = new Set([-100, -80, -50, 50, 80, 100, -5, -4, -2, 2, 4, 5]);
const tileWidth = 280;
const tileHeight = 190;
const headerHeight = 28;
const gap = 6;
const columns = 4;
const labels = ['Camera Raw', 'LightTable', 'Effect difference x4', 'Camera Raw / LightTable'];

const svgLabel = (text, width, height) => Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <rect width="100%" height="100%" fill="#20242a"/>
  <text x="8" y="19" font-family="Arial, sans-serif" font-size="13" fill="#f3f5f7">${text.replaceAll('&', '&amp;').replaceAll('<', '&lt;')}</text>
</svg>`);
const fit = (file) => sharp(file).resize(tileWidth, tileHeight, { fit: 'contain', background: '#0d0f12' }).png().toBuffer();

for (const [key, allEntries] of controls) {
  const entries = allEntries.filter(({ value }) => chosenValues.has(value));
  const rows = entries.length;
  const sheetWidth = columns * tileWidth + (columns - 1) * gap;
  const sheetHeight = headerHeight + rows * (tileHeight + headerHeight + gap);
  const composite = labels.map((label, column) => ({
    input: svgLabel(label, tileWidth, headerHeight), left: column * (tileWidth + gap), top: 0
  }));
  for (let row = 0; row < entries.length; row += 1) {
    const entry = entries[row];
    const lightEntry = lightTableCases.get(entry.id);
    if (!lightEntry) throw new Error(`LightTable contact-sheet case missing: ${entry.id}`);
    const cameraFile = path.join(root, 'camera-raw', `${entry.id}.png`);
    const lightFile = path.join(root, 'lighttable', `${entry.id}.png`);
    const [camera, light, cameraTile, lightTile] = await Promise.all([
      sharp(cameraFile).removeAlpha().raw().toBuffer(),
      sharp(lightFile).removeAlpha().raw().toBuffer(),
      fit(cameraFile), fit(lightFile)
    ]);
    const baselineId = entry.baselineId ?? 'neutral';
    const [cameraBaseline, lightBaseline] = baselineId === 'neutral'
      ? [cameraNeutral.data, lightNeutral.data]
      : await Promise.all([
          sharp(path.join(root, 'camera-raw', `${baselineId}.png`)).removeAlpha().raw().toBuffer(),
          sharp(path.join(root, 'lighttable', `${baselineId}.png`)).removeAlpha().raw().toBuffer()
        ]);
    const difference = Buffer.allocUnsafe(camera.length);
    for (let index = 0; index < difference.length; index += 1) {
      const cameraEffect = camera[index] - cameraBaseline[index];
      const lightEffect = light[index] - lightBaseline[index];
      difference[index] = Math.min(255, Math.abs(cameraEffect - lightEffect) * 4);
    }
    const differenceTile = await sharp(difference, {
      raw: { width: cameraNeutral.info.width, height: cameraNeutral.info.height, channels: 3 }
    }).resize(tileWidth, tileHeight, { fit: 'contain', background: '#0d0f12' }).png().toBuffer();
    const splitTile = await sharp({
      create: { width: tileWidth, height: tileHeight, channels: 3, background: '#0d0f12' }
    }).composite([
      { input: cameraTile, left: 0, top: 0 },
      { input: lightTile, left: Math.floor(tileWidth / 2), top: 0 }
    ]).extract({ left: 0, top: 0, width: tileWidth, height: tileHeight }).png().toBuffer();
    const top = headerHeight + row * (tileHeight + headerHeight + gap);
    const rowLabel = `${entry.label} ${entry.value > 0 ? '+' : ''}${entry.value}`;
    for (let column = 0; column < columns; column += 1) {
      const left = column * (tileWidth + gap);
      composite.push({ input: [cameraTile, lightTile, differenceTile, splitTile][column], left, top });
      composite.push({ input: svgLabel(rowLabel, tileWidth, headerHeight), left, top: top + tileHeight });
    }
  }
  await sharp({ create: { width: sheetWidth, height: sheetHeight, channels: 3, background: '#14171b' } })
    .composite(composite).png().toFile(path.join(outputDirectory, `${key}.png`));
  process.stdout.write(`Contact sheet ${key}: ${path.join(outputDirectory, `${key}.png`)}\n`);
}
