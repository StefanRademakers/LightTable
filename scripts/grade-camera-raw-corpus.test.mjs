import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { parseGradeCorpusRunMode } from './grade-corpus-run-mode.mjs';

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
    'multiscale-noise', 'wide-gamut-color'
  ]);
  for (const source of manifest.sources.filter(({ kind }) => kind === 'generated')) {
    assert.ok(known.has(source.generator), source.generator);
    assert.equal(path.basename(source.file), source.file);
    assert.ok(['sRGB', 'Display P3'].includes(source.profile), `${source.id} declares profile`);
  }
  assert.equal(manifest.sources.find(({ id }) => id === 'wide-gamut-color')?.profile, 'Display P3');
});

test('Grade corpus capture sides can resume independently without ambiguous flags', () => {
  assert.deepEqual(parseGradeCorpusRunMode([]), {
    captureCameraRaw: true,
    captureLightTable: true
  });
  assert.deepEqual(parseGradeCorpusRunMode(['--lighttable-only']), {
    captureCameraRaw: false,
    captureLightTable: true
  });
  assert.deepEqual(parseGradeCorpusRunMode(['--camera-raw-only']), {
    captureCameraRaw: true,
    captureLightTable: false
  });
  assert.throws(
    () => parseGradeCorpusRunMode(['--lighttable-only', '--camera-raw-only']),
    /either --lighttable-only or --camera-raw-only/u
  );
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

test('Grade Detail oracle isolates dependent controls against active baselines', async () => {
  const suite = JSON.parse(await readFile(
    path.join(import.meta.dirname, 'grade-detail-parity-cases.json'), 'utf8'
  ));
  assert.equal(suite.section, 'detail');
  assert.equal(suite.groupLabel, 'Detail');
  assert.deepEqual(suite.controls.map(({ cameraRawDescriptor }) => cameraRawDescriptor), [
    'Shrp', 'ShpR', 'ShpD', 'ShpM', 'LNR ', 'LNRD', 'LNRC', 'CNR ', 'CNRD', 'CNRS'
  ]);
  const dependent = suite.controls.filter(({ cameraRawPrerequisites }) => cameraRawPrerequisites);
  assert.equal(dependent.length, 7);
  for (const control of dependent) {
    assert.ok(control.lightTablePrerequisites?.length, `${control.key} has a LightTable baseline`);
    assert.notEqual(control.values.length, 0, `${control.key} has cases`);
  }
});

test('Grade Curves oracle covers master, channels, endpoints and stacked curves', async () => {
  const suite = JSON.parse(await readFile(
    path.join(import.meta.dirname, 'grade-curves-parity-cases.json'), 'utf8'
  ));
  assert.equal(suite.section, 'curves');
  assert.equal(suite.cases[0].id, 'neutral');
  const keys = new Set(suite.cases.map(({ key }) => key));
  for (const key of ['master', 'red', 'green', 'blue', 'stack']) assert.ok(keys.has(key), key);
  assert.ok(suite.cases.some(({ curves }) => curves.master?.[0]?.[1] > 0), 'black endpoint lift');
  assert.ok(suite.cases.some(({ curves }) => curves.master?.at(-1)?.[1] < 255), 'white endpoint reduction');
  assert.ok(suite.cases.some(({ curves }) => curves.master && curves.red), 'master and channel stack');
  for (const entry of suite.cases) {
    for (const points of Object.values(entry.curves)) {
      assert.ok(points.length >= 2, `${entry.id} has complete curve`);
      assert.ok(points.every(([x, y]) => x >= 0 && x <= 255 && y >= 0 && y <= 255), entry.id);
    }
  }
});

test('Grade Color Mixer oracle covers every HSL range, descriptor and endpoint', async () => {
  const suite = JSON.parse(await readFile(
    path.join(import.meta.dirname, 'grade-color-mixer-parity-cases.json'), 'utf8'
  ));
  assert.equal(suite.section, 'color-mixer');
  assert.equal(suite.groupLabel, 'Color Mixer');
  assert.equal(suite.analysisMinimumCameraRawMagnitude, 0.002);
  assert.equal(suite.controls.length, 24);
  const ranges = ['red', 'orange', 'yellow', 'green', 'aqua', 'blue', 'purple', 'magenta'];
  const channels = [['hue', 'HA_'], ['saturation', 'SA_'], ['luminance', 'LA_']];
  const suffixes = ['R', 'O', 'Y', 'G', 'A', 'B', 'P', 'M'];
  for (const [channel, prefix] of channels) {
    const controls = suite.controls.filter((control) => control.channel === channel);
    assert.deepEqual(controls.map(({ range }) => range), ranges);
    assert.deepEqual(controls.map(({ rangeIndex }) => rangeIndex), ranges.map((_, index) => index));
    assert.deepEqual(controls.map(({ cameraRawDescriptor }) => cameraRawDescriptor),
      suffixes.map((suffix) => `${prefix}${suffix}`));
    for (const control of controls) {
      assert.deepEqual(control.values, [-100, -80, -50, 50, 80, 100]);
      assert.equal(control.defaultValue, 0);
    }
  }
});

test('Grade Color Grading oracle covers every Camera Raw wheel and transition control', async () => {
  const suite = JSON.parse(await readFile(
    path.join(import.meta.dirname, 'grade-color-grading-parity-cases.json'), 'utf8'
  ));
  assert.equal(suite.section, 'color-grading');
  assert.equal(suite.groupLabel, 'Color Grading');
  assert.equal(suite.analysisMinimumCameraRawMagnitude, 0.002);
  assert.equal(suite.controls.length, 14);

  const controls = new Map(suite.controls.map((control) => [control.key, control]));
  const expectedDescriptors = new Map([
    ['global-hue', 'CgGH'], ['global-saturation', 'CgGS'],
    ['shadows-hue', 'STSH'], ['shadows-saturation', 'STSS'],
    ['midtones-hue', 'CgMH'], ['midtones-saturation', 'CgMS'],
    ['highlights-hue', 'STHH'], ['highlights-saturation', 'STHS'],
    ['global-luminance', 'CgGL'], ['shadows-luminance', 'CgSL'],
    ['midtones-luminance', 'CgML'], ['highlights-luminance', 'CgHL'],
    ['blending', 'CgBl'], ['balance', 'STB ']
  ]);
  for (const [key, descriptor] of expectedDescriptors) {
    assert.equal(controls.get(key)?.cameraRawDescriptor, descriptor, key);
    assert.ok(controls.get(key)?.cameraRawPrerequisites.some((entry) => (
      entry.descriptor === 'CgBl' && entry.value === 50
    )), `${key} explicitly authors Camera Raw's visible Blending default`);
  }

  for (const scope of ['global', 'shadows', 'midtones', 'highlights']) {
    const hue = controls.get(`${scope}-hue`);
    const saturation = controls.get(`${scope}-saturation`);
    const luminance = controls.get(`${scope}-luminance`);
    assert.deepEqual(hue.values, [60, 120, 180, 240, 300]);
    assert.deepEqual(saturation.values, [25, 50, 80, 100]);
    assert.deepEqual(luminance.values, [-100, -80, -50, 50, 80, 100]);
    assert.equal(hue.lightTable.gradingMode, scope);
    assert.equal(saturation.lightTable.gradingMode, scope);
    assert.equal(luminance.lightTable.gradingMode, scope);
    assert.ok(hue.cameraRawPrerequisites.length > 0, `${scope} hue needs saturation`);
    assert.ok(saturation.cameraRawPrerequisites.length > 0, `${scope} saturation needs hue`);
  }

  assert.deepEqual(controls.get('blending').values, [0, 25, 75, 100]);
  assert.equal(controls.get('blending').defaultValue, 50);
  assert.deepEqual(controls.get('balance').values, [-100, -80, -50, 50, 80, 100]);
  assert.equal(controls.get('balance').defaultValue, 0);
  assert.equal(controls.get('blending').lightTablePrerequisites.length, 2);
  assert.equal(controls.get('balance').lightTablePrerequisites.length, 2);
});

test('Grade Black & White oracle covers all eight Camera Raw mixer ranges', async () => {
  const suite = JSON.parse(await readFile(
    path.join(import.meta.dirname, 'grade-black-white-parity-cases.json'), 'utf8'
  ));
  assert.equal(suite.section, 'black-white');
  assert.equal(suite.cameraRawDescriptorStatus, 'candidate-unverified-automation-blocked');
  assert.equal(suite.groupLabel, 'Black & White Mix');
  assert.equal(suite.controls.length, 8);
  assert.deepEqual(suite.controls.map(({ cameraRawDescriptor }) => cameraRawDescriptor), [
    'GrayMixerRed', 'GrayMixerOrange', 'GrayMixerYellow', 'GrayMixerGreen',
    'GrayMixerAqua', 'GrayMixerBlue', 'GrayMixerPurple', 'GrayMixerMagenta'
  ]);
  assert.equal(suite.cameraRawPrerequisites[0].descriptor, 'ConvertToGrayscale');
  assert.equal(suite.cameraRawPrerequisites[0].value, true);
  assert.equal(suite.lightTablePrerequisites[0].treatment, 'black-white');
  for (const [index, control] of suite.controls.entries()) {
    assert.equal(control.blackWhiteRangeIndex, index);
    assert.deepEqual(control.values, [-100, -80, -50, 50, 80, 100]);
  }
});
