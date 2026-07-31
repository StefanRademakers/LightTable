import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const roots = [
  'packages/vector-core/src',
  'packages/lighttable-app/src',
  'apps/web/src',
  'apps/desktop/src'
];
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
const rendererFacadePath =
  'packages/lighttable-app/src/lighttable/editor/rendering/LayerDocumentRenderer.ts';
const rendererFacadeImports = new Set([
  '../document/documentTypes',
  '../history/ReversiblePixelEdit',
  '../persistence/layeredDocumentFormat',
  '../selection/selectionCoverage',
  '../selection/selectionTypes',
  '../session/editorSession',
  '../tools/brush/strokeBuilder',
  '../tools/transform/transformTypes',
  './LayerThumbnailService',
  './RasterDocumentOperations',
  './createLayerDocumentRendererRuntime',
  './renderContract'
]);

function verifyRendererFacadeImports(relativePath, source) {
  const normalizedPath = relativePath.replaceAll('\\', '/');
  if (normalizedPath !== rendererFacadePath) return;

  const importPattern = /from\s+['"]([^'"]+)['"]/g;
  for (const match of source.matchAll(importPattern)) {
    const moduleSpecifier = match[1];
    if (!rendererFacadeImports.has(moduleSpecifier)) {
      failures.push(
        `${relativePath}: renderer facade import "${moduleSpecifier}" is outside its allowlist`
      );
    }
  }
}

function verifyVectorCoreBoundary(relativePath, source) {
  const normalizedPath = relativePath.replaceAll('\\', '/');
  if (!normalizedPath.startsWith('packages/vector-core/src/')) return;
  const forbiddenVectorDependencies = [
    'react', 'react-dom', 'document.', 'window.', 'navigator.',
    'GPUDevice', 'GPUTexture', '@lighttable/app'
  ];
  for (const token of forbiddenVectorDependencies) {
    if (source.includes(token)) {
      failures.push(`${relativePath}: vector-core must not depend on ${token}`);
    }
  }
}

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
    verifyRendererFacadeImports(relativePath, source);
    verifyVectorCoreBoundary(relativePath, source);
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
