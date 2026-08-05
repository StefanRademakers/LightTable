import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { initializeCanvas, writePsdUint8Array } from 'ag-psd';

initializeCanvas(
  () => { throw new Error('The blend corpus generator unexpectedly requested a canvas.'); },
  (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) })
);

const root = path.resolve(process.argv[2] ?? 'D:\\Mediavibe\\LightTableTests\\BlendModes');
const directories = Object.fromEntries(['source', 'photoshop-canonical', 'photoshop',
  'lighttable', 'difference', 'compare', 'runtime'].map((name) => [name, path.join(root, name)]));
await Promise.all(Object.values(directories).map((directory) => mkdir(directory, { recursive: true })));

const WIDTH = 400;
const HEIGHT = 400;
const modes = ['normal', 'darken', 'multiply', 'color-burn', 'lighten', 'screen',
  'color-dodge', 'linear-dodge', 'overlay', 'soft-light', 'hard-light', 'difference',
  'hue', 'saturation', 'color', 'luminosity', 'linear-burn', 'darker-color',
  'lighter-color', 'vivid-light', 'linear-light', 'pin-light', 'hard-mix', 'exclusion',
  'subtract', 'divide'];
const variants = [
  ...modes.map((mode) => ({ id: mode, mode, opacity: 1, fillOpacity: 1 })),
  ...['normal', 'multiply', 'screen', 'overlay'].map((mode) => ({
    id: `${mode}-opacity-50`, mode, opacity: 0.5, fillOpacity: 1
  })),
  ...['multiply', 'overlay'].map((mode) => ({
    id: `${mode}-fill-50`, mode, opacity: 1, fillOpacity: 0.5
  }))
];
const psdMode = (mode) => mode.replaceAll('-', ' ');
const clampByte = (value) => Math.max(0, Math.min(255, Math.round(value)));
const mix = (left, right, amount) => left.map((value, index) =>
  clampByte(value * (1 - amount) + right[index] * amount));
const hsv = (hue, saturation = 1, value = 1) => {
  const sector = ((hue % 1) + 1) % 1 * 6;
  const chroma = value * saturation;
  const x = chroma * (1 - Math.abs(sector % 2 - 1));
  const values = sector < 1 ? [chroma, x, 0] : sector < 2 ? [x, chroma, 0]
    : sector < 3 ? [0, chroma, x] : sector < 4 ? [0, x, chroma]
      : sector < 5 ? [x, 0, chroma] : [chroma, 0, x];
  const offset = value - chroma;
  return values.map((channel) => clampByte((channel + offset) * 255));
};
const image = (foreground) => {
  const data = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
  for (let y = 0; y < HEIGHT; y += 1) for (let x = 0; x < WIDTH; x += 1) {
    const t = x / (WIDTH - 1);
    let rgb;
    let alpha = 255;
    if (y < 100) {
      const baseHue = hsv(t + (foreground ? 0.5 : 0));
      rgb = y < 50
        ? mix(baseHue, [255, 255, 255], y / 49)
        : mix(baseHue, [0, 0, 0], (y - 50) / 49);
    } else if (y < 200) {
      const band = Math.floor((y - 100) / 25);
      if (!foreground) {
        rgb = band === 0 ? [t * 255, t * 255, t * 255]
          : band === 1 ? [t * 255, (1 - t) * 255, 64]
            : band === 2 ? [48, t * 255, (1 - t) * 255]
              : [(1 - t) * 255, 64, t * 255];
      } else {
        rgb = band === 0 ? [(1 - t) * 255, t * 255, 128]
          : band === 1 ? [64, t * 255, (1 - t) * 255]
            : band === 2 ? [t * 255, 48, (1 - t) * 255]
              : hsv(t + 0.25);
        if (band === 3) alpha = clampByte(t * 255);
      }
    } else {
      const column = Math.min(15, Math.floor(x / 25));
      const row = Math.min(7, Math.floor((y - 200) / 25));
      const index = row * 16 + column;
      const swatch = [
        index % 8 / 7 * 255,
        Math.floor(index / 8) % 4 / 3 * 255,
        Math.floor(index / 32) % 4 / 3 * 255
      ];
      rgb = foreground ? [255 - swatch[2], swatch[0], 255 - swatch[1]] : swatch;
    }
    const offset = (y * WIDTH + x) * 4;
    data[offset] = clampByte(rgb[0]); data[offset + 1] = clampByte(rgb[1]);
    data[offset + 2] = clampByte(rgb[2]); data[offset + 3] = alpha;
  }
  return { width: WIDTH, height: HEIGHT, data };
};
const background = image(false);
const blendSource = image(true);
const cases = [];
for (const variant of variants) {
  const source = path.join(directories.source, `${variant.id}.psd`);
  const canonical = path.join(directories['photoshop-canonical'], `${variant.id}.psd`);
  const reference = path.join(directories.photoshop, `${variant.id}.png`);
  const lightTable = path.join(directories.lighttable, `${variant.id}.png`);
  const difference = path.join(directories.difference, `${variant.id}.png`);
  const compare = path.join(directories.compare, `${variant.id}.png`);
  const psd = { width: WIDTH, height: HEIGHT, imageData: background, children: [
    { name: 'Color profile base', imageData: background },
    { name: `Blend ${variant.id}`, imageData: blendSource, blendMode: psdMode(variant.mode),
      opacity: variant.opacity, fillOpacity: variant.fillOpacity }
  ] };
  await writeFile(source, writePsdUint8Array(psd, {
    noBackground: true, trimImageData: false, generateThumbnail: false
  }));
  cases.push({ ...variant, source, canonical, reference, lightTable, difference, compare });
}
await writeFile(path.join(root, 'manifest.json'), `${JSON.stringify({ schema: 1,
  generatedAt: new Date().toISOString(), root, canvas: { width: WIDTH, height: HEIGHT },
  modes, swatches: 128, cases }, null, 2)}\n`);
await writeFile(path.join(root, 'photoshop-jobs.txt'), `${cases
  .map(({ source, canonical, reference }) => `${source}|${canonical}|${reference}`).join('\n')}\n`);
process.stdout.write(`Generated ${cases.length} blend-mode PSDs in ${root}\n`);
