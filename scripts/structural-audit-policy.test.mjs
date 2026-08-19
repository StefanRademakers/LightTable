import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { classifyWebAsset } from './audit-web-delivery.mjs';

const workspace = path.resolve(import.meta.dirname, '..');

test('generated source is accountable but excluded from handwritten ownership review', async () => {
  const policy = JSON.parse(await readFile(path.join(
    workspace, 'architecture', 'tests', 'source-structure-baseline.json'
  ), 'utf8'));
  const generated = policy.generatedFiles[
    'packages/lighttable-app/src/lighttable/gpu/photoshopColorVibranceLut.generated.ts'
  ];
  assert.equal(generated.generator, 'scripts/generate-photoshop-color-vibrance-lut.mjs');
  assert.equal(generated.loadBoundary, 'initial-editor-javascript');
  assert.equal(policy.reviewedHotspots[
    'packages/lighttable-app/src/lighttable/LightTableEditorOverlay.tsx'
  ].classification, 'mixed-authority');
});

test('heavy delivery assets map to the user flow that justifies loading them', async () => {
  const policy = JSON.parse(await readFile(path.join(
    workspace, 'architecture', 'tests', 'web-delivery-baseline.json'
  ), 'utf8'));
  assert.deepEqual(classifyWebAsset('ort-wasm-simd-threaded.jsep-HASH.wasm', policy.assetRules), {
    loadBoundary: 'lazy', userFlow: 'local AI model inference'
  });
  assert.deepEqual(classifyWebAsset('index-HASH.js', policy.assetRules), {
    loadBoundary: 'initial', userFlow: 'editor shell and core editing, including calibrated Grade data'
  });
  assert.equal(classifyWebAsset('mystery-model.bin', policy.assetRules), null);
});
