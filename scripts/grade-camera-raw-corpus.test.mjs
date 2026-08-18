import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const manifest = JSON.parse(await readFile(
  path.join(import.meta.dirname, 'grade-camera-raw-corpus.json'), 'utf8'
));

test('Grade Camera Raw corpus has stable unique sources and complete required roles', () => {
  assert.equal(manifest.schema, 1);
  assert.ok(manifest.sources.length >= 10);
  assert.equal(new Set(manifest.sources.map(({ id }) => id)).size, manifest.sources.length);
  const roles = new Set(manifest.sources.flatMap(({ roles }) => roles));
  for (const role of manifest.requiredRoles) assert.ok(roles.has(role), `missing ${role}`);
});

test('generated Grade diagnostics declare known generators and portable file names', () => {
  const known = new Set([
    'grayscale-ramp', 'tonal-steps', 'color-target', 'frequency-detail',
    'multiscale-noise'
  ]);
  for (const source of manifest.sources.filter(({ kind }) => kind === 'generated')) {
    assert.ok(known.has(source.generator), source.generator);
    assert.equal(path.basename(source.file), source.file);
  }
});

test('Grade Color oracle covers signed Camera Raw color controls and endpoints', async () => {
  const suite = JSON.parse(await readFile(
    path.join(import.meta.dirname, 'grade-color-parity-cases.json'), 'utf8'
  ));
  assert.equal(suite.section, 'color');
  assert.equal(suite.groupLabel, 'Color');
  assert.deepEqual(suite.controls.map(({ cameraRawDescriptor }) => cameraRawDescriptor), [
    'Temp', 'Tint', 'Vibr', 'Strt'
  ]);
  for (const control of suite.controls) {
    for (const value of [-100, -80, -50, 50, 80, 100]) {
      assert.ok(control.values.includes(value), `${control.key} includes ${value}`);
    }
  }
});

test('Grade local-detail oracle covers proven Clarity and Dehaze descriptors', async () => {
  const suite = JSON.parse(await readFile(
    path.join(import.meta.dirname, 'grade-local-detail-parity-cases.json'), 'utf8'
  ));
  assert.equal(suite.section, 'local-detail');
  assert.equal(suite.groupLabel, 'Texture / Clarity / Dehaze');
  assert.deepEqual(suite.controls.map(({ cameraRawDescriptor }) => cameraRawDescriptor), [
    'Cl12', 'Dhze'
  ]);
  assert.equal(suite.unresolvedControls[0].key, 'texture');
  for (const control of suite.controls) {
    for (const value of [-100, -80, -50, 50, 80, 100]) {
      assert.ok(control.values.includes(value), `${control.key} includes ${value}`);
    }
  }
});
