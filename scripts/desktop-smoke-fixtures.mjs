import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

export const prepareRasterSmokeSource = async (outputDirectory, suppliedPath) => {
  if (suppliedPath) {
    const resolved = path.resolve(suppliedPath);
    await access(resolved);
    return resolved;
  }
  await mkdir(outputDirectory, { recursive: true });
  const target = path.join(outputDirectory, 'Background.png');
  await sharp({
    create: {
      width: 1024,
      height: 768,
      channels: 4,
      background: { r: 58, g: 77, b: 96, alpha: 1 }
    }
  }).png().toFile(target);
  return target;
};

export const prepareVectorSmokeSource = async (outputDirectory, suppliedPath) => {
  if (suppliedPath) {
    const resolved = path.resolve(suppliedPath);
    await access(resolved);
    return resolved;
  }
  await mkdir(outputDirectory, { recursive: true });
  const target = path.join(outputDirectory, 'vector-lifecycle.svg');
  await writeFile(target, `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="768" viewBox="0 0 1024 768">
  <rect width="1024" height="768" fill="#263544"/>
  <path d="M128 560 C240 120 640 96 896 520 C680 688 352 680 128 560 Z" fill="#3ea6ff" stroke="#f7d154" stroke-width="18"/>
</svg>\n`);
  return target;
};
