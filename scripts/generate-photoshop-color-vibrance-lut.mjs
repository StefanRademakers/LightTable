import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import sharp from 'sharp';

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index], process.argv[index + 1]);
}

const whiteBalanceRoot = args.get('--white-balance-root')
  ?? 'D:/mediavibe/LightTableTests/AdjustmentParity/color-vibrance-wb10/photoshop';
const colorRoot = args.get('--color-root')
  ?? 'D:/mediavibe/LightTableTests/AdjustmentParity/color-vibrance-grid/photoshop';
const output = args.get('--output')
  ?? 'packages/lighttable-app/src/lighttable/gpu/photoshopColorVibranceLut.generated.ts';

const SOURCE_SIZE = 17;
const LUT_SIZE = 13;
const HEADROOM_CODES = 64;
const WHITE_BALANCE_KNOTS = Array.from({ length: 21 }, (_, index) => index * 10 - 100);
const COLOR_KNOTS = [-100, -80, -20, 0, 20, 80, 100];

const latticeIndex = (red, green, blue, channel) => (
  (blue * SOURCE_SIZE * SOURCE_SIZE + green * SOURCE_SIZE + red) * 3 + channel
);

const recoverClippedHeadroom = (data) => {
  // Photoshop carries a bounded, unclipped white-balance result into the
  // coupled color stage. Recover its local tangent from the first two visible
  // lattice samples beside each clipped plateau, then retain only the measured
  // quarter-channel range that improved both signed extremes and held-out data.
  const result = Float64Array.from(data);
  const directions = [
    [1, 0, 0], [-1, 0, 0], [0, 1, 0],
    [0, -1, 0], [0, 0, 1], [0, 0, -1]
  ];
  for (let blue = 0; blue < SOURCE_SIZE; blue += 1) {
    for (let green = 0; green < SOURCE_SIZE; green += 1) {
      for (let red = 0; red < SOURCE_SIZE; red += 1) {
        for (let channel = 0; channel < 3; channel += 1) {
          const target = latticeIndex(red, green, blue, channel);
          const clipped = data[target];
          if (clipped !== 0 && clipped !== 255) continue;
          const estimates = [];
          for (const [redStep, greenStep, blueStep] of directions) {
            const samples = [];
            for (let distance = 1; distance < SOURCE_SIZE; distance += 1) {
              const sampleRed = red + redStep * distance;
              const sampleGreen = green + greenStep * distance;
              const sampleBlue = blue + blueStep * distance;
              if (sampleRed < 0 || sampleRed >= SOURCE_SIZE
                || sampleGreen < 0 || sampleGreen >= SOURCE_SIZE
                || sampleBlue < 0 || sampleBlue >= SOURCE_SIZE) break;
              const value = data[latticeIndex(sampleRed, sampleGreen, sampleBlue, channel)];
              if (value > 0 && value < 255) {
                samples.push({ distance, value });
                if (samples.length === 2) break;
              }
            }
            if (samples.length !== 2) continue;
            const slope = (samples[1].value - samples[0].value)
              / (samples[1].distance - samples[0].distance);
            const estimate = samples[0].value - slope * samples[0].distance;
            if ((clipped === 255 && estimate >= 250) || (clipped === 0 && estimate <= 5)) {
              estimates.push(estimate);
            }
          }
          if (estimates.length) {
            const estimate = estimates.reduce((sum, value) => sum + value, 0) / estimates.length;
            result[target] = Math.max(
              -HEADROOM_CODES,
              Math.min(255 + HEADROOM_CODES, estimate)
            );
          }
        }
      }
    }
  }
  return result;
};

const sampleSourceLattice = (data, red, green, blue, channel) => {
  const scaled = [red, green, blue].map((value) => value / (LUT_SIZE - 1) * (SOURCE_SIZE - 1));
  const lower = scaled.map((value) => Math.floor(value));
  const upper = scaled.map((value) => Math.min(SOURCE_SIZE - 1, Math.ceil(value)));
  const fraction = scaled.map((value, index) => value - lower[index]);
  let result = 0;
  for (let blueCorner = 0; blueCorner < 2; blueCorner += 1) {
    for (let greenCorner = 0; greenCorner < 2; greenCorner += 1) {
      for (let redCorner = 0; redCorner < 2; redCorner += 1) {
        const weight = (redCorner ? fraction[0] : 1 - fraction[0])
          * (greenCorner ? fraction[1] : 1 - fraction[1])
          * (blueCorner ? fraction[2] : 1 - fraction[2]);
        result += data[latticeIndex(
          redCorner ? upper[0] : lower[0],
          greenCorner ? upper[1] : lower[1],
          blueCorner ? upper[2] : lower[2],
          channel
        )] * weight;
      }
    }
  }
  return result;
};

const table = async (file, preserveHeadroom = false) => {
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.width !== SOURCE_SIZE * SOURCE_SIZE || info.height !== SOURCE_SIZE || info.channels !== 3) {
    throw new Error(`Unexpected oracle lattice dimensions: ${file}`);
  }
  const sourceData = preserveHeadroom ? recoverClippedHeadroom(data) : data;
  const result = preserveHeadroom
    ? new Int16Array(LUT_SIZE ** 3 * 3)
    : new Uint8Array(LUT_SIZE ** 3 * 3);
  let target = 0;
  for (let blue = 0; blue < LUT_SIZE; blue += 1) {
    for (let green = 0; green < LUT_SIZE; green += 1) {
      for (let red = 0; red < LUT_SIZE; red += 1) {
        result[target] = Math.round(sampleSourceLattice(sourceData, red, green, blue, 0));
        result[target + 1] = Math.round(sampleSourceLattice(sourceData, red, green, blue, 1));
        result[target + 2] = Math.round(sampleSourceLattice(sourceData, red, green, blue, 2));
        target += 3;
      }
    }
  }
  return result;
};

const whiteBalanceTables = [];
for (const temperature of WHITE_BALANCE_KNOTS) {
  for (const tint of WHITE_BALANCE_KNOTS) {
    whiteBalanceTables.push(await table(path.join(
      whiteBalanceRoot,
      `wb10-temperature-${temperature}-tint-${tint}.png`
    ), true));
  }
}
const colorTables = [];
for (const vibrance of COLOR_KNOTS) {
  for (const saturation of COLOR_KNOTS) {
    colorTables.push(await table(path.join(
      colorRoot,
      `color-vibrance-${vibrance}-saturation-${saturation}.png`
    )));
  }
}

const whiteBalanceBytes = Buffer.concat(whiteBalanceTables.map((value) => Buffer.from(
  value.buffer, value.byteOffset, value.byteLength
)));
const colorBytes = Buffer.concat(colorTables.map((value) => Buffer.from(value)));
const expectedVoxels = LUT_SIZE ** 3 * 3;
if (whiteBalanceBytes.length !== WHITE_BALANCE_KNOTS.length ** 2 * expectedVoxels * 2
  || colorBytes.length !== COLOR_KNOTS.length ** 2 * expectedVoxels) {
  throw new Error('Generated Color and Vibrance LUT has an invalid size.');
}
const wrapBase64 = (bytes) => bytes.toString('base64').match(/.{1,120}/g)
  ?.map((line) => `  '${line}'`).join(',\n') ?? "  ''";
const whiteBalanceBase64 = wrapBase64(whiteBalanceBytes);
const colorBase64 = wrapBase64(colorBytes);
const source = `// Generated by scripts/generate-photoshop-color-vibrance-lut.mjs. Do not edit.\n`
  + `export const PHOTOSHOP_COLOR_VIBRANCE_LUT_SIZE = ${LUT_SIZE};\n`
  + `export const PHOTOSHOP_COLOR_VIBRANCE_HEADROOM_CODES = ${HEADROOM_CODES};\n`
  + `export const PHOTOSHOP_COLOR_VIBRANCE_WHITE_BALANCE_KNOTS = ${JSON.stringify(WHITE_BALANCE_KNOTS)} as const;\n`
  + `export const PHOTOSHOP_COLOR_VIBRANCE_COLOR_KNOTS = ${JSON.stringify(COLOR_KNOTS)} as const;\n`
  + `export const PHOTOSHOP_COLOR_VIBRANCE_WHITE_BALANCE_LUT_BASE64 = [\n${whiteBalanceBase64}\n].join('');\n`
  + `export const PHOTOSHOP_COLOR_VIBRANCE_COLOR_LUT_BASE64 = [\n${colorBase64}\n].join('');\n`;
await fs.writeFile(output, source);
console.log(`Generated ${output} (${whiteBalanceBytes.length + colorBytes.length} LUT bytes).`);
