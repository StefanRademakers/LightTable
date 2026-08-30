import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const uiRoot = path.join(root, 'packages', 'lighttable-app', 'src', 'ui');
const appSourceRoot = path.join(root, 'packages', 'lighttable-app', 'src');

const sourceFiles = async (directory) => (await Promise.all((await readdir(directory, {
  withFileTypes: true
})).map((entry) => entry.isDirectory()
  ? sourceFiles(path.join(directory, entry.name))
  : [path.join(directory, entry.name)]))).flat();

const violations = [];
for (const file of await sourceFiles(uiRoot)) {
  if (!/\.(?:ts|tsx)$/.test(file)) continue;
  const source = await readFile(file, 'utf8');
  if (/from\s+['"](?!@lighttable\/ui(?:['"/]))[^'"]*lighttable\//.test(source)) {
    violations.push(`${path.relative(root, file)} imports the LightTable editor domain`);
  }
}

const uiOwnedRoots = [
  'lighttable-adjustment',
  'lighttable-style-field',
  'lighttable-property-stack',
  'lighttable-file-field',
  'lighttable-style-angle',
  'lighttable-style-advanced'
];
for (const file of await sourceFiles(appSourceRoot)) {
  if (!file.endsWith('.css')) continue;
  const source = await readFile(file, 'utf8');
  for (const rootClass of ['ui-button', 'ui-segmented']) {
    if (source.includes(`.${rootClass}`)) {
      violations.push(`${path.relative(root, file)} reaches into package-owned .${rootClass}`);
    }
  }
  if (file.startsWith(`${uiRoot}${path.sep}`)) continue;
  for (const rootClass of uiOwnedRoots) {
    if (source.includes(`.${rootClass}`)) {
      violations.push(`${path.relative(root, file)} reaches into UI-owned .${rootClass}`);
    }
  }
}

if (violations.length) {
  throw new Error(`UI boundary audit failed:\n- ${violations.join('\n- ')}`);
}

console.log(`UI boundary passed: ${uiOwnedRoots.length} component roots are isolated and src/ui has no editor-domain imports.`);
