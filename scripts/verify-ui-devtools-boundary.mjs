import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(import.meta.dirname, '..');
const target = process.argv.includes('--web') ? 'web' : 'desktop';
const expected = process.argv.includes('--present') ? 'present' : 'absent';
const assets = target === 'web'
  ? path.join(root, 'apps', 'web', 'dist', 'assets')
  : path.join(root, 'apps', 'desktop', '.vite', 'renderer', 'main_window', 'assets');
const signatures = [
  'lighttable:open-ui-style-guide',
  'Inspected application control',
  'suiteAuditId'
];
const forbiddenBaseImports = [
  path.join(root, 'packages', 'lighttable-app', 'src', 'standalone', 'LightTableStandaloneApp.tsx'),
  path.join(root, 'packages', 'lighttable-app', 'src', 'index.ts')
];
for (const sourcePath of forbiddenBaseImports) {
  const source = await readFile(sourcePath, 'utf8');
  if (/ui-devtools|UiInspectorHost|requestUiStyleGuide/u.test(source)) {
    throw new Error(`Base application boundary imports UI devtools: ${path.relative(root, sourcePath)}.`);
  }
}
const files = (await readdir(assets)).filter((name) => /\.(?:js|css)$/u.test(name));
const corpus = (await Promise.all(files.map((name) => readFile(path.join(assets, name), 'utf8')))).join('\n');
const found = signatures.filter((signature) => corpus.includes(signature));
if (expected === 'present' && found.length !== signatures.length) {
  throw new Error(`UI devtools bundle is incomplete; found ${JSON.stringify(found)}.`);
}
if (expected === 'absent' && found.length) {
  throw new Error(`Base ${target} bundle contains UI devtools signatures: ${JSON.stringify(found)}.`);
}
process.stdout.write(`UI devtools boundary passed: ${target} bundle expects ${expected}.\n`);
