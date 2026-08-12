import path from 'node:path';
import process from 'node:process';
import { mkdir } from 'node:fs/promises';
import sharp from 'sharp';

const sources = process.argv.slice(2).map((entry) => path.resolve(entry));
if (sources.length === 0) {
  throw new Error('Pass one or more local portrait images to create Face Warp resolution fixtures.');
}

const outputRoot = path.resolve('tmp', 'face-warp-resolution-fixtures');
const sizes = [256, 512, 1024, 2048];
await mkdir(outputRoot, { recursive: true });

for (const source of sources) {
  const baseName = path.parse(source).name.replace(/[^a-z0-9_-]+/gi, '-');
  for (const size of sizes) {
    const destination = path.join(outputRoot, `${baseName}-${size}.png`);
    await sharp(source)
      .resize({ width: size, height: size, fit: 'inside', withoutEnlargement: false })
      .png()
      .toFile(destination);
    process.stdout.write(`${destination}\n`);
  }
}
