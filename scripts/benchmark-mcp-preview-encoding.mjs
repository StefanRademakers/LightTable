import { _electron as electron } from 'playwright-core';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { resolveDesktopTestLaunch } from './desktop-test-startup.mjs';

const root = path.resolve(import.meta.dirname, '..');
const launch = await resolveDesktopTestLaunch(root);
const userData = await mkdtemp(path.join(tmpdir(), 'lighttable-preview-benchmark-'));
const environment = { ...process.env, LIGHTTABLE_AUTOMATION_USER_DATA: userData };
delete environment.ELECTRON_RUN_AS_NODE;

let app;
try {
  app = await electron.launch({
    executablePath: launch.executablePath,
    args: launch.args,
    cwd: root,
    env: environment,
    timeout: 30_000
  });
  const page = await app.firstWindow({ timeout: 30_000 });
  const result = await page.evaluate(async () => {
    const pixels = (width, height) => {
      const value = new Uint8ClampedArray(width * height * 4);
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const offset = (y * width + x) * 4;
          const grain = ((x * 17 + y * 31) ^ (x * y)) & 31;
          value[offset] = (x * 255 / width + grain) & 255;
          value[offset + 1] = (y * 255 / height + grain * 2) & 255;
          value[offset + 2] = ((x + y) * 127 / Math.max(width, height) + grain * 3) & 255;
          value[offset + 3] = 255;
        }
      }
      return value;
    };
    const encode = async (data, width, height, type, quality) => {
      const canvas = new OffscreenCanvas(width, height);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('2D OffscreenCanvas is unavailable.');
      context.putImageData(new ImageData(data, width, height), 0, 0);
      const blob = await canvas.convertToBlob({ type, ...(quality ? { quality } : {}) });
      if (blob.type !== type) throw new Error(`Expected ${type}, received ${blob.type}.`);
      return blob;
    };
    const input512 = pixels(512, 512);
    const input1024 = pixels(1024, 1024);
    const cases = {
      png1024: () => encode(input1024, 1024, 1024, 'image/png'),
      legacyWebp512: async () => {
        const png = await encode(input512, 512, 512, 'image/png');
        const bitmap = await createImageBitmap(png);
        try {
          const canvas = new OffscreenCanvas(512, 512);
          const context = canvas.getContext('2d');
          if (!context) throw new Error('2D OffscreenCanvas is unavailable.');
          context.drawImage(bitmap, 0, 0);
          return canvas.convertToBlob({ type: 'image/webp', quality: 0.78 });
        } finally {
          bitmap.close();
        }
      },
      directWebp512: () => encode(input512, 512, 512, 'image/webp', 0.78)
    };
    const samples = Object.fromEntries(Object.keys(cases).map((name) => [name, []]));
    for (const operation of Object.values(cases)) await operation();
    for (let iteration = 0; iteration < 12; iteration += 1) {
      const order = Object.keys(cases).slice(iteration % 3).concat(Object.keys(cases).slice(0, iteration % 3));
      for (const name of order) {
        const started = performance.now();
        const blob = await cases[name]();
        samples[name].push({ durationMs: performance.now() - started, bytes: blob.size });
      }
    }
    const percentile = (values, fraction) => {
      const sorted = [...values].sort((a, b) => a - b);
      return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
    };
    return Object.fromEntries(Object.entries(samples).map(([name, values]) => [name, {
      samples: values.length,
      medianMs: percentile(values.map(({ durationMs }) => durationMs), 0.5),
      p95Ms: percentile(values.map(({ durationMs }) => durationMs), 0.95),
      medianBytes: percentile(values.map(({ bytes }) => bytes), 0.5)
    }]));
  });
  const legacyMedian = result.legacyWebp512.medianMs;
  const directMedian = result.directWebp512.medianMs;
  const pngBytes = result.png1024.medianBytes;
  const webpBytes = result.directWebp512.medianBytes;
  process.stdout.write(`${JSON.stringify({
    fixture: 'deterministic synthetic RGBA',
    result,
    comparison: {
      directWebpMedianSpeedupPercent: ((legacyMedian - directMedian) / legacyMedian) * 100,
      webpPayloadReductionVersus1024PngPercent: ((pngBytes - webpBytes) / pngBytes) * 100,
      pngToWebpPayloadRatio: pngBytes / webpBytes
    }
  }, null, 2)}\n`);
} finally {
  await app?.close().catch(() => undefined);
  await rm(userData, { recursive: true, force: true });
}
