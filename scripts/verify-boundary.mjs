import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const roots = [
  'packages/genai-core/src',
  'packages/genai-openart/src',
  'packages/text-core/src',
  'packages/pdf-core/src',
  'packages/vector-core/src',
  'packages/vector-rendering/src',
  'packages/vector-webgpu/src',
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

function verifyGenAiCoreBoundary(relativePath, source) {
  const normalizedPath = relativePath.replaceAll('\\', '/');
  if (!normalizedPath.startsWith('packages/genai-core/src/')) return;
  const forbiddenDependencies = [
    'react', 'react-dom', 'electron', 'document.', 'window.', 'navigator.',
    'node:fs', 'node:http', 'node:https', '@lighttable/app', '@lighttable/desktop'
  ];
  for (const token of forbiddenDependencies) {
    if (source.includes(token)) {
      failures.push(`${relativePath}: genai-core must not depend on ${token}`);
    }
  }
}

function verifyGenAiOpenArtBoundary(relativePath, source) {
  const normalizedPath = relativePath.replaceAll('\\', '/');
  if (!normalizedPath.startsWith('packages/genai-openart/src/')) return;
  const forbiddenDependencies = [
    'react', 'react-dom', 'electron', 'document.', 'window.', 'navigator.',
    'node:fs', '@lighttable/app', '@lighttable/desktop'
  ];
  for (const token of forbiddenDependencies) {
    if (source.includes(token)) {
      failures.push(`${relativePath}: genai-openart must not depend on ${token}`);
    }
  }
}
const rendererFacadePath =
  'packages/lighttable-app/src/lighttable/editor/rendering/LayerDocumentRenderer.ts';
const rendererFacadeImports = new Set([
  '../document/documentTypes',
  '../document/imageResizeTypes',
  '../document/layerTree',
  '../document/sampledBrushSourceDocument',
  '../history/ReversiblePixelEdit',
  '../persistence/layeredDocumentFormat',
  '../selection/selectionCoverage',
  '../selection/selectionTypes',
  '../session/editorSession',
  '../tools/brush/strokeBuilder',
  '../tools/paint/sampledBrushTypes',
  '../tools/transform/transformTypes',
  '../tools/transform/affine',
  '../../text/rendering/TextLayerRenderCoordinator',
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

function verifyTextCoreBoundary(relativePath, source) {
  const normalizedPath = relativePath.replaceAll('\\', '/');
  if (!normalizedPath.startsWith('packages/text-core/src/')) return;
  const forbiddenTextDependencies = [
    'react', 'react-dom', 'document.', 'window.', 'navigator.',
    '@lighttable/app', '@lighttable/vector-core', '@lighttable/vector-rendering',
    '@lighttable/vector-webgpu'
  ];
  for (const token of forbiddenTextDependencies) {
    if (source.includes(token)) {
      failures.push(`${relativePath}: text-core must not depend on ${token}`);
    }
  }
  for (const match of source.matchAll(/\bGPU[A-Z][A-Za-z0-9_]*/g)) {
    failures.push(`${relativePath}: text-core must not reference WebGPU handle ${match[0]}`);
  }
  const importPattern = /from\s+['"]([^'"]+)['"]/g;
  for (const match of source.matchAll(importPattern)) {
    const moduleSpecifier = match[1];
    const isTestDependency = normalizedPath.endsWith('.test.ts') && moduleSpecifier === 'vitest';
    const isSharedPaintContract = moduleSpecifier === '@lighttable/paint-core';
    if (!moduleSpecifier.startsWith('.') && !isTestDependency && !isSharedPaintContract) {
      failures.push(`${relativePath}: text-core imports must stay package-relative or use the shared paint contract (${moduleSpecifier})`);
    }
  }
}

function verifyPdfCoreBoundary(relativePath, source) {
  const normalizedPath = relativePath.replaceAll('\\', '/');
  if (!normalizedPath.startsWith('packages/pdf-core/src/')) return;
  const forbiddenPdfDependencies = [
    'react', 'react-dom', 'document.', 'window.', 'navigator.',
    '@lighttable/app', '@lighttable/vector-core', '@lighttable/vector-rendering',
    '@lighttable/vector-webgpu'
  ];
  for (const token of forbiddenPdfDependencies) {
    if (source.includes(token)) failures.push(`${relativePath}: pdf-core must not depend on ${token}`);
  }
  for (const match of source.matchAll(/\bGPU[A-Z][A-Za-z0-9_]*/g)) {
    failures.push(`${relativePath}: pdf-core must not reference WebGPU handle ${match[0]}`);
  }
  const importPattern = /from\s+['"]([^'"]+)['"]/g;
  for (const match of source.matchAll(importPattern)) {
    const moduleSpecifier = match[1];
    const isTestDependency = normalizedPath.endsWith('.test.ts') && moduleSpecifier === 'vitest';
    if (!moduleSpecifier.startsWith('.') && !isTestDependency) {
      failures.push(`${relativePath}: pdf-core production imports must stay package-relative (${moduleSpecifier})`);
    }
  }
}

function verifyVectorRenderingBoundary(relativePath, source) {
  const normalizedPath = relativePath.replaceAll('\\', '/');
  if (!normalizedPath.startsWith('packages/vector-rendering/src/')) return;
  const forbiddenRenderingDependencies = [
    'react', 'react-dom', 'document.', 'window.', 'navigator.',
    'GPUDevice', 'GPUTexture', '@lighttable/app'
  ];
  for (const token of forbiddenRenderingDependencies) {
    if (source.includes(token)) {
      failures.push(`${relativePath}: vector-rendering must not depend on ${token}`);
    }
  }
}

function verifyVectorWebGpuBoundary(relativePath, source) {
  const normalizedPath = relativePath.replaceAll('\\', '/');
  if (!normalizedPath.startsWith('packages/vector-webgpu/src/')) return;
  const forbiddenDependencies = [
    'react', 'react-dom', 'document.', 'window.', 'navigator.', '@lighttable/app'
  ];
  for (const token of forbiddenDependencies) {
    if (source.includes(token)) {
      failures.push(`${relativePath}: vector-webgpu must not depend on ${token}`);
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
    verifyGenAiCoreBoundary(relativePath, source);
    verifyGenAiOpenArtBoundary(relativePath, source);
    verifyTextCoreBoundary(relativePath, source);
    verifyPdfCoreBoundary(relativePath, source);
    verifyVectorCoreBoundary(relativePath, source);
    verifyVectorRenderingBoundary(relativePath, source);
    verifyVectorWebGpuBoundary(relativePath, source);
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
