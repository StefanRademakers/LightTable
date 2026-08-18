import { createHash } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import sharp from 'sharp';

const manifestPath = path.join(import.meta.dirname, 'grade-camera-raw-corpus.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const rootArgument = process.argv.find((value) => value.startsWith('--root='));
const root = path.resolve(rootArgument?.slice('--root='.length) ?? manifest.externalRoot);
const sourceDirectory = path.join(root, 'sources');
await mkdir(sourceDirectory, { recursive: true });

const rgb8 = async (width, height, pixel, target, profile = 'srgb') => {
  const data = Buffer.allocUnsafe(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const color = pixel(x, y, width, height);
      const offset = (y * width + x) * 3;
      data[offset] = color[0];
      data[offset + 1] = color[1];
      data[offset + 2] = color[2];
    }
  }
  await sharp(data, { raw: { width, height, channels: 3 } })
    .withIccProfile(profile, { attach: true }).png({ compressionLevel: 9 }).toFile(target);
};

const generators = {
  'grayscale-ramp': (target) => rgb8(1024, 256, (x, y, width, height) => {
    const horizontal = Math.round(255 * x / (width - 1));
    const stepped = Math.round(255 * Math.floor(x / 64) / 15);
    const value = y < height / 2 ? horizontal : stepped;
    return [value, value, value];
  }, target),
  'tonal-steps': (target) => rgb8(1024, 384, (x, y, width) => {
    const band = Math.floor(y / 128);
    const step = Math.min(31, Math.floor(x / (width / 32)));
    const values = band === 0
      ? [0, 1, 2, 3, 4, 6, 8, 10, 12, 16, 20, 24, 28, 32, 36, 40,
        48, 56, 64, 72, 80, 88, 96, 104, 112, 120, 128, 144, 160, 176, 192, 208]
      : band === 1
        ? Array.from({ length: 32 }, (_, index) => Math.round(index * 255 / 31))
        : [47, 63, 79, 95, 111, 127, 143, 159, 175, 191, 207, 215, 223, 227, 231, 235,
          239, 241, 243, 245, 247, 249, 250, 251, 252, 253, 254, 254, 255, 255, 255, 255];
    const value = values[step];
    return [value, value, value];
  }, target),
  'color-target': (target) => {
    const patches = [
      [255, 0, 0], [255, 128, 0], [255, 255, 0], [0, 255, 0],
      [0, 255, 255], [0, 0, 255], [128, 0, 255], [255, 0, 255],
      [214, 158, 126], [183, 112, 84], [244, 194, 157], [116, 74, 57],
      [245, 245, 245], [192, 192, 192], [96, 96, 96], [12, 12, 12]
    ];
    return rgb8(1024, 512, (x, y, width, height) => {
      if (y < height / 2) {
        const index = Math.min(15, Math.floor(x / (width / 8)) + (y >= height / 4 ? 8 : 0));
        return patches[index];
      }
      const hue = x / (width - 1) * 6;
      const sector = Math.floor(hue) % 6;
      const fraction = hue - Math.floor(hue);
      const a = Math.round(255 * (1 - fraction));
      const b = Math.round(255 * fraction);
      const wheel = [[255, b, 0], [a, 255, 0], [0, 255, b], [0, a, 255], [b, 0, 255], [255, 0, a]][sector];
      const saturation = 1 - (y - height / 2) / (height / 2 - 1) * 0.85;
      const gray = 128;
      return wheel.map((value) => Math.round(gray + (value - gray) * saturation));
    }, target);
  },
  'wide-gamut-color': (target) => rgb8(1024, 384, (x, y, width, height) => {
    if (y < height / 3) {
      const patches = [
        [255, 0, 0], [255, 128, 0], [255, 255, 0], [0, 255, 0],
        [0, 255, 255], [0, 0, 255], [128, 0, 255], [255, 0, 255]
      ];
      return patches[Math.min(7, Math.floor(x / (width / 8)))];
    }
    const hue = x / (width - 1) * 6;
    const sector = Math.floor(hue) % 6;
    const fraction = hue - Math.floor(hue);
    const a = Math.round(255 * (1 - fraction));
    const b = Math.round(255 * fraction);
    const wheel = [[255, b, 0], [a, 255, 0], [0, 255, b], [0, a, 255], [b, 0, 255], [255, 0, a]][sector];
    const row = (y - height / 3) / (height * 2 / 3 - 1);
    const scale = 1 - row * 0.7;
    return wheel.map((value) => Math.round(128 + (value - 128) * scale));
  }, target, 'p3'),
  'frequency-detail': (target) => rgb8(1024, 512, (x, y, width, height) => {
    const band = Math.floor(y / (height / 4));
    const frequencies = [2, 8, 24, 64];
    const phase = Math.sin(x / width * Math.PI * 2 * frequencies[band]);
    const edge = x > width / 2 ? 42 : -42;
    const value = Math.max(0, Math.min(255, Math.round(128 + phase * 42 + edge)));
    return [value, value, value];
  }, target),
  'multiscale-noise': (target) => {
    let state = 0x9e3779b9;
    const random = () => {
      state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
      return (state >>> 0) / 0xffffffff;
    };
    const coarse = new Float32Array(64 * 32);
    for (let index = 0; index < coarse.length; index += 1) coarse[index] = random() - 0.5;
    return rgb8(1024, 512, (x, y) => {
      const base = y < 256 ? 64 : 192;
      const broad = coarse[Math.floor(y / 16) * 64 + Math.floor(x / 16)] * 34;
      const fine = (random() - 0.5) * 42;
      const chroma = (random() - 0.5) * 34;
      return [base + broad + fine + chroma, base + broad + fine, base + broad + fine - chroma]
        .map((value) => Math.max(0, Math.min(255, Math.round(value))));
    }, target);
  }
};

const inventory = [];
for (const source of manifest.sources) {
  const file = source.kind === 'generated' ? path.join(sourceDirectory, source.file) : source.file;
  if (source.kind === 'generated') {
    const generator = generators[source.generator];
    if (!generator) throw new Error(`Unknown Grade corpus generator: ${source.generator}`);
    await generator(file);
  } else {
    await access(file);
  }
  const [bytes, metadata] = await Promise.all([readFile(file), sharp(file).metadata()]);
  inventory.push({
    id: source.id,
    file,
    kind: source.kind,
    roles: source.roles,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    byteLength: bytes.length,
    width: metadata.width,
    height: metadata.height,
    format: metadata.format,
    space: metadata.space,
    depth: metadata.depth,
    channels: metadata.channels,
    hasProfile: Boolean(metadata.icc?.length),
    declaredProfile: source.profile ?? null,
    iccSha256: metadata.icc?.length
      ? createHash('sha256').update(metadata.icc).digest('hex')
      : null
  });
}

const coveredRoles = new Set(inventory.flatMap((source) => source.roles));
const missingRoles = manifest.requiredRoles.filter((role) => !coveredRoles.has(role));
if (missingRoles.length) throw new Error(`Grade corpus roles missing: ${missingRoles.join(', ')}`);
await writeFile(path.join(root, 'inventory.json'), `${JSON.stringify({
  schema: 1,
  generatedAt: new Date().toISOString(),
  manifest: manifestPath,
  sources: inventory
}, null, 2)}\n`);
process.stdout.write(`Prepared ${inventory.length} Grade parity sources in ${root}.\n`);
