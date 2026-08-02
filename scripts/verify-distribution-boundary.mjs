import { readdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';

const require = createRequire(import.meta.url);
const { listPackage } = require('@electron/asar');
const repositoryRoot = path.resolve(import.meta.dirname, '..');
const artifactRoots = [
  path.join(repositoryRoot, 'apps', 'web', 'dist'),
  path.join(repositoryRoot, 'apps', 'desktop', 'out'),
  path.join(repositoryRoot, 'apps', 'desktop', 'out-verify')
];
const sourceRoots = [
  path.join(repositoryRoot, 'apps', 'web', 'src'),
  path.join(repositoryRoot, 'apps', 'desktop', 'src'),
  path.join(repositoryRoot, 'packages', 'lighttable-app', 'src'),
  path.join(repositoryRoot, 'packages', 'vector-core', 'src'),
  path.join(repositoryRoot, 'packages', 'vector-rendering', 'src'),
  path.join(repositoryRoot, 'packages', 'vector-webgpu', 'src')
];
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.css', '.html']);
const failures = [];

function hasWorkSegment(value) {
  return value.split(/[\\/]+/).some((segment) => segment.toLowerCase() === 'work');
}

async function walk(directory, visitor) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(entryPath, visitor);
    else await visitor(entryPath);
  }
}

for (const sourceRoot of sourceRoots) {
  await walk(sourceRoot, async (filePath) => {
    if (!sourceExtensions.has(path.extname(filePath))) return;
    const source = await readFile(filePath, 'utf8');
    if (/from\s+['"][^'"]*[\\/]work(?:[\\/]|$)/im.test(source)) {
      failures.push(`production source imports the work queue: ${filePath}`);
    }
  });
}

for (const artifactRoot of artifactRoots) {
  await walk(artifactRoot, async (filePath) => {
    const relativePath = path.relative(artifactRoot, filePath);
    if (hasWorkSegment(relativePath)) {
      failures.push(`distribution contains work/: ${filePath}`);
    }
    if (path.basename(filePath).toLowerCase() !== 'app.asar') return;
    for (const packagedPath of listPackage(filePath)) {
      if (hasWorkSegment(packagedPath)) {
        failures.push(`Electron ASAR contains work/: ${filePath}:${packagedPath}`);
      }
    }
  });
}

if (failures.length > 0) {
  console.error('LightTable distribution boundary failed:\n' + failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log('LightTable distribution boundary passed: work/ is not shipped.');
}
