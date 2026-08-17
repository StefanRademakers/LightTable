import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const workspace = path.resolve(import.meta.dirname, '..');
const suitePath = path.join(
  workspace,
  'architecture',
  'reference',
  'implementation',
  'adjustment-parity-suite.json'
);
const suite = JSON.parse(await readFile(suitePath, 'utf8'));
const gradeSuite = JSON.parse(await readFile(path.join(
  workspace,
  'architecture',
  'reference',
  'implementation',
  'grade-visual-suite.json'
), 'utf8'));

test('canonical adjustment parity suite has valid unique corpus gates', () => {
  assert.equal(suite.schema, 1);
  assert.match(suite.photoshopVersion, /^27\./u);
  assert.equal(suite.minimumParityPercent, 95);
  assert.ok(suite.maximumRegressionPercentPoints > 0);
  assert.ok(suite.maximumRegressionPercentPoints <= 0.05);
  assert.ok(suite.corpora.length >= 40);

  const roots = new Set();
  for (const corpus of suite.corpora) {
    assert.equal(typeof corpus.adjustment, 'string');
    assert.ok(corpus.adjustment.length > 0);
    assert.equal(typeof corpus.root, 'string');
    assert.ok(corpus.root.length > 0);
    assert.equal(roots.has(corpus.root), false, `duplicate corpus root: ${corpus.root}`);
    roots.add(corpus.root);
    assert.ok(corpus.baseline >= suite.minimumParityPercent);
    assert.ok(corpus.baseline <= 100);
    if ('open' in corpus) assert.equal(corpus.open, true);
  }
});

test('core color adjustments retain both diagnostic and photograph evidence', () => {
  for (const adjustment of [
    'brightness-contrast',
    'levels',
    'curves',
    'hue-saturation',
    'color-balance',
    'black-white',
    'photo-filter',
    'channel-mixer',
    'selective-color'
  ]) {
    const corpora = suite.corpora.filter((corpus) => corpus.adjustment === adjustment);
    assert.ok(corpora.length >= 2, `${adjustment} needs diagnostic and real-image evidence`);
  }
});

test('native Grade visual suite covers neutral, isolated groups, and combined extremes', () => {
  assert.equal(gradeSuite.schema, 1);
  assert.ok(gradeSuite.minimumParityPercent >= 99.5);
  const ids = new Set(gradeSuite.cases.map(({ id }) => id));
  for (const expected of [
    'neutral',
    'light-positive-extreme',
    'light-negative-extreme',
    'color-extremes',
    'effects-extremes',
    'combined-grade'
  ]) assert.equal(ids.has(expected), true, `missing Grade case: ${expected}`);
});
