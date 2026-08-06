import { createHash } from 'node:crypto';
import { access, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const packageRoot = path.resolve(process.argv[2] || path.join(root, 'apps', 'desktop', 'out', 'LightTable-win32-x64'));
const reportPath = path.join(root, 'tmp', 'release', 'desktop-package-manifest.json');
const desktopPackage = JSON.parse(await readFile(path.join(root, 'apps', 'desktop', 'package.json'), 'utf8'));
const required = [
  'LightTable.exe',
  'resources/app.asar',
  'LICENSE',
  'LICENSES.chromium.html'
];
await Promise.all(required.map((relative) => access(path.join(packageRoot, relative))));

const walk = async (directory) => {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(absolute));
    else if (entry.isFile()) files.push(absolute);
  }
  return files;
};
const files = await walk(packageRoot);
const entries = [];
for (const file of files.sort()) {
  const bytes = await readFile(file);
  entries.push({
    path: path.relative(packageRoot, file).replaceAll('\\', '/'),
    bytes: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex')
  });
}
if (entries.some(({ path: relative }) => /(^|\/)work\//i.test(relative)
  || /\.(pfx|p12|pem|key)$/i.test(relative))) {
  throw new Error('The package contains a work queue or credential-shaped file.');
}
const asar = entries.find(({ path: relative }) => relative === 'resources/app.asar');
if (!asar || (await stat(path.join(packageRoot, 'LightTable.exe'))).size === 0) {
  throw new Error('The packaged runtime is incomplete.');
}
const makerDirectory = path.join(root, 'apps', 'desktop', 'out', 'make', 'squirrel.windows', 'x64');
const makerArtifacts = await readdir(makerDirectory).catch(() => []);
if (makerArtifacts.length > 0) {
  const expectedVersion = desktopPackage.version;
  if (!makerArtifacts.some((name) => name === `LightTable-${expectedVersion} Setup.exe`)
    || !makerArtifacts.includes('RELEASES')
    || !makerArtifacts.some((name) => name.endsWith('-full.nupkg'))) {
    throw new Error(`Squirrel artifacts do not match desktop version ${expectedVersion}.`);
  }
}
await mkdir(path.dirname(reportPath), { recursive: true });
await writeFile(reportPath, `${JSON.stringify({
  schemaVersion: 1,
  version: desktopPackage.version,
  packageRoot,
  makerArtifacts,
  files: entries
}, null, 2)}\n`, 'utf8');
console.log(`Desktop release package verified: ${entries.length} files; app.asar ${asar.bytes} bytes.`);
