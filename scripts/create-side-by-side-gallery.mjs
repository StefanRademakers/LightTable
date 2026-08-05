import { mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import sharp from 'sharp';

const input = path.resolve(process.argv[2] ?? '.');
const output = path.resolve(process.argv[3] ?? path.join(input, 'all-comparisons.png'));
const files = (await readdir(input, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && /\.png$/i.test(entry.name)
    && path.resolve(input, entry.name) !== output)
  .map((entry) => entry.name)
  .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
if (!files.length) throw new Error(`No PNG comparisons found in ${input}`);

const columns = 2;
const tileWidth = 400;
const imageHeight = 200;
const labelHeight = 26;
const rows = Math.ceil(files.length / columns);
const composites = [];
const escape = (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;');
for (const [index, name] of files.entries()) {
  const left = index % columns * tileWidth;
  const top = Math.floor(index / columns) * (imageHeight + labelHeight);
  composites.push({ input: await sharp(path.join(input, name))
    .resize(tileWidth, imageHeight, { fit: 'fill' }).png().toBuffer(), left, top: top + labelHeight });
  composites.push({ input: Buffer.from(`<svg width="${tileWidth}" height="${labelHeight}">
    <rect width="100%" height="100%" fill="#20252c"/>
    <text x="7" y="18" fill="white" font-family="Arial" font-size="13">${escape(path.basename(name, '.png'))} · LT | Photoshop</text>
  </svg>`), left, top });
}
await mkdir(path.dirname(output), { recursive: true });
await sharp({ create: { width: columns * tileWidth, height: rows * (imageHeight + labelHeight),
  channels: 3, background: '#15191f' } }).composite(composites).png().toFile(output);
process.stdout.write(`${output}\n`);
