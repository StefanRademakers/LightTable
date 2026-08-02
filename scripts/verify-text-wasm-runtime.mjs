import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const generatedRoot = join(
  repoRoot,
  'packages',
  'lighttable-app',
  'src',
  'lighttable',
  'text',
  'wasm',
  'generated'
);
const bindings = await import(pathToFileURL(join(generatedRoot, 'text_layout_wasm.js')));
const wasmBytes = await readFile(join(generatedRoot, 'text_layout_wasm_bg.wasm'));
await bindings.default({ module_or_path: wasmBytes });
const version = bindings.text_engine_version();
if (version !== '0.1.0') {
  throw new Error(`Expected LightTable text engine 0.1.0, received ${version}.`);
}
console.log(`LightTable text WASM runtime passed: v${version}.`);
