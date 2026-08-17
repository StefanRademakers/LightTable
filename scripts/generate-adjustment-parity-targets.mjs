import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import sharp from 'sharp';

const output = path.resolve(process.argv[2]
  ?? 'D:\\mediavibe\\LightTableTests\\AdjustmentParity\\targets');
await mkdir(output, { recursive: true });

const hueToRgb = (p, q, sourceHue) => {
  const hue = ((sourceHue % 1) + 1) % 1;
  if (hue < 1 / 6) return p + (q - p) * 6 * hue;
  if (hue < 1 / 2) return q;
  if (hue < 2 / 3) return p + (q - p) * (2 / 3 - hue) * 6;
  return p;
};
const hslToRgb = (hue, saturation, lightness) => {
  if (saturation === 0) return [lightness, lightness, lightness];
  const q = lightness < 0.5
    ? lightness * (1 + saturation)
    : lightness + saturation - lightness * saturation;
  const p = 2 * lightness - q;
  return [hueToRgb(p, q, hue + 1 / 3), hueToRgb(p, q, hue), hueToRgb(p, q, hue - 1 / 3)];
};

const width = 720;
const height = 256;
const pixels = Buffer.alloc(width * height * 3);
for (let y = 0; y < height; y += 1) {
  const lightness = 0.05 + 0.9 * y / (height - 1);
  for (let x = 0; x < width; x += 1) {
    const rgb = hslToRgb(x / width, 1, lightness);
    const offset = (y * width + x) * 3;
    pixels[offset] = Math.round(rgb[0] * 255);
    pixels[offset + 1] = Math.round(rgb[1] * 255);
    pixels[offset + 2] = Math.round(rgb[2] * 255);
  }
}
await sharp(pixels, { raw: { width, height, channels: 3 } })
  .png({ compressionLevel: 9 })
  .toFile(path.join(output, 'hue-lightness-ramp.png'));
process.stdout.write(`${path.join(output, 'hue-lightness-ramp.png')}\n`);
