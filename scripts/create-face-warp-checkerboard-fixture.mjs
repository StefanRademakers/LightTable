import path from 'node:path';
import process from 'node:process';
import sharp from 'sharp';

const source = path.resolve(process.argv[2] ?? 'D:\\pukkels-lighttable.png');
const destination = path.resolve(
  process.argv[3] ?? path.join('tmp', 'face-warp-smoke', 'numbered-checkerboard-face.png')
);
const image = sharp(source).ensureAlpha();
const metadata = await image.metadata();
const width = metadata.width ?? 0;
const height = metadata.height ?? 0;
if (width < 64 || height < 64) throw new Error('Face Warp checkerboard source is too small.');

const cell = Math.max(24, Math.round(Math.min(width, height) / 10));
const columns = Math.ceil(width / cell);
const rows = Math.ceil(height / cell);
const cells = [];
for (let row = 0; row < rows; row += 1) {
  for (let column = 0; column < columns; column += 1) {
    const x = column * cell;
    const y = row * cell;
    const index = row * columns + column + 1;
    const shade = (row + column) % 2 === 0 ? '#00d8ff' : '#ff3bd4';
    cells.push(
      `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" fill="${shade}" fill-opacity="0.075"/>`,
      `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" fill="none" stroke="#00e5ff" stroke-opacity="0.42" stroke-width="1"/>`,
      `<text x="${x + 4}" y="${y + 14}" font-family="monospace" font-size="10" font-weight="700" fill="#001318" fill-opacity="0.72">${index}</text>`
    );
  }
}
const overlay = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${cells.join('')}</svg>`
);
await image.composite([{ input: overlay, left: 0, top: 0 }]).png().toFile(destination);
process.stdout.write(`Face Warp numbered checkerboard fixture: ${destination}\n`);
