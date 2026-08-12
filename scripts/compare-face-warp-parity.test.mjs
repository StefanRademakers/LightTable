import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import sharp from 'sharp';

const execFileAsync = promisify(execFile);
const comparator = path.resolve(import.meta.dirname, 'compare-face-warp-parity.mjs');
const fixture = async (photoshopPixel) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'lighttable-face-warp-compare-'));
  const identity = Buffer.from([20, 30, 40, 255]);
  const changed = Buffer.from([40, 30, 40, 255]);
  const png = (pixels, file) => sharp(pixels, {
    raw: { width: 1, height: 1, channels: 4 }
  }).png().toFile(path.join(directory, file));
  await Promise.all([
    png(identity, 'lighttable-identity.png'),
    png(identity, 'photoshop-identity.png'),
    png(changed, 'lighttable-face-width-plus-50.png'),
    png(photoshopPixel, 'photoshop-face-width-plus-50.png')
  ]);
  await writeFile(path.join(directory, 'manifest.json'), JSON.stringify({
    identity: 'lighttable-identity.png',
    cases: [{ name: 'face-width-plus-50', png: 'lighttable-face-width-plus-50.png' }]
  }));
  return directory;
};

test('rejects a Photoshop case that is pixel-identical to its identity', async () => {
  const directory = await fixture(Buffer.from([20, 30, 40, 255]));
  await assert.rejects(execFileAsync(process.execPath, [comparator, directory]));
  const report = JSON.parse(await readFile(path.join(directory, 'comparison-report.json'), 'utf8'));
  assert.equal(report.compared, 0);
  assert.equal(report.invalidPhotoshop, 1);
  assert.equal(report.cases[0].status, 'invalid-photoshop-reference');
});

test('compares deformation deltas when Photoshop changed pixels', async () => {
  const directory = await fixture(Buffer.from([35, 30, 40, 255]));
  await execFileAsync(process.execPath, [comparator, directory]);
  const report = JSON.parse(await readFile(path.join(directory, 'comparison-report.json'), 'utf8'));
  assert.equal(report.compared, 1);
  assert.equal(report.invalidPhotoshop, 0);
  assert.equal(report.cases[0].status, 'compared');
  assert.ok(report.cases[0].photoshopEffectRms > 0);
  assert.ok(report.cases[0].deltaRmse > 0);
});

test('rejects Photoshop cases without an identity baseline', async () => {
  const directory = await fixture(Buffer.from([35, 30, 40, 255]));
  const { rm } = await import('node:fs/promises');
  await rm(path.join(directory, 'photoshop-identity.png'));
  await assert.rejects(execFileAsync(process.execPath, [comparator, directory]));
  const report = JSON.parse(await readFile(path.join(directory, 'comparison-report.json'), 'utf8'));
  assert.equal(report.compared, 0);
  assert.equal(report.invalidPhotoshop, 1);
  assert.match(report.cases[0].reason, /identity export is missing/i);
});
