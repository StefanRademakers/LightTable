import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { initializeCanvas, writePsdUint8Array } from 'ag-psd';

initializeCanvas(
  () => { throw new Error('The headless corpus generator unexpectedly requested a canvas.'); },
  (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) })
);

const root = path.resolve(process.argv[2]
  ?? 'D:\\mediavibe\\LightTableTestFiles\\psd\\layer-effects-roundtrip');
const sourceDirectory = path.join(root, 'source');
const canonicalDirectory = path.join(root, 'photoshop-canonical');
const referenceDirectory = path.join(root, 'photoshop-reference');
const lightTableDirectory = path.join(root, 'lighttable');
const differenceDirectory = path.join(root, 'difference');
await Promise.all([sourceDirectory, canonicalDirectory, referenceDirectory,
  lightTableDirectory, differenceDirectory].map((directory) => mkdir(directory, { recursive: true })));

const px = (value) => ({ units: 'Pixels', value });
const color = (r, g, b) => ({ r, g, b });
const contour = { name: 'Linear', curve: [{ x: 0, y: 0 }, { x: 255, y: 255 }] };
const common = (blendMode = 'normal', opacity = 1) => ({
  present: true, showInDialog: true, enabled: true, blendMode, opacity
});
const shadow = (kind, size, distance, spread = 0, angle = 120) => ({
  [kind]: [{ ...common('multiply', 0.72), color: color(18, 42, 86), size: px(size),
    distance: px(distance), choke: px(spread * 100), angle, useGlobalLight: false,
    antialiased: true, contour, ...(kind === 'dropShadow' ? { layerConceals: true } : {}) }]
});
const glow = (kind, size, choke = 0, source = 'edge') => ({
  [kind]: { ...common('screen', 0.82), color: color(255, 74, 40), size: px(size),
    choke: px(choke * 100), source, technique: 'softer', antialiased: true,
    noise: 0, range: 0.5, jitter: 0, contour }
});
const stroke = (size, position, fillType = 'color') => ({
  stroke: [{ ...common('normal', 1), size: px(size), position, fillType,
    color: color(0, 119, 255), overprint: false }]
});
const gradient = {
  name: 'Corpus blue to magenta', type: 'solid', smoothness: 1,
  colorStops: [
    { color: color(0, 119, 255), location: 0, midpoint: 0.5 },
    { color: color(255, 0, 119), location: 1, midpoint: 0.5 }
  ],
  opacityStops: [
    { opacity: 1, location: 0, midpoint: 0.5 },
    { opacity: 1, location: 1, midpoint: 0.5 }
  ]
};

const cases = [];
const add = (id, family, parameters, effects) => cases.push({ id, family, parameters, effects });
for (const size of [3, 10, 30, 100]) add(`drop-shadow-size-${size}`, 'drop-shadow', { size, distance: 30 }, shadow('dropShadow', size, 30));
for (const spread of [0.25, 0.5]) add(`drop-shadow-spread-${spread * 100}`, 'drop-shadow', { size: 60, distance: 20, spread }, shadow('dropShadow', 60, 20, spread));
for (const distance of [0, 80]) add(`drop-shadow-distance-${distance}`, 'drop-shadow', { size: 30, distance }, shadow('dropShadow', 30, distance));
for (const size of [3, 30, 100]) add(`inner-shadow-size-${size}`, 'inner-shadow', { size, distance: 20 }, shadow('innerShadow', size, 20));
add('inner-shadow-choke-50', 'inner-shadow', { size: 60, distance: 20, choke: 0.5 }, shadow('innerShadow', 60, 20, 0.5));
for (const size of [3, 30, 100]) add(`outer-glow-size-${size}`, 'outer-glow', { size }, glow('outerGlow', size));
add('outer-glow-choke-50', 'outer-glow', { size: 60, choke: 0.5 }, glow('outerGlow', 60, 0.5));
for (const size of [3, 30, 100]) add(`inner-glow-size-${size}`, 'inner-glow', { size, source: 'edge' }, glow('innerGlow', size));
add('inner-glow-center', 'inner-glow', { size: 60, source: 'center' }, glow('innerGlow', 60, 0, 'center'));
for (const size of [1, 5, 10, 50, 200]) add(`stroke-outside-${size}`, 'stroke', { size, position: 'outside' }, stroke(size, 'outside'));
for (const position of ['inside', 'center']) add(`stroke-${position}-50`, 'stroke', { size: 50, position }, stroke(50, position));
add('color-overlay', 'color-overlay', { opacity: 0.65 }, {
  solidFill: [{ ...common('normal', 0.65), color: color(0, 205, 116) }]
});
for (const type of ['linear', 'radial', 'angle', 'reflected', 'diamond']) add(`gradient-overlay-${type}`, 'gradient-overlay', { type }, {
  gradientOverlay: [{ ...common(), gradient, type, angle: 35, scale: 1.15,
    align: true, reverse: false, dither: false, offset: { x: 0.12, y: -0.08 },
    interpolationMethod: 'classic' }]
});
for (const size of [10, 60]) add(`satin-size-${size}`, 'satin', { size, distance: 35 }, {
  satin: { ...common('multiply', 0.65), color: color(30, 20, 70), size: px(size),
    distance: px(35), angle: 35, antialiased: true, invert: true, contour }
});
for (const size of [3, 20, 80]) add(`bevel-inner-${size}`, 'bevel-emboss', { size }, {
  bevel: { ...common(), size: px(size), soften: px(0), angle: 120, altitude: 30,
    strength: 1.5, useGlobalLight: false, highlightBlendMode: 'screen',
    shadowBlendMode: 'multiply', highlightColor: color(255, 255, 255),
    shadowColor: color(0, 0, 0), highlightOpacity: 0.75, shadowOpacity: 0.75,
    style: 'inner bevel', technique: 'smooth', direction: 'up',
    antialiasGloss: true, useTexture: false, contour }
});
add('combined-shadow-stroke-glow', 'combined', {}, {
  ...shadow('dropShadow', 30, 30).dropShadow && shadow('dropShadow', 30, 30),
  ...stroke(10, 'outside'), ...glow('innerGlow', 18)
});
add('combined-overlay-bevel-satin', 'combined', {}, {
  solidFill: [{ ...common('normal', 0.7), color: color(0, 190, 115) }],
  satin: { ...common('multiply', 0.45), color: color(18, 35, 80), size: px(35),
    distance: px(25), angle: 45, antialiased: true, invert: true, contour },
  bevel: { ...common(), size: px(12), soften: px(1), angle: 120, altitude: 30,
    strength: 1.25, useGlobalLight: false, highlightBlendMode: 'screen', shadowBlendMode: 'multiply',
    highlightColor: color(255, 255, 255), shadowColor: color(0, 0, 0),
    highlightOpacity: 0.7, shadowOpacity: 0.65, style: 'inner bevel', technique: 'smooth',
    direction: 'up', antialiasGloss: true, useTexture: false, contour }
});

const WIDTH = 768;
const HEIGHT = 768;
const makePixels = (width, height, fill) => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < data.length; offset += 4) data.set(fill, offset);
  return { width, height, data };
};
const artwork = () => {
  const width = 280;
  const height = 280;
  const image = makePixels(width, height, [0, 0, 0, 0]);
  // A warm midtone keeps black shadows, white highlights and saturated
  // overlays simultaneously visible in the Photoshop and LightTable goldens.
  const set = (x, y) => image.data.set([218, 156, 58, 255], (y * width + x) * 4);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const roundedBox = x >= 18 && x < 174 && y >= 18 && y < 174
      && !(x < 42 && y < 42 && Math.hypot(x - 42, y - 42) > 24)
      && !(x > 149 && y < 42 && Math.hypot(x - 149, y - 42) > 24);
    const sharpTriangle = y >= 116 && y < 258 && x >= 92 && x <= 270
      && x <= 92 + (y - 116) * 1.26 && x >= 270 - (y - 116) * 1.26;
    const hole = Math.hypot(x - 97, y - 91) < 34;
    if ((roundedBox || sharpTriangle) && !hole) set(x, y);
  }
  return image;
};

const jobs = [];
for (const entry of cases) {
  const source = path.join(sourceDirectory, `${entry.id}.psd`);
  const canonical = path.join(canonicalDirectory, `${entry.id}.psd`);
  const reference = path.join(referenceDirectory, `${entry.id}.png`);
  const background = makePixels(WIDTH, HEIGHT, [238, 241, 246, 255]);
  const psd = {
    width: WIDTH, height: HEIGHT, imageData: background,
    children: [
      { name: 'Background', imageData: background },
      { name: `FX ${entry.id}`, left: 244, top: 244, imageData: artwork(),
        effects: { disabled: false, scale: 1, ...entry.effects }, effectsOpen: true }
    ]
  };
  await writeFile(source, writePsdUint8Array(psd, {
    noBackground: true, trimImageData: true, generateThumbnail: false
  }));
  jobs.push({ ...entry, source, canonical, reference,
    lightTable: path.join(lightTableDirectory, `${entry.id}.png`),
    difference: path.join(differenceDirectory, `${entry.id}.png`) });
}
const manifest = { schema: 1, generatedAt: new Date().toISOString(), root,
  canvas: { width: WIDTH, height: HEIGHT }, cases: jobs };
await writeFile(path.join(root, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(path.join(root, 'photoshop-jobs.txt'), jobs
  .map(({ source, canonical, reference }) => [source, canonical, reference].join('|')).join('\n') + '\n');
process.stdout.write(`Generated ${jobs.length} PSD layer-effect cases in ${root}\n`);
