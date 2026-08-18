import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createLayeredInterchangeMatrix,
  readCanonicalInterchangeInventory,
  validateLayeredInterchangeMatrix
} from './layered-interchange-matrix.mjs';

test('discovers interchange inventory from canonical registries', async () => {
  const inventory = await readCanonicalInterchangeInventory();
  assert.deepEqual(inventory.layers.sort(), ['adjustment', 'group', 'raster', 'text', 'vector']);
  assert.equal(inventory.blends.length, 26);
  assert.equal(inventory.styles.length, 10);
  assert.equal(inventory.processing.length, 20);
  assert.deepEqual(inventory.gradientAssets.sort(), ['noise', 'solid']);
});

test('covers every axis and requires contextual evidence', async () => {
  const matrix = validateLayeredInterchangeMatrix(await createLayeredInterchangeMatrix());
  assert(matrix.rows.length >= 70);
  assert(matrix.rows.filter(({ dependencySensitive }) => dependencySensitive)
    .every(({ evidenceViews }) => evidenceViews.join(',') === 'solo,context'));
  assert(matrix.rows.every(({ cells }) => Object.values(cells)
    .every(({ status, evidence, reason }) => status && evidence.length && reason)));
});
