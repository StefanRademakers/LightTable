import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const roots = ['packages/lighttable-app/src', 'apps/web/src', 'apps/desktop/src'];
const sourceExtensions = new Set(['.ts', '.tsx', '.css']);
const forbidden = [
  'StoryBuilderOnline',
  'VITE_API_URL',
  "from 'axios'",
  'from "axios"',
  "'/icons/",
  '"/icons/',
  'client/public',
  'features/common'
];

const failures = [];

async function scan(relativeDirectory) {
  const entries = await readdir(relativeDirectory, { withFileTypes: true });
  for (const entry of entries) {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) {
      await scan(relativePath);
      continue;
    }
    if (!sourceExtensions.has(path.extname(entry.name))) continue;

    const source = await readFile(relativePath, 'utf8');
    for (const token of forbidden) {
      if (source.includes(token)) failures.push(`${relativePath}: ${token}`);
    }
    const normalizedPath = relativePath.replaceAll('\\', '/');
    if (
      source.includes('gpu/WebGpuEngine') &&
      !normalizedPath.includes('/infrastructure/rendering/')
    ) {
      failures.push(`${relativePath}: concrete WebGpuEngine dependency outside rendering infrastructure`);
    }
  }
}

for (const root of roots) await scan(root);

if (failures.length > 0) {
  console.error('LightTable boundary verification failed:\n' + failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log('LightTable boundary verification passed.');
}
