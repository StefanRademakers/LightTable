import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const suite = JSON.parse(await readFile(
  path.join(import.meta.dirname, 'grade-light-parity-cases.json'), 'utf8'
));

test('Grade Light oracle covers the six comparable Camera Raw controls', () => {
  assert.equal(suite.schema, 1);
  assert.equal(suite.section, 'light');
  assert.deepEqual(
    suite.controls.map(({ key }) => key),
    ['exposureEV', 'contrast', 'highlights', 'shadows', 'whites', 'blacks']
  );
  assert.equal(new Set(suite.controls.map(({ cameraRawDescriptor }) => (
    cameraRawDescriptor
  ))).size, suite.controls.length);
  assert.deepEqual(
    suite.controls.map(({ cameraRawDescriptor }) => cameraRawDescriptor),
    ['Ex12', 'Cr12', 'Hi12', 'Sh12', 'Wh12', 'Bk12']
  );
});

test('signed Grade Light controls include middle, 80-percent and endpoint evidence', () => {
  for (const control of suite.controls) {
    assert.ok(control.values.some((value) => value < 0), `${control.key} negative`);
    assert.ok(control.values.some((value) => value > 0), `${control.key} positive`);
    if (control.key === 'exposureEV') {
      assert.ok(control.values.includes(-5));
      assert.ok(control.values.includes(5));
      continue;
    }
    for (const value of [-100, -80, -50, 50, 80, 100]) {
      assert.ok(control.values.includes(value), `${control.key} includes ${value}`);
    }
  }
});
