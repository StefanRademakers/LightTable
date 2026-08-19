import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const input = process.argv[2]
  ?? 'D:/mediavibe/LightTableTests/AdjustmentParity/color-vibrance-wb10/photoshop';
const colorInput = process.argv[3]
  ?? 'D:/mediavibe/LightTableTests/AdjustmentParity/color-vibrance-grid/photoshop';
const output = process.argv[4]
  ?? 'packages/lighttable-app/src/assets/color-vibrance/photoshop-temperature-tint-v2.bin';
const SOURCE_SIZE = 17;
const WHITE_BALANCE_NODES = [0, 2, 4, 6, 8, 10, 12, 14, 16];
const COLOR_NODES = Array.from({ length: SOURCE_SIZE }, (_, index) => index);
const KNOTS = Array.from({ length: 21 }, (_, index) => index * 10 - 100);
const COLOR_KNOTS = [-100, -80, -20, 0, 20, 80, 100];
const HEADROOM = 64;
const HEADROOM_QUANTIZATION = 1.5;
const tables = [];

const latticeIndex = (red, green, blue, channel) => (
  (blue * SOURCE_SIZE ** 2 + green * SOURCE_SIZE + red) * 3 + channel
);

const recoverHeadroom = (data) => {
  const result = Float64Array.from(data);
  const directions = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
  for (let blue = 0; blue < SOURCE_SIZE; blue += 1) for (let green = 0; green < SOURCE_SIZE; green += 1) {
    for (let red = 0; red < SOURCE_SIZE; red += 1) for (let channel = 0; channel < 3; channel += 1) {
      const target = latticeIndex(red, green, blue, channel);
      const clipped = data[target];
      if (clipped !== 0 && clipped !== 255) continue;
      const estimates = [];
      for (const [redStep, greenStep, blueStep] of directions) {
        const samples = [];
        for (let distance = 1; distance < SOURCE_SIZE; distance += 1) {
          const r = red + redStep * distance;
          const g = green + greenStep * distance;
          const b = blue + blueStep * distance;
          if (r < 0 || r >= SOURCE_SIZE || g < 0 || g >= SOURCE_SIZE || b < 0 || b >= SOURCE_SIZE) break;
          const value = data[latticeIndex(r, g, b, channel)];
          if (value > 0 && value < 255) {
            samples.push({ distance, value });
            if (samples.length === 2) break;
          }
        }
        if (samples.length !== 2) continue;
        const slope = (samples[1].value - samples[0].value) / (samples[1].distance - samples[0].distance);
        const estimate = samples[0].value - slope * samples[0].distance;
        if ((clipped === 255 && estimate >= 250) || (clipped === 0 && estimate <= 5)) estimates.push(estimate);
      }
      if (estimates.length) {
        const estimate = estimates.reduce((sum, value) => sum + value, 0) / estimates.length;
        result[target] = Math.max(-HEADROOM, Math.min(255 + HEADROOM, estimate));
      }
    }
  }
  return result;
};

for (const temperature of KNOTS) {
  for (const tint of KNOTS) {
    const file = path.join(input, `wb10-temperature-${temperature}-tint-${tint}.png`);
    const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    if (info.width !== SOURCE_SIZE ** 2 || info.height !== SOURCE_SIZE || info.channels !== 3) {
      throw new Error(`Unexpected Photoshop oracle dimensions: ${file}`);
    }
    const recovered = recoverHeadroom(data);
    const selected = Buffer.alloc(WHITE_BALANCE_NODES.length ** 3 * 3);
    let target = 0;
    for (const blue of WHITE_BALANCE_NODES) {
      for (const green of WHITE_BALANCE_NODES) {
        for (const red of WHITE_BALANCE_NODES) {
          const source = (blue * SOURCE_SIZE ** 2 + green * SOURCE_SIZE + red) * 3;
          selected[target++] = Math.round((recovered[source] + HEADROOM) / HEADROOM_QUANTIZATION);
          selected[target++] = Math.round((recovered[source + 1] + HEADROOM) / HEADROOM_QUANTIZATION);
          selected[target++] = Math.round((recovered[source + 2] + HEADROOM) / HEADROOM_QUANTIZATION);
        }
      }
    }
    tables.push(selected);
  }
}

for (const vibrance of COLOR_KNOTS) {
  for (const saturation of COLOR_KNOTS) {
    const file = path.join(colorInput, `color-vibrance-${vibrance}-saturation-${saturation}.png`);
    const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    if (info.width !== SOURCE_SIZE ** 2 || info.height !== SOURCE_SIZE || info.channels !== 3) {
      throw new Error(`Unexpected Photoshop color oracle dimensions: ${file}`);
    }
    const selected = Buffer.alloc(COLOR_NODES.length ** 3 * 3);
    let target = 0;
    for (const blue of COLOR_NODES) for (const green of COLOR_NODES) for (const red of COLOR_NODES) {
      const source = latticeIndex(red, green, blue, 0);
      selected[target++] = data[source];
      selected[target++] = data[source + 1];
      selected[target++] = data[source + 2];
    }
    tables.push(selected);
  }
}

const bytes = Buffer.concat(tables);
const expected = KNOTS.length ** 2 * WHITE_BALANCE_NODES.length ** 3 * 3
  + COLOR_KNOTS.length ** 2 * COLOR_NODES.length ** 3 * 3;
if (bytes.length !== expected) throw new Error(`Expected ${expected} bytes, generated ${bytes.length}.`);
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, bytes);
console.log(`Generated ${output}: ${bytes.length} bytes.`);
