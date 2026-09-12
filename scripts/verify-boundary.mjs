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
  './layerStyleRuntimeOwners',
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
    const optionalFinalizationPorts = /\b(?:captureFinalizationScope|waitForLayerFinalizationSources|waitForTextSource|getDocumentAdjustments|getPanelAdjustments|publishDocumentAdjustments|publishPanelAdjustments|getGlobalGradeStrength|publishGlobalGradeStrength)\?\s*\(/;
    if (optionalFinalizationPorts.test(source)) {
      failures.push(`${relativePath}: layer finalization readiness and processing ports must be required`);
    }
    if (!source.includes('commitRasterFinalization(')) {
      failures.push(`${relativePath}: raster finalization must enter through its transaction owner`);
    }
    if (!source.includes('createLayerFinalizationReadiness(() => dependenciesRef.current)')
      || (source.match(/readiness\.assertCurrent\(\)/g) ?? []).length < 4) {
      failures.push(`${relativePath}: destructive layer commands must use exact readiness and revalidate before mutation`);
    }
    const publicStart = source.indexOf('export interface LayerDocumentCommands');
    const publicEnd = source.indexOf('const fullDocumentBounds');
    const publicContract = source.slice(publicStart, publicEnd);
    if (/\b(?:mergeSelectedLayers|mergeActiveLayerDown|mergeActiveLayerDownWhenReady|flatten|rasterizeLayer|rasterizeActiveLayer)\s*\(/.test(publicContract)) {
      failures.push(`${relativePath}: raw pre-readiness layer finalizers must remain private`);
    }
    if (!source.includes("await waitForTextTargets([], false, 'layer')")) {
      failures.push(`${relativePath}: Pixels-mode vector finalization must await exact renderer sources`);
    }
  }
  if (normalizedPath.endsWith('/application/layers/LayerFinalizationReadiness.ts')) {
    if (!source.includes('await renderer.waitForLayerFinalizationSources(finalizationScope)')
      || !source.includes('await renderer.waitForTextSource(id)')) {
      failures.push(`${relativePath}: destructive layer readiness must await exact text and renderer sources`);
    }
    if (!source.includes('dependencies.captureFinalizationScope()')
      || !source.includes('scope.assertCurrent()')
      || !source.includes('return { assertCurrent }')
      || /captureFinalizationScope\?\s*\(/.test(source)) {
      failures.push(`${relativePath}: finalization readiness must pin and return a required exact host scope`);
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

function verifyTransformCutover(relativePath, source) {
  const normalizedPath = relativePath.replaceAll('\\', '/');
  if (normalizedPath.endsWith('/application/tools/transform/TransformPublicationOwner.ts')) {
    if (!source.includes('reserveHistoryEntry(historyProxy)')
      || !source.includes('renderer.commitLayerTransform()')) {
      failures.push(`${relativePath}: terminal selection transforms must reserve history before the GPU commit`);
    }
    if (source.includes('commitAppliedPixelMutation')) {
      failures.push(`${relativePath}: transform publication must not restore post-mutation history admission`);
    }
  }
  if (normalizedPath.endsWith('/application/tools/transform/transformController.ts')) {
    if (!source.includes('selection.active')) {
      failures.push(`${relativePath}: transform targeting must use canonical selection activity`);
    }
    if (/this\.renderer\.commitLayerTransform\s*\(/.test(source)) {
      failures.push(`${relativePath}: transform controller must leave terminal GPU commit to publication ownership`);
    }
    if (source.includes('usesSelection = false')) {
      failures.push(`${relativePath}: active selection intent must not retarget to whole-layer transform`);
    }
  }
  if (normalizedPath.endsWith('/application/tools/transform/useTransformSessionController.ts')) {
    if (!source.includes('getSelectionLease(): LightTableSelectionReadLease | null')) {
      failures.push(`${relativePath}: transform sessions must acquire one exact committed selection lease`);
    }
    if (/\bgetSelection(?:Revision|MaskSnapshot)?\??\s*\(/.test(source)) {
      failures.push(`${relativePath}: split transform selection authorities must not return`);
    }
    if (!source.includes('reserveHistoryEntry(entry: TransformHistoryEntry)')) {
      failures.push(`${relativePath}: transform sessions must expose pre-mutation history admission`);
    }
    if (!source.includes('new TransformSettlementOwner()')
      || !source.includes('settlementOwnerRef.current!.publish(pending')
      || !/const commitPending[\s\S]{0,900}const settlement = isActive\(\) \? finish\(true\) : settlementOwnerRef\.current!\.read\(\);[\s\S]{0,500}requireTransformSettlementRecovery\([\s\S]{0,200}publicationOwnerRef\.current!\.recover\(\)/.test(source)) {
      failures.push(`${relativePath}: transform publication failures must remain rejected through command admission while UI error reporting observes them separately`);
    }
  }
  if (normalizedPath.endsWith('/application/tools/selection/DocumentSelectionStateStore.ts')) {
    if (source.includes('SelectionMaskSnapshot.inactive(')) {
      failures.push(`${relativePath}: selection lease reads must not synthesize a new inactive coverage identity`);
    }
  }
  if (normalizedPath.endsWith('/application/documents/documentSession.ts')) {
    if (!source.includes('needsInactiveCoverage')) {
      failures.push(`${relativePath}: attached documents must own one stable inactive selection coverage value`);
    }
  }
  if (normalizedPath.endsWith('/application/tools/transform/publishTransformDocumentSelection.ts')) {
    if (!source.includes('Transform selection publication rollback failed.')
      || !source.includes('compareAndSwapForDocument(')
      || !source.includes('input.coverage.measureSupportBounds()')) {
      failures.push(`${relativePath}: post-CAS transform publication must restore the opening canonical value`);
    }
  }
  if (normalizedPath.endsWith('/LightTableEditorOverlay.tsx')) {
    if (!source.includes('applyDocumentAndSelection: documentSelectionPublication.publishTransform,')) {
      failures.push(`${relativePath}: transform selection publication must use its lease-bound route`);
    }
  }
  if (normalizedPath.endsWith('/application/documents/DocumentSelectionPublicationBinding.ts')) {
    if (!source.includes('publishTransformDocumentSelection(') || !source.includes('publishBoundSelection(')
      || !source.includes('rendererIsAddressable') || !source.includes('isSessionCurrent()')) {
      failures.push(`${relativePath}: compound publication must preserve exact session, lease and renderer-bound transform admission`);
    }
  }
}

function verifyVectorCutover(relativePath, source) {
  const normalizedPath = relativePath.replaceAll('\\', '/');
  if (normalizedPath.endsWith('/application/vectors/semanticVectorCommandExecutor.ts')) {
    if (!source.includes('changeDocument(')
      || /\b(?:applyDocument|recordHistory)\s*\(/.test(source)) {
      failures.push(`${relativePath}: semantic vector commands must use the shared document mutation route`);
    }
  }
  if (normalizedPath.endsWith('/application/vectors/VectorToolSessionController.ts')) {
    if (/\brasterizeShape\?:/.test(source)
      || /this\.rasterizeShape\s*\?/.test(source)) {
      failures.push(`${relativePath}: Pixels-mode live shapes must require the C02 rasterization hand-off`);
    }
    if (/\bcaptureTransformPreview\?\s*\(/.test(source)) {
      failures.push(`${relativePath}: vector transform preview ownership must be required`);
    }
  }
  if (normalizedPath.endsWith('/application/vectors/VectorElementSelectionToolController.ts')) {
    if (source.includes('layerPreview')
      || source.includes('beginElementMutations(')
      || source.includes('previewElementMutations(')) {
      failures.push(`${relativePath}: element transforms must use one retained element-preview route`);
    }
  }
  if (normalizedPath.endsWith('/application/vectors/VectorTransformPreviewBinding.ts')) {
    if (/\b(?:setLayer|clearLayer)\s*\(/.test(source)) {
      failures.push(`${relativePath}: path-selection preview must not switch to layer-transform semantics`);
    }
  }
}

function verifyTextCutover(relativePath, source) {
  const normalizedPath = relativePath.replaceAll('\\', '/');
  if (normalizedPath.endsWith('/application/text/semanticTextCommandExecutor.ts')) {
    if (!source.includes('changeDocument(')
      || /\b(?:applyDocument|recordHistory)\s*\(/.test(source)) {
      failures.push(`${relativePath}: semantic text commands must use the shared document mutation route`);
    }
  }
  if (normalizedPath.endsWith('/application/text/textEditTransactionController.ts')) {
    if (!source.includes('DocumentMutationTransaction')
      || !source.includes('.stage(')
      || !source.includes('.project()')
      || !source.includes('completed.delivery.onCommitted(')
      || source.includes('resolveDependencies().onCommitted(')
      || /\b(?:applyDocument|pushHistory)\s*\(/.test(source)) {
      failures.push(`${relativePath}: text input groups must stage/project/commit through one document transaction`);
    }
  }
  if (normalizedPath.endsWith('/application/text/TextSelectionGestureController.ts')) {
    if (!source.includes('this.active !== active') || !source.includes('active.dependencies.requestFrame(')
      || !source.includes('this.active.dependencies.cancelFrame(') || !source.includes('active.scope.isCurrent()')) {
      failures.push(`${relativePath}: text selection frames must retain the exact gesture, runtime scope and scheduler`);
    }
  }
  if (normalizedPath.endsWith('/application/text/useMissingFontReplacementActions.ts')) {
    if (!source.includes('documentMutations.begin(')
      || !source.includes('documentMutations.change(')
      || !source.includes('dependencies.getDocument() !== openingDocument')
      || /\b(?:applyDocument|recordHistory)\s*\(/.test(source)
      || source.includes('documentRef:')) {
      failures.push(`${relativePath}: missing-font preview and replacement must share one document transaction owner`);
    }
  }
  if (normalizedPath.endsWith('/application/text/TextLayerMoveGestureController.ts')
    || normalizedPath.endsWith('/application/text/PathTextHandleController.ts')
    || normalizedPath.endsWith('/application/text/ParagraphFrameResizeController.ts')) {
    if (!source.includes('isCurrent()')) {
      failures.push(`${relativePath}: renderer-derived text geometry must remain bound through terminal commit`);
    }
  }
  if (normalizedPath.endsWith('/LightTableEditorOverlay.tsx')) {
    if (/\bcreate(?:Point|Paragraph|Path)TextDocument\s*\(/.test(source)) {
      failures.push(`${relativePath}: Type-tool creation must not retain a direct document mutation fallback`);
    }
    if (!source.includes('useTextGeometryGestures(')
      || /new (?:TextLayerMoveGestureController|ParagraphFrameResizeController|PathTextHandleController)\(/.test(source)) {
      failures.push(`${relativePath}: text geometry construction and runtime retirement belong to their composition binding`);
    }
    if (!source.includes('useTextEditingPublication(') || !source.includes('useTextSelectionGesture(')
      || /new (?:FlowTextEditingSessionController|TextSelectionGestureController)\(/.test(source)
      || source.includes('textEditingControllerRef') || source.includes('textSelectionForGranularity(')) {
      failures.push(`${relativePath}: admitted text observation and selection-frame wiring belong to their publication bindings`);
    }
    const textDocumentReset = /textPropertyGestureController\.cancel\(\);\s*textEditingController\.reset\(\);/.exec(source)?.index ?? -1;
    if (textDocumentReset < source.indexOf('useTextGeometryGestures(')
      || !/textEditingController\.finish\(\);\s*textPropertyGestureController\.dispose\(\);\s*textEditingController\.reset\(\);/.test(source)
      || (source.match(/textEditingController\.reset\(\)/g) ?? []).length !== 2) {
      failures.push(`${relativePath}: preserve geometry-before-document-reset and the single finish/dispose/reset unmount order`);
    }
    if (!source.includes('new TextPropertyGestureController(')) {
      failures.push(`${relativePath}: text-property gestures must delegate their complete lifetime to the application owner`);
    }
    if (!source.includes('useWorkspaceDocumentIntents({')
      || !source.includes('workspaceDocumentIntents.activate')
      || !source.includes('workspaceDocumentIntents.close')
      || source.includes('textPropertyGestureController.finishBeforeTransition(')
      || !source.includes('onActiveDocumentChange={activateWorkspaceDocument}')
      || !source.includes('closeActiveDocument: () => closeWorkspaceDocument(workspaceDocumentId)')
      || !source.includes('closeWorkspaceDocument(workspaceDocument.id)')
      || source.includes('onActivateWorkspaceDocument(nextDocument.id)')
      || source.includes('onActivateWorkspaceDocument?.(workspaceDocument.id)')) {
      failures.push(`${relativePath}: workspace activation must cross the complete text-property terminal owner`);
    }
  }
  if (normalizedPath.endsWith('/application/workspace/WorkspaceDocumentIntents.ts')) {
    if (!source.includes('ports.text.finishBeforeTransition(')
      || !source.includes('ports.getSession() === session')
      || !source.includes('scope.isCurrent()')
      || !source.includes('ports.closeDocument?.(documentId)')
      || source.includes('commit-before-mutation')) {
      failures.push(`${relativePath}: workspace intents must retain exact text-terminal admission and leave recovery/close barriers with the host`);
    }
  }
  if (normalizedPath.endsWith('/application/text/TextPropertyGestureController.ts')) {
    if (!source.includes('new DocumentTextPropertyGestureController(transaction')
      || !source.includes('this.pendingPaintPatch = patch;')
      || !source.includes("dependencies.recordObservedCommand('text.format'")
      || !source.includes('gesture.projection.cancel()')
      || !source.includes('finishBeforeTransition(transition: () => void)')) {
      failures.push(`${relativePath}: text-property gesture owner must retain coalesced projection, semantic observation and cancel`);
    }
  }
  if (normalizedPath.endsWith('/application/text/FlowTextEditingRuntime.tsx')) {
    if (!source.includes("editing.documentId !== document?.id")) {
      failures.push(`${relativePath}: text input and caret overlays must be bound to the active document identity`);
    }
  }
}

function verifyWarpCutover(relativePath, source) {
  const normalizedPath = relativePath.replaceAll('\\', '/');
  if (normalizedPath.endsWith('/application/commands/semanticWarpCommandExecutor.ts')) {
    if (!source.includes('changeDocument(')
      || /\b(?:applyDocument|recordHistory)\s*\(/.test(source)
      || source.includes('requestCanonicalProjection?')) {
      failures.push(`${relativePath}: semantic Warp must use shared document mutation without a projection fallback`);
    }
  }
  if (normalizedPath.endsWith('/application/tools/warp/warpSessionController.ts')) {
    if (source.includes('acquireInteractionBinding?')
      || source.includes('acquireInteractionBinding?.')
      || source.includes('interactionBinding?.requestCanonicalProjection')
      || !source.includes('terminalProjection.retire()')) {
      failures.push(`${relativePath}: interactive Warp must require its renderer lease through terminal projection`);
    }
  }
  if (normalizedPath.endsWith('/LightTableEditorOverlay.tsx')) {
    const forbiddenFaceWarpReviewOwners = [
      'FaceWarpDetector',
      'faceWarpDetectionGenerationRef',
      'setPendingFaceWarpDetection',
      'setFaceWarpBusy',
      'faceWarpDetectionReviewMatches'
    ];
    for (const symbol of forbiddenFaceWarpReviewOwners) {
      if (source.includes(symbol)) {
        failures.push(`${relativePath}: Face Warp detection/review owner ${symbol} must stay outside React`);
      }
    }
    for (const symbol of ['applyFaceWarpBrush(', 'relaxFaceWarpBrush(',
      'restoreFaceWarpBrush(', 'refineFaceWarpBrush(', 'findDeformedFaceHit(',
      'buildFaceWarpMeshOverlay(', 'applySemanticFaceWarpCommandToDocument(']) {
      if (source.includes(symbol)) {
        failures.push(`${relativePath}: Face Warp domain intent/projection ${symbol} belongs to its bounded application owner`);
      }
    }
    if (!source.includes('useFaceWarpIntents(') || !source.includes('useFaceWarpMeshPresentation(')
      || !source.includes('useFaceWarpLifecycle(')) {
      failures.push(`${relativePath}: Face Warp must wire its scoped intent and mesh presentation owners`);
    }
  }
  if (normalizedPath.endsWith('/application/tools/faceWarp/FaceWarpDetectionReviewController.ts')) {
    if (!source.includes('changeDocument: DocumentMutationController')
      || !source.includes('dependencies.getDocument() === document')
      || !source.includes('dependencies.getRenderer() === renderer')
      || !source.includes('scope.isCurrent()')
      || !source.includes('pendingScope')
      || source.includes('getRendererGeneration()')) {
      failures.push(`${relativePath}: Face Warp review must bind mutation and async publication to its opening owners`);
    }
  }
  if (normalizedPath.endsWith('/application/tools/faceWarp/FaceWarpInteractionSessionController.ts')
    && (source.includes('refinementScheduler') || source.includes('PendingRefinement')
      || source.includes('commitEdit()') || source.includes('cancelEdit()'))) {
    failures.push(`${relativePath}: Face Warp requires synchronous pointer-up refinement and exact property-edit terminal leases`);
  }
}

function verifyAdjustmentCutover(relativePath, source) {
  const normalizedPath = relativePath.replaceAll('\\', '/');
  if (normalizedPath.endsWith('/lighttable/LightTableEditorOverlay.tsx')) {
    if (!source.includes('createMountedAdjustmentCommandBinding({') || !source.includes('...adjustmentCommands')) {
      failures.push(`${relativePath}: mounted adjustment commands must use their bound adapter`);
    }
  }
  if (normalizedPath.endsWith('/application/adjustments/MountedAdjustmentCommandBinding.ts')
    && (!source.includes('ports.adjustments.finish(); read();')
      || !source.includes('ports.structure.commit(); read();')
      || !source.includes('begin(true); return executeSemanticProcessingStructure')
      || !source.includes('state.documentRevision') || source.includes('presented ='))) {
    failures.push(`${relativePath}: processing commands require scoped terminals, canonical query clocks and live presentation`);
  }
  if (normalizedPath.endsWith('/application/adjustments/executeSemanticProcessingStructure.ts')
    && !source.includes('return { ...command, changed }')) {
    failures.push(`${relativePath}: processing structure commands must report truthful idempotent completion`);
  }
  if (normalizedPath.endsWith('/application/adjustments/useAdjustmentTransactionController.ts')) {
    if (!source.includes('dependencies.documentMutations.begin(')
      || !source.includes('active.documentTransaction.change(')
      || !source.includes('projectAdjustmentDelta({')
      || !source.includes('previousSnapshot: before')
      || !source.includes('getCanonicalAdjustments(): BasicAdjustments | null')
      || !source.includes('getRendererGeneration(): number')
      || !source.includes('let rejectedGesture = false')
      || !source.includes('token?: AdjustmentInteractionToken')
      || !source.includes("if (active && token !== active.token) return 'rejected'")
      || !source.includes("export type AdjustmentChangeResult = 'applied' | 'unchanged' | 'rejected'")
      || source.includes('getAdjustments(): BasicAdjustments')
      || source.includes('previewSnapshot:')
      || source.includes('commitSnapshot:')
      || source.includes('pushHistoryEntry(entry: AdjustmentHistoryEntry)')) {
      failures.push(`${relativePath}: layer adjustment gestures must use the shared document transaction and may not restore presentation-owned commit/history ports`);
    }
  }
  if (normalizedPath.endsWith('/application/adjustments/projectAdjustmentSnapshot.ts')) {
    if (!source.includes('changedAdjustmentSettingsPaths(previousSnapshot, input.snapshot)')
      || !source.includes('patchAdjustmentStackFromBasicAdjustments(')
      || !source.includes('const editorAdjustments = changedPaths ? snapshot : structuredClone(snapshot)')) {
      failures.push(`${relativePath}: pointer-rate adjustment projection must patch only changed registry modules without cloning the full snapshot`);
    }
  }
  if (normalizedPath.endsWith('/application/adjustments/AdjustmentInteractionCoordinator.ts')) {
    if (!source.includes("state?.handle !== handle || state.terminal !== 'active'")
      || !source.includes('lease?.handle === handle')
      || !source.includes("state.terminal = 'cancel'")
      || !source.includes('controller.changeResult(mutate, domain, state.token)')
      || !source.includes("controller.end(state.token) === 'rejected'")
      || !source.includes('if (lease) cancelState(lease)')
      || !source.includes('state.epoch === epoch')
      || !source.includes('state.owner?.isCurrent()')
      || !source.includes('requestAdmission: AdjustmentInteractionAdmission,')
      || source.includes('if (requestAdmission)')) {
      failures.push(`${relativePath}: adjustment controls must retain opaque gesture ownership and ignore stale changes and terminal callbacks`);
    }
  }
  if (normalizedPath.endsWith('/application/interactions/InteractionTransitionCoordinator.ts')) {
    if (!source.includes("'preserve'")
      || !source.includes("'commit-before-mutation'")
      || !source.includes('retireParticipants();')
      || !source.includes('generation += 1;')
      || !source.includes('await dependencies.settleMountedInteraction(isCurrent)')
      || !source.includes('requestedGeneration === generation')
      || !source.includes('scope.isCurrent()')
      || (source.match(/!isCurrent\(\)/g)?.length ?? 0) < 3
      || !source.includes('dependencies.reportFailure(reason)')) {
      failures.push(`${relativePath}: mounted-document transitions must preserve host blur, settle before mutation, invalidate retired work and expose failures`);
    }
  }
  if (normalizedPath.endsWith('/application/interactions/MountedDocumentAdmission.ts')) {
    if (!source.includes("this.ports.transitions.request('commit-before-mutation', scope)")
      || !source.includes('this.ports.getSession() === session')
      || !source.includes('this.ports.getRenderer() === renderer')
      || !source.includes('getImageDocument')
      || !source.includes('scope.isCurrent()')
      || source.includes('let queue') || source.includes('documentRevision ===')) {
      failures.push(`${relativePath}: mounted admission must bind the exact ready source through the existing transition queue without a second queue or revision freeze`);
    }
  }
  if (normalizedPath.endsWith('/application/interactions/HostPresentationDeactivation.ts')) {
    if (!source.includes("ports.interactions.request('preserve')")
      || !source.includes('ports.viewport.cancelActiveGesture()')
      || !source.includes('ports.adjustments.reset()')
      || !source.includes('ports.rasterGradient.cancel()')
      || !source.includes('ports.cancelAutoAlign()')
      || source.includes('commit-before-mutation') || source.includes('finishBeforeTransition')) {
      failures.push(`${relativePath}: host blur preserves edits and only cancels named presentation gestures`);
    }
  }
  if (normalizedPath.endsWith('/application/adjustments/commitColorLookupAssetTransaction.ts')) {
    if (!source.includes('bindingIsCurrent(): boolean')
      || (source.match(/!bindingIsCurrent\(\)/g)?.length ?? 0) < 2
      || source.includes('beforeEditorAdjustments')
      || source.includes('applyProjection(')) {
      failures.push(`${relativePath}: LUT publication must bind the exact renderer/target and replay canonical state without presentation snapshots`);
    }
  }
  if (normalizedPath.endsWith('/application/adjustments/executeSemanticAdjustmentSnapshot.ts')
    || normalizedPath.endsWith('/application/adjustments/executeSemanticGradePatch.ts')) {
    if (!source.includes('changeDocument: DocumentMutationController')
      || !source.includes('publishDocumentProcessing')
      || /readonly publish:\s*\(/.test(source)
      || /readonly pushHistoryEntry:\s*\(/.test(source)) {
      failures.push(`${relativePath}: semantic layer adjustments must use document mutation while document processing remains an explicit separate owner`);
    }
  }
}

function verifyStyleAndFilterCutover(relativePath, source) {
  const normalizedPath = relativePath.replaceAll('\\', '/');
  if (!normalizedPath.endsWith('.test.ts') && !normalizedPath.endsWith('.test.tsx')
    && source.includes('layerStyleTestFixtures')) {
    failures.push(`${relativePath}: test-only Layer Style writers cannot enter production routes`);
  }
  if (source.includes('layerStyleDocumentWriter')
    && !normalizedPath.endsWith('/application/styles/layerStyleSnapshotOwner.ts')
    && !normalizedPath.endsWith('/editor/styles/layerStyleTestFixtures.ts')) {
    failures.push(`${relativePath}: only the canonical snapshot owner may import the low-level Layer Style writer`);
  }
  if (normalizedPath.endsWith('/application/styles/layerStyleInteractionSession.ts')) {
    if (!source.includes('readonly handle: LayerStyleInteractionHandle')
      || !source.includes('interaction.handle !== handle')
      || !source.includes('dependencies.getRenderer() === interaction.renderer')
      || !source.includes('dependencies.getRendererGeneration() === interaction.rendererGeneration')
      || !source.includes("dependencies.documentMutations.begin(")) {
      failures.push(`${relativePath}: Layer Style gestures must retain exact UI, document and renderer ownership`);
    }
  }
  if (normalizedPath.endsWith('/application/filters/filterInteractionSession.ts')) {
    if (!source.includes('readonly handle: FilterInteractionHandle')
      || !source.includes('interaction.handle !== handle')
      || !source.includes('dependencies.getRenderer() === interaction.renderer')
      || !source.includes('dependencies.getRendererGeneration() === interaction.rendererGeneration')
      || !source.includes('applyFilterPreviewSnapshot(')) {
      failures.push(`${relativePath}: filter gestures must retain exact UI, document and renderer ownership`);
    }
  }
  if (normalizedPath.endsWith('/application/commands/atomicCommandBatchExecutor.ts')
    || normalizedPath.endsWith('/application/commands/documentSessionCommandPorts.ts')) {
    if (source.includes("from '../../editor/styles/layerStyleCommands'")) {
      failures.push(`${relativePath}: command origins must use the semantic Layer Style owner`);
    }
  }
  if (normalizedPath.endsWith('/application/styles/semanticLayerStyleCommandExecutor.ts')
    && source.includes("from '../../editor/styles/layerStyleCommands'")) {
    failures.push(`${relativePath}: semantic Layer Style commands must publish through the snapshot owner`);
  }
  if (normalizedPath.endsWith('/application/layers/useLayerPanelController.ts')
    && (/finishStyleEditing\?\s*\(/.test(source)
      || /setAttachedFilterEnabled\?\s*\(/.test(source))) {
    failures.push(`${relativePath}: kernel lifecycle ports must be required and fail closed`);
  }
  if (normalizedPath.endsWith('/editor/workspace/LightTableDockWorkspace.tsx')
    && !source.includes('if (workspacePanelIsShown(panel)) return;')) {
    failures.push(`${relativePath}: showing an already presented workspace panel must not reactivate and reparent focused controls`);
  }
  if (normalizedPath.endsWith('/application/commands/documentSessionCommandPorts.ts')
    && (!source.includes("'executeLayerStyleSnapshot'")
      || !source.includes("'executeFilterSnapshot'")
      || !source.includes("'layer.style.setSnapshot'")
      || !source.includes("'filter.setSnapshot'"))) {
    failures.push(`${relativePath}: inactive documents must retain complete style/filter command parity`);
  }
  if (normalizedPath.endsWith('/editor/panels/LayerStylesPanel.tsx')
    && (!source.includes('controller.preview(stack, handle)')
      || !source.includes('return controller.beginInteraction()'))) {
    failures.push(`${relativePath}: Layer Style controls must preserve their admitted interaction handle`);
  }
  if (normalizedPath.endsWith('/editor/ui/LayerStyleEditor.tsx')
    && (source.includes("mode?: 'dialog'") || source.includes('role="dialog"'))) {
    failures.push(`${relativePath}: the retired non-admitted Layer Style dialog must not return`);
  }
}

function verifyDocumentLifecycleCutover(relativePath, source) {
  const normalizedPath = relativePath.replaceAll('\\', '/');
  if (normalizedPath.endsWith('/application/documentGeometry/DocumentSurfaceCommandService.ts')) {
    if (!source.includes('if (!session) throw new Error(')
      || !source.includes('requires an admitted document session.')
      || !source.includes('session.acquirePublicationAdmission(')
      || !source.includes('scope.assertCurrent();')
      || !source.includes('await commitDocumentSurfaceMutation(')) {
      failures.push(`${relativePath}: surface commands require scope, session admission and the compound publisher`);
    }
  }
  if (normalizedPath.endsWith('/lighttable/LightTableEditorOverlay.tsx')) {
    const fallbackCommands = [
      'document.resizeImage', 'document.applyGeometry', 'view.setZoom'
    ];
    for (const command of fallbackCommands) {
      if (source.includes(`if (!executeRegisteredCommand('${command}'`)) {
        failures.push(`${relativePath}: ${command} must fail closed through its required command route`);
      }
    }
    if (!source.includes('new DocumentSurfaceCommandService(')
      || source.includes('commitDocumentSurfaceMutation(')
      || source.includes('createResizePlan(') || source.includes('createDocumentGeometryPlan(')) {
      failures.push(`${relativePath}: document-wide geometry policy belongs only to DocumentSurfaceCommandService`);
    }
    const directPixelSettlements = source.match(/settlePixelInteractionRef\.current\(/g)?.length ?? 0;
    if (!source.includes('useTransformPresentation(')
      || source.includes('buildTransformEditingFrame(')
      || source.includes('buildSmartGuideEditingFrame(')
      || source.includes('.setTransformEditingFrame(')
      || source.includes('.setSmartGuideEditingFrame(')
      || source.includes('transformSnapMatchesRef')) {
      failures.push(`${relativePath}: transform cage and shared smart-guide presentation belong to the renderer-scoped presentation binding`);
    }
    if (!source.includes('useTextRenderPresentation(')
      || !source.includes('useTextRenderPresentationDiagnostics(')
      || source.includes('pendingTextRenderPresentationRef')
      || source.includes('textRenderPresentationFrameRef')
      || source.includes('textRenderTraceSignatureRef')
      || source.includes('setTextRenderPresentation')) {
      failures.push(`${relativePath}: deferred text presentation and trace lifetime belong to TextRenderPresentation, not the composition root`);
    }
    if (!source.includes('useGenAiRemoveObject(')
      || source.includes('executeRemoveObject(')
      || source.includes('removeObjectPendingRef')) {
      failures.push(`${relativePath}: Remove Object capture and submission lifetime must remain in bounded editor/GenAI owners`);
    }
    if (!/createMountedTextCommandBinding(?:<DocumentRendererPort>)?\(/.test(source) || source.includes('executeSemanticTextCommand(')
      || source.includes('assertTextCreationCommandReady') || source.includes('assertFileCommandReady')
      || source.includes('commandService.enqueueTextCreation(') || !source.includes('useTextCreation(')) {
      failures.push(`${relativePath}: queued text creation must retain the runner-owned handle and exact mounted text publication binding`);
    }
    if (!source.includes('useGenAiProviders(') || source.includes('genAiProviderSnapshots')
      || source.includes('fallbackGenAiProvider') || source.includes('updateGenAiProviderSnapshot')
      || /genAiService\.(getProviderSnapshots|subscribe|connectProvider|disconnectProvider)\(/.test(source)) {
      failures.push(`${relativePath}: provider preference/status/request lifetime belongs to the independent GenAI provider owner`);
    }
    if (!source.includes('useLayerFinalizationIntents(')
      || !source.includes('rasterizeText: layerFinalizationIntents.rasterizeText')
      || !source.includes('usePositionedTextRecovery(')
      || source.includes('rasterizeActiveTextLayerCommand')
      || source.includes('positionedTextRecoveryController')
      || !source.includes('usePropertiesInspectorPresentation(')
      || !source.includes('new LayerStyleEntryIntent(')
      || source.includes('setPropertiesTarget')
      || source.includes('const mergeLayersCommand =')
      || source.includes('const flattenGroupCommand =')
      || source.includes('const flattenImageCommand =')) {
      failures.push(`${relativePath}: layer finalization intents and inspector entry/presentation must remain in their bounded owners`);
    }
    if (!source.includes('executeSelectionCommand: createMountedSelectionCommandBinding(')
      || source.includes('executeSelectionCommand: async')
      || source.includes('selectionSessionController.selectLayerTransparency(')) {
      failures.push(`${relativePath}: selection command mapping belongs to the scoped binding and panel transparency uses the existing semantic command`);
    }
    if (!source.includes('useAdjustmentCreationIntents(')
      || !source.includes('executeAdjustmentCreation: createMountedAdjustmentCreationBinding(')
      || source.includes('applyCurvesRef') || source.includes('applyAdjustmentRef')
      || source.includes('executeAdjustmentCreationRef') || source.includes('resolveContextualAdjustmentCreation(')) {
      failures.push(`${relativePath}: adjustment creation placement/reveal and registered mapping belong to their scoped owners`);
    }
    if (!source.includes('useEditorToolSettings(workspaceDocumentId, setEditorSession)')
      || source.includes('BrushPercentInput') || source.includes('brushPercentInputRef')
      || source.includes('steppedBrushSize(') || source.includes('steppedBrushHardness(')
      || source.includes('const updateBrush =') || source.includes('const updateWarp =')
      || !source.includes('onSwapColors={toolSettings.swapColors}')) {
      failures.push(`${relativePath}: tool-default patches and digit/brush keyboard policy belong to EditorToolSettings`);
    }
    if (!source.includes('deleteActiveTargetRef.current = deleteTargetIntent.run')
      || source.includes('resolveDeleteTarget(') || source.includes('fillCommandController.clearSelection(')
      || source.includes('vectorToolSessionController.deleteSelection(')) {
      failures.push(`${relativePath}: Delete precedence and post-settlement target validation belong to DeleteTargetIntent`);
    }
    // Overlay-only guard: after its closed-presentation return, the remaining body is JSX wiring, not hook setup.
    const closedPresentationReturn = source.indexOf('if (!open) return null;');
    if (closedPresentationReturn < 0 || /\buse[A-Z]\w*\s*\(/.test(source.slice(closedPresentationReturn))
      || !source.includes("if (open && activeTextPropertyLayer?.type === 'text')")
      || !source.includes('const applyTextFontAsset = textPropertyCommands.applyFont;')
      || !source.includes('const applyTextWritingMode = textPropertyCommands.applyWritingMode;')) {
      failures.push(`${relativePath}: the open return must follow every Overlay hook and closed text cannot reveal Properties`);
    }
    if (!source.includes('useDocumentGuideInteraction(')
      || !source.includes('useGuideGridPresentation(')
      || source.includes('setGuideDraft')
      || source.includes('buildDocumentGuideFrame(')
      || source.includes('buildDocumentGridFrame(')
      || source.includes('.setDocumentGuideEditingFrame(')
      || source.includes('.setDocumentGridEditingFrame(')
      || source.includes('replaceDocumentGuides(')
      || source.includes('addDocumentGuide(')) {
      failures.push(`${relativePath}: guide intent and guide/grid projection belong to their scoped owners, not the composition root`);
    }
    if (directPixelSettlements !== 1
      || !source.includes('new MountedDocumentAdmission(')
      || !source.includes('mountedDocumentAdmission.runAfter')
      || !source.includes('settlePixelInteractionRef.current(isCurrent)')
      || source.includes("interactionTransitions.request('commit-before-mutation'")
      || !source.includes('interactionTransitions.retire(')
      || !source.includes('selectionSessionController.retire();')
      || source.includes('cancelPixelInteractionRef')
      || !source.includes('deactivateHostPresentation({')) {
      failures.push(`${relativePath}: mounted-document interaction transitions must have one centralized preserve, settlement and retirement authority`);
    }
    if (!source.includes('resetAdjustmentTransactionRef.current = adjustmentInteractions.reset;')
      || !source.includes('resetActiveAdjustmentTransactionRef.current = adjustmentTransactionController.reset;')
      || !source.includes('resetActiveAdjustmentPreview: () => resetActiveAdjustmentTransactionRef.current()')
      || !source.includes('const applyDocumentSnapshot = documentProjectionController.applyDocumentSnapshot;')) {
      failures.push(`${relativePath}: canonical publication must retire an active adjustment preview without cancelling the successor gesture waiting for interaction admission`);
    }
  }
  if (normalizedPath.endsWith('/application/documents/documentProjectionBinding.ts')) {
    if (!/applyDocumentSnapshot:[\s\S]{0,130}port\.resetActiveAdjustmentPreview\(\);\s*projection\.applyDocumentSnapshot\(document\);/.test(source)
      || source.includes('resetAdjustmentTransaction') || source.includes('adjustmentInteractions.reset')) {
      failures.push(`${relativePath}: canonical projection must reset only the active adjustment preview before publication, preserving successor admission`);
    }
  }
  if (normalizedPath.endsWith('/application/documentGeometry/commitDocumentSurfaceMutation.ts')
    && (!source.includes('readonly acquirePublicationAdmission: () =>')
      || source.includes('readonly acquirePublicationAdmission?:'))) {
    failures.push(`${relativePath}: document-surface mutation must require shared publication admission`);
  }
  if (normalizedPath.endsWith('/application/documents/documentSession.ts')
    && !source.includes('this.history.acquirePublicationBarrier()')) {
    failures.push(`${relativePath}: document publication admission must own foreign history exclusion`);
  }
  if (normalizedPath.endsWith('/standalone/DocumentRecoveryTransitionGate.ts')
    && (!source.includes('private transitionTail: Promise<void>')
      || !source.includes('await previous;')
      || !source.includes('releaseTurn();')
      || !source.includes('runFailedOpenDiscard<Result>'))) {
    failures.push(`${relativePath}: document transitions must serialize recovery flush and terminal publication`);
  }
  if (normalizedPath.endsWith('/standalone/LightTableStandaloneApp.tsx')
    && !source.includes('void recoveryTransitions.runTransition(async () => {\n      const outcome = await requestWorkspaceDocumentClose')) {
    failures.push(`${relativePath}: document close must run inside the recovery transition owner`);
  }
  if (normalizedPath.endsWith('/standalone/LightTableStandaloneApp.tsx')
    && !source.includes('recoveryTransitions.runFailedOpenDiscard(async () => {')) {
    failures.push(`${relativePath}: failed document opens must use the non-checkpointing discard transition`);
  }
  if (normalizedPath.endsWith('/standalone/LightTableStandaloneApp.tsx')) {
    const terminalRendererWaits = source.match(/await waitForActiveDocumentRenderer\(/g)?.length ?? 0;
    if (terminalRendererWaits < 3) {
      failures.push(`${relativePath}: create, duplicate and image-artifact open must await exact active renderer readiness`);
    }
  }
}

function verifyCommandRoutingCutover(relativePath, source) {
  const normalizedPath = relativePath.replaceAll('\\', '/');
  if (!normalizedPath.endsWith('.test.ts')
    && (normalizedPath.includes('/application/commands/')
      || normalizedPath.endsWith('/LightTableEditorOverlay.tsx'))
    && /\.markChanged\s*\(/.test(source)) {
    failures.push(`${relativePath}: command completion and UI observation cannot author canonical revision; DocumentSession publication owns it`);
  }
  if (normalizedPath.endsWith('/lighttable/LightTableEditorOverlay.tsx')) {
    const forbiddenFallbackOwners = [
      'commandService?.',
      'EMPTY_ACTION_RECORDING',
      'EMPTY_ACTION_PLAYBACK',
      'EMPTY_ACTION_LIBRARY',
      'subscribeToNothing',
      'layerDocumentCommands.pasteSelectedContent',
      'layerPanelController.duplicateActive()',
      'layerPanelController.moveActive(direction)',
      '...layerPanelController',
      'selectionSessionController.clear();',
      'function requestTextToShape(',
      'function commitTextToShape(',
      'new TextToShapeCommandController(',
      'executeSemanticGradePatch(',
      'executeSemanticAdjustmentSnapshot(',
      'executeSemanticProcessingStructure(',
      'projectAdjustmentQuery(',
      'resolveBasicAdjustmentTarget(',
      'execution ?? textToShapeController.convert'
    ];
    for (const owner of forbiddenFallbackOwners) {
      if (source.includes(owner)) {
        failures.push(`${relativePath}: command UI fallback owner ${owner} must not return`);
      }
    }
    if (source.includes("if (!executeRegisteredCommand('")
      || source.includes('if (!commandService)')) {
      failures.push(`${relativePath}: required semantic commands must fail closed, never enter a direct UI fallback`);
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
      verifyTransformCutover(relativePath, source);
      verifyVectorCutover(relativePath, source);
      verifyTextCutover(relativePath, source);
      verifyWarpCutover(relativePath, source);
      verifyAdjustmentCutover(relativePath, source);
      verifyStyleAndFilterCutover(relativePath, source);
      verifyDocumentLifecycleCutover(relativePath, source);
      verifyCommandRoutingCutover(relativePath, source);
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
