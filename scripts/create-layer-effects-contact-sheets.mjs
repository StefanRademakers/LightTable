import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import sharp from 'sharp';

const root = path.resolve(process.argv[2]
  ?? 'D:\\mediavibe\\LightTableTestFiles\\psd\\layer-effects-roundtrip');
const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
const output = path.join(root, 'contact-sheets');
await mkdir(output, { recursive: true });
const groups = new Map();
for (const entry of manifest.cases) {
  const group = groups.get(entry.family) ?? [];
  group.push(entry);
  groups.set(entry.family, group);
}
const thumb = 180;
const labelHeight = 28;
const columns = 2;
const tileWidth = thumb * 3;
const tileHeight = thumb + labelHeight;

const escape = (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;');
for (const [family, entries] of groups) {
  const rows = Math.ceil(entries.length / columns);
  const composites = [];
  for (const [index, entry] of entries.entries()) {
    const x = index % columns * tileWidth;
    const y = Math.floor(index / columns) * tileHeight;
    const sources = [entry.reference,
      path.join(root, 'lighttable', `${entry.id}-import.png`),
      path.join(root, 'difference', `${entry.id}-import.png`)];
    for (const [column, source] of sources.entries()) {
      composites.push({ input: await sharp(source).resize(thumb, thumb).png().toBuffer(),
        left: x + column * thumb, top: y + labelHeight });
    }
    const label = Buffer.from(`<svg width="${tileWidth}" height="${labelHeight}">
      <rect width="100%" height="100%" fill="#20252c"/>
      <text x="8" y="19" fill="white" font-family="Arial" font-size="14">${escape(entry.id)} · Photoshop | LightTable | 4× diff</text>
    </svg>`);
    composites.push({ input: label, left: x, top: y });
  }
  const file = path.join(output, `${family}.png`);
  await sharp({ create: { width: tileWidth * columns, height: tileHeight * rows,
    channels: 4, background: '#15191f' } }).composite(composites).png().toFile(file);
  process.stdout.write(`${file}\n`);
}
