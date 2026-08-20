import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { classifyWebAsset } from './audit-web-delivery.mjs';

const workspace = path.resolve(import.meta.dirname, '..');

test('removed calibration artifacts cannot silently return as generated startup source', async () => {
  const policy = JSON.parse(await readFile(path.join(
    workspace, 'architecture', 'tests', 'source-structure-baseline.json'
  ), 'utf8'));
  assert.equal(policy.generatedFiles[
    'packages/lighttable-app/src/lighttable/gpu/photoshopColorVibranceLut.generated.ts'
  ], undefined);
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
    loadBoundary: 'initial', userFlow: 'editor shell and core editing'
  });
  assert.deepEqual(classifyWebAsset('semanticActionLibrary-HASH.js', policy.assetRules), {
    loadBoundary: 'initial', userFlow: 'semantic command recording and durable Actions workflows'
  });
  assert.deepEqual(classifyWebAsset('photoshop-temperature-tint-v2-HASH.bin', policy.assetRules), {
    loadBoundary: 'lazy', userFlow: 'Photoshop Color and Vibrance adjustment compatibility'
  });
  assert.equal(classifyWebAsset('mystery-model.bin', policy.assetRules), null);
});
