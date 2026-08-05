import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { initializeCanvas, readPsd } from 'ag-psd';
import sharp from 'sharp';

const source = path.resolve(process.argv[2] ?? '');
const candidate = path.resolve(process.argv[3] ?? '');
if (!process.argv[2] || !process.argv[3]) {
  throw new Error('Usage: node scripts/compare-psd-render.mjs <reference.psd> <photoshop-render.png>');
}

// Composite decoding needs ImageData but no drawing surface. This keeps the
// parity check headless and avoids introducing a native canvas dependency.
initializeCanvas(
  () => { throw new Error('A canvas was unexpectedly requested.'); },
  (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) })
);

const psd = readPsd(await readFile(source), {
  useImageData: true,
  skipLayerImageData: true,
  skipThumbnail: true
});
if (!psd.imageData) throw new Error(`PSD has no composite image: ${source}`);
const rendered = await sharp(candidate).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const reference = psd.imageData;
if (reference.width !== rendered.info.width || reference.height !== rendered.info.height) {
  throw new Error(
    `Render dimensions differ: ${reference.width}x${reference.height} vs `
      + `${rendered.info.width}x${rendered.info.height}`
  );
}

let changedPixels = 0;
let significantPixels = 0;
let deltaSum = 0;
let maximumDelta = 0;
for (let offset = 0; offset < reference.data.length; offset += 4) {
  let delta = 0;
  for (let channel = 0; channel < 4; channel += 1) {
    delta = Math.max(delta, Math.abs(
      reference.data[offset + channel] - rendered.data[offset + channel]
    ));
  }
  if (delta > 0) {
    changedPixels += 1;
    deltaSum += delta;
    maximumDelta = Math.max(maximumDelta, delta);
  }
  if (delta > 8) significantPixels += 1;
}
const pixelCount = reference.width * reference.height;
const result = {
  source,
  candidate,
  width: reference.width,
  height: reference.height,
  changedPixels,
  changedPercent: changedPixels / pixelCount * 100,
  significantPixels,
  significantPercent: significantPixels / pixelCount * 100,
  meanChangedDelta: changedPixels ? deltaSum / changedPixels : 0,
  maximumDelta
};
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

// A tiny antialiasing fringe is accepted; visible or structural differences are not.
if (result.significantPercent > 0.01 || result.maximumDelta > 16) {
  throw new Error('PSD render parity exceeded the release-candidate tolerance.');
}
