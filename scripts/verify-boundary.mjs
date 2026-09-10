import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const roots = [
  'packages/editor-kernel/src',
  'packages/genai-core/src',
  'packages/genai-openart/src',
  'packages/genai-higgsfield/src',
  'packages/text-core/src',
  'packages/pdf-core/src',
  'packages/video-core/src',
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

function verifyEditorKernelBoundary(relativePath, source) {
  const normalizedPath = relativePath.replaceAll('\\', '/');
  if (!normalizedPath.startsWith('packages/editor-kernel/src/')) return;
  const forbiddenDependencies = [
    'react', 'react-dom', 'electron', 'document.', 'window.', 'navigator.',
    'HTMLCanvasElement', 'OffscreenCanvas', '@lighttable/app',
    '@lighttable/lighttable-app', 'node:fs', 'node:http', 'node:https'
  ];
  for (const token of forbiddenDependencies) {
    if (source.includes(token)) {
      failures.push(`${relativePath}: editor-kernel must not depend on ${token}`);
    }
  }
  for (const match of source.matchAll(/\bGPU[A-Z][A-Za-z0-9_]*/g)) {
    failures.push(`${relativePath}: editor-kernel must not reference WebGPU handle ${match[0]}`);
  }
  const importPattern = /from\s+['"]([^'"]+)['"]/g;
  for (const match of source.matchAll(importPattern)) {
    const moduleSpecifier = match[1];
    const isTestDependency = normalizedPath.endsWith('.test.ts') && moduleSpecifier === 'vitest';
    if (!moduleSpecifier.startsWith('.') && !isTestDependency) {
      failures.push(`${relativePath}: editor-kernel imports must stay package-relative (${moduleSpecifier})`);
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

function verifyGenAiHiggsfieldBoundary(relativePath, source) {
  const normalizedPath = relativePath.replaceAll('\\', '/');
  if (!normalizedPath.startsWith('packages/genai-higgsfield/src/')) return;
  const forbiddenDependencies = [
    'react', 'react-dom', 'electron', 'document.', 'window.', 'navigator.',
    'node:fs', '@lighttable/app', '@lighttable/desktop'
  ];
  for (const token of forbiddenDependencies) {
    if (source.includes(token)) failures.push(`${relativePath}: genai-higgsfield must not depend on ${token}`);
  }
}
const rendererFacadePath =
  'packages/lighttable-app/src/lighttable/editor/rendering/LayerDocumentRenderer.ts';
const rendererFacadeImports = new Set([
  '../document/documentTypes',
  '../document/imageResizeTypes',
  '../document/layerTree',
  '../document/sceneTransformGraph',
  '../document/sampledBrushSourceDocument',
  '../history/ReversiblePixelEdit',
  '../persistence/layeredDocumentFormat',
  '../selection/selectionCoverage',
  '../selection/SelectionMaskSnapshot',
  '../selection/selectionTypes',
  '../session/editorSession',
  '../tools/brush/strokeBuilder',
  '../tools/paint/sampledBrushTypes',
  '../tools/transform/transformTypes',
  '../tools/transform/affine',
  '../../text/rendering/TextLayerRenderCoordinator',
  '../../application/documentGeometry/documentGeometryModel',
  './LayerThumbnailService',
  './RasterDocumentOperations',
  './SelectionShapeProjectionService',
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

function verifyVideoCoreBoundary(relativePath, source) {
  const normalizedPath = relativePath.replaceAll('\\', '/');
  if (!normalizedPath.startsWith('packages/video-core/src/')) return;
  const forbiddenVideoDependencies = [
    'react', 'react-dom', 'electron', 'window.', 'navigator.',
    'HTMLVideoElement', 'GPUDevice', 'GPUTexture',
    'node:fs', 'node:http', 'node:https', '@lighttable/app', '@lighttable/desktop'
  ];
  for (const token of forbiddenVideoDependencies) {
    if (source.includes(token)) {
      failures.push(`${relativePath}: video-core must not depend on ${token}`);
    }
  }
  const importPattern = /from\s+['"]([^'"]+)['"]/g;
  for (const match of source.matchAll(importPattern)) {
    const moduleSpecifier = match[1];
    const isTestDependency = normalizedPath.endsWith('.test.ts') && moduleSpecifier === 'vitest';
    if (!moduleSpecifier.startsWith('.') && !isTestDependency) {
      failures.push(`${relativePath}: video-core production imports must stay package-relative (${moduleSpecifier})`);
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

function verifySelectionKernelCutover(relativePath, source) {
  const normalizedPath = relativePath.replaceAll('\\', '/');
  const forbiddenPublicMutations = /^(?:  )(?:setSelection|replaceSelection|clearSelection|applyMagicWand|applySelectSimilar|applyRasterSelection|transformSelection|paintSelectionDabs)\s*\(/m;
  if (normalizedPath === 'packages/lighttable-app/src/lighttable/gpu/WebGpuEngine.ts'
    && forbiddenPublicMutations.test(source)) {
    failures.push(`${relativePath}: committed selection mutation must enter through the kernel projection port`);
  }
  if (normalizedPath === 'packages/lighttable-app/src/lighttable/editor/rendering/LayerDocumentRenderer.ts'
    && forbiddenPublicMutations.test(source)) {
    failures.push(`${relativePath}: renderer facade must not expose direct committed selection mutation`);
  }
  if (normalizedPath === 'packages/lighttable-app/src/lighttable/application/tools/selection/selectionSessionPorts.ts') {
    if (/\bpushHistoryEntry\b/.test(source)) {
      failures.push(`${relativePath}: selection gestures must not own history publication`);
    }
    if (/\bcommit(?:Shape|Translation|Paint|MagicWand|Operation|RasterMask)\?\s*\(/.test(source)) {
      failures.push(`${relativePath}: committed selection ports must be required and fail closed`);
    }
  }
}

function verifyLayerFinalizationCutover(relativePath, source) {
  const normalizedPath = relativePath.replaceAll('\\', '/');
  if (normalizedPath.endsWith('/application/layers/useLayerDocumentCommands.ts')) {
    const optionalFinalizationPorts = /\b(?:waitForLayerFinalizationSources|waitForTextSource|getDocumentAdjustments|getPanelAdjustments|publishDocumentAdjustments|publishPanelAdjustments|getGlobalGradeStrength|publishGlobalGradeStrength)\?\s*\(/;
    if (optionalFinalizationPorts.test(source)) {
      failures.push(`${relativePath}: layer finalization readiness and processing ports must be required`);
    }
    if (!source.includes('commitRasterFinalization(')) {
      failures.push(`${relativePath}: raster finalization must enter through its transaction owner`);
    }
    if (!source.includes('renderer.waitForLayerFinalizationSources(finalizationScope)')) {
      failures.push(`${relativePath}: destructive layer commands must await exact renderer sources`);
    }
    const publicStart = source.indexOf('export interface LayerDocumentCommands');
    const publicEnd = source.indexOf('const fullDocumentBounds');
    const publicContract = source.slice(publicStart, publicEnd);
    if (/\b(?:mergeSelectedLayers|mergeActiveLayerDown|flatten|rasterizeLayer|rasterizeActiveLayer)\s*\(/.test(publicContract)) {
      failures.push(`${relativePath}: raw pre-readiness layer finalizers must remain private`);
    }
    if (!source.includes("await waitForTextTargets([], false, 'layer')")) {
      failures.push(`${relativePath}: Pixels-mode vector finalization must await exact renderer sources`);
    }
  }
  if (normalizedPath.endsWith('/application/layers/rasterFinalizationTransaction.ts')) {
    if (!source.includes('reserveHistoryEntry(mutation.historyEntry)')) {
      failures.push(`${relativePath}: raster finalization must reserve history before publication`);
    }
    if (!source.includes("operation.adopt('release reserved raster destination'")) {
      failures.push(`${relativePath}: failed raster finalization must release its destination runtime`);
    }
  }
  if (normalizedPath.endsWith('/LightTableEditorOverlay.tsx')) {
    const directRasterizeFallback = /rasterizeActiveLayer:\s*layerDocumentCommands\.rasterizeActiveLayer|void\s+layerDocumentCommands\.rasterizeActiveLayer\(\)/;
    if (directRasterizeFallback.test(source)) {
      failures.push(`${relativePath}: rasterize UI must use the registered semantic command exclusively`);
    }
  }
}

function verifyRasterPixelCutover(relativePath, source) {
  const normalizedPath = relativePath.replaceAll('\\', '/');
  const reservedOwners = [
    '/application/tools/fill/useFillCommandController.ts',
    '/application/tools/gradient/RasterGradientCommandController.ts'
  ];
  if (reservedOwners.some((suffix) => normalizedPath.endsWith(suffix))) {
    if (!source.includes('reserveAppliedPixelMutation')) {
      failures.push(`${relativePath}: discrete raster commands must reserve history before GPU mutation`);
    }
    if (source.includes('commitAppliedPixelMutation')) {
      failures.push(`${relativePath}: post-mutation raster history publication must not return`);
    }
    if (/\bgetSelectionRevision\?\s*\(/.test(source)) {
      failures.push(`${relativePath}: raster commands must require exact selection revision ownership`);
    }
  }
  if (normalizedPath.endsWith('/application/tools/paint/usePaintSessionController.ts')) {
    if (!source.includes('acquireHistoryAdmissionBarrier')
      || !source.includes('reserveAppliedPixelMutation')) {
      failures.push(`${relativePath}: paint gestures must hold admission before GPU writes and transfer it at commit`);
    }
    if (source.includes('commitAppliedPixelMutation')) {
      failures.push(`${relativePath}: paint must not publish history only after its GPU gesture`);
    }
    if (/\bgetSelectionRevision\?\s*\(/.test(source)) {
      failures.push(`${relativePath}: paint must require exact selection revision ownership`);
    }
  }
  if (normalizedPath.endsWith('/application/clipboard/pixelClipboardController.ts')) {
    if (/\bgetSelectionLease\?\s*\(/.test(source)) {
      failures.push(`${relativePath}: clipboard capture must require the committed selection lease`);
    }
    if (!source.includes('claimClipboardTurn()') || !source.includes('let generation = 0')) {
      failures.push(`${relativePath}: clipboard publication must remain serialized and latest-invocation owned`);
    }
  }
  if (normalizedPath.endsWith('/application/layers/useLayerDocumentCommands.ts')) {
    if (!source.includes('createPixelClipboardController(')) {
      failures.push(`${relativePath}: clipboard capture ownership must remain extracted from the layer facade`);
    }
    if (/const\s+(?:copySelectedContent|copyMergedContent|pasteSelectedContent)\s*=/.test(source)) {
      failures.push(`${relativePath}: legacy inline clipboard routes must not return`);
    }
    if (/\bgetSelectionLease\?\s*\(/.test(source)) {
      failures.push(`${relativePath}: layer commands must require the committed selection lease`);
    }
    if (!source.includes('pixelClipboard.invalidateRendererScratch()')
      || source.includes('selectionOperationsSupportBounds')) {
      failures.push(`${relativePath}: Layer Via Copy must use committed selection ownership and invalidate clipboard scratch`);
    }
    if (/!renderer\.copySelectedLayerContent\(before, sourceId\)/.test(source)) {
      failures.push(`${relativePath}: Layer Via Copy must not mutate renderer scratch before history admission`);
    }
  }
  if (normalizedPath.endsWith('/LightTableEditorOverlay.tsx')) {
    if (source.includes('layerDocumentCommands.pasteSelectedContent')) {
      failures.push(`${relativePath}: paste UI must fail closed instead of bypassing its semantic command`);
    }
    const copyFallback = /if\s*\(!execution\)[\s\S]{0,240}layerDocumentCommands\.copy(?:Selected|Merged)Content/;
    if (copyFallback.test(source)) {
      failures.push(`${relativePath}: copy UI must not bypass its registered semantic command`);
    }
  }
}

function verifyLayerMaskCutover(relativePath, source) {
  const normalizedPath = relativePath.replaceAll('\\', '/');
  if (normalizedPath.endsWith('/application/layers/useLayerPanelController.ts')) {
    const forbiddenDirectMaskMutations = /\b(?:addLayerMask|removeLayerMask|setLayerMaskEnabled|setLayerMaskLinked)\b/;
    if (forbiddenDirectMaskMutations.test(source)) {
      failures.push(`${relativePath}: Layers-panel mask actions must enter through required semantic command ports`);
    }
    const requiredMaskPorts = [
      'requestAddLayerMask(): void',
      'requestToggleLayerMask(): void',
      'requestSetLayerMaskLinked(layerId: LayerId, linked: boolean): void',
      'requestRemoveLayerMask(layerId?: LayerId): void'
    ];
    for (const port of requiredMaskPorts) {
      if (!source.includes(port)) failures.push(`${relativePath}: missing required mask port ${port}`);
    }
  }
  if (normalizedPath.endsWith('/application/backgroundRemoval/useBackgroundRemovalController.ts')) {
    if (/\b(?:startTask|cancelTask)\?:/.test(source)) {
      failures.push(`${relativePath}: background removal UI task ports must be required`);
    }
    if (/else\s+void\s+removeBackgroundFromLayer/.test(source)) {
      failures.push(`${relativePath}: background removal UI must not bypass the semantic task registry`);
    }
  }
  const reservedMaskOwners = [
    '/application/layers/addLayerMaskCommand.ts',
    '/application/layers/removeLayerMaskCommand.ts',
    '/application/layers/applyLayerMaskCommand.ts',
    '/application/layers/applyBackgroundRemovalMaskCommand.ts'
  ];
  if (reservedMaskOwners.some((suffix) => normalizedPath.endsWith(suffix))
    && !source.includes('reserveAppliedPixelMutation')) {
    failures.push(`${relativePath}: pixel-bearing mask commands must reserve history before GPU mutation`);
  }
  if (normalizedPath.endsWith('/application/backgroundRemoval/useBackgroundRemovalTaskBridge.ts')) {
    if (!source.includes('this.generation += 1;')) {
      failures.push(`${relativePath}: cancellation must invalidate pending task admission`);
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
      verifySelectionKernelCutover(relativePath, source);
      verifyRasterPixelCutover(relativePath, source);
      verifyLayerFinalizationCutover(relativePath, source);
      verifyLayerMaskCutover(relativePath, source);
    verifyEditorKernelBoundary(relativePath, source);
    verifyGenAiCoreBoundary(relativePath, source);
    verifyGenAiOpenArtBoundary(relativePath, source);
    verifyGenAiHiggsfieldBoundary(relativePath, source);
    verifyTextCoreBoundary(relativePath, source);
    verifyPdfCoreBoundary(relativePath, source);
    verifyVideoCoreBoundary(relativePath, source);
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
