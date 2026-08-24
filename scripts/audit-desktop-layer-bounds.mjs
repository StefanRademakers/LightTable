import { _electron as electron } from 'playwright-core';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';
import { resolveDesktopTestLaunch, waitForDesktopLauncher } from './desktop-test-startup.mjs';

const root = path.resolve(import.meta.dirname, '..');
const outputDirectory = path.join(root, 'tmp', 'layer-bounds-audit');
const userData = path.join(outputDirectory, 'user-data');
const sourceFile = process.env.LIGHTTABLE_BOUNDS_AUDIT_SOURCE
  ?? path.join('D:', 'mediavibe', 'LightTableTestFiles', 'RandomFiles', 'svg_vector_render_test.svg');

const finiteRect = (rect) => rect === null || (
  Number.isFinite(rect.x) && Number.isFinite(rect.y)
  && Number.isFinite(rect.width) && Number.isFinite(rect.height)
  && rect.width > 0 && rect.height > 0
);

const contains = (outer, inner, epsilon = 0.01) => (
  outer.x <= inner.x + epsilon
  && outer.y <= inner.y + epsilon
  && outer.x + outer.width + epsilon >= inner.x + inner.width
  && outer.y + outer.height + epsilon >= inner.y + inner.height
);

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(userData, { recursive: true });
const launch = await resolveDesktopTestLaunch(root);
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath: launch.executablePath,
  args: launch.args,
  cwd: root,
  env: {
    ...environment,
    LIGHTTABLE_AUTOMATION_USER_DATA: userData,
    LIGHTTABLE_AUTOMATION_OPEN_FILE: sourceFile
  },
  timeout: 30_000
});

try {
  const page = await app.firstWindow({ timeout: 30_000 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.stack ?? error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  const openFile = await waitForDesktopLauncher({
    app,
    page,
    outputDirectory,
    sourceFile,
    pageErrors: errors,
    label: 'layer-bounds-audit'
  });
  await openFile.click();
  await page.locator('.lighttable-toolbar__meta').filter({ hasText: /ready/i })
    .waitFor({ state: 'visible', timeout: 120_000 });

  const driver = await attachLightTableAutomation(page, 'layer-bounds-audit');
  const workspace = await driver.queryWorkspace();
  const documentId = workspace?.activeDocumentId;
  const document = documentId ? await driver.queryDocument(documentId) : null;
  const layers = documentId ? await driver.queryLayers(documentId) : null;
  if (!documentId || !document?.canvas || !layers) {
    throw new Error('The active document and its projected layer bounds are unavailable.');
  }
  const missingBounds = layers.filter((layer) => !layer.bounds);
  if (missingBounds.length) {
    throw new Error(
      'The launched desktop bundle predates the layer-bounds query contract. Rebuild the desktop test package first.'
    );
  }

  const invalid = layers.filter((layer) => (
    !finiteRect(layer.bounds.document) || !finiteRect(layer.bounds.visual)
  ));
  if (invalid.length) {
    throw new Error(`Invalid projected rectangles: ${JSON.stringify(invalid.map((layer) => ({
      id: layer.id, name: layer.name, bounds: layer.bounds
    })))}`);
  }
  const containmentFailures = layers.filter((layer) => (
    layer.bounds.document && layer.bounds.visual
    && !contains(layer.bounds.visual, layer.bounds.document)
  ));
  if (containmentFailures.length) {
    throw new Error(`Visual bounds do not contain authored bounds: ${JSON.stringify(
      containmentFailures.map((layer) => ({ id: layer.id, name: layer.name, bounds: layer.bounds }))
    )}`);
  }

  const projection = await page.evaluate(({ documentResult, layers }) => {
    const viewport = globalThis.document.querySelector('.lighttable-viewport');
    if (!(viewport instanceof HTMLElement)) throw new Error('Document viewport is unavailable.');
    const width = viewport.clientWidth;
    const height = viewport.clientHeight;
    const view = documentResult.viewport;
    const scale = view.zoomMode === 'fit'
      ? Math.min(width / documentResult.canvas.width, height / documentResult.canvas.height) * 0.94
      : view.zoomMode === '100' ? 1 : view.scale;
    const imageX = (width - documentResult.canvas.width * scale) / 2 + view.panX;
    const imageY = (height - documentResult.canvas.height * scale) / 2 + view.panY;
    const namespace = 'http://www.w3.org/2000/svg';
    const overlay = globalThis.document.createElementNS(namespace, 'svg');
    overlay.setAttribute('data-lighttable-layer-bounds-audit', 'true');
    overlay.setAttribute('width', String(width));
    overlay.setAttribute('height', String(height));
    Object.assign(overlay.style, {
      position: 'absolute', inset: '0', zIndex: '1000', pointerEvents: 'none', overflow: 'hidden'
    });
    const colors = {
      'raster-source': '#00e5ff',
      'vector-paint': '#ff3df2',
      'text-frame': '#ffe14a',
      'derived-preview': '#ff8a33',
      'photoshop-metadata': '#a7ff4a',
      'group-union': '#ffffff',
      unavailable: '#ff3d3d'
    };
    let drawn = 0;
    const drawRect = (rect, layer, visual) => {
      if (!rect) return;
      const shape = globalThis.document.createElementNS(namespace, 'rect');
      shape.setAttribute('x', String(imageX + rect.x * scale));
      shape.setAttribute('y', String(imageY + rect.y * scale));
      shape.setAttribute('width', String(rect.width * scale));
      shape.setAttribute('height', String(rect.height * scale));
      shape.setAttribute('fill', 'none');
      shape.setAttribute('stroke', colors[layer.bounds.source] ?? '#ffffff');
      shape.setAttribute('stroke-width', visual ? '2' : '1');
      shape.setAttribute('stroke-dasharray', visual ? 'none' : '5 3');
      shape.setAttribute('vector-effect', 'non-scaling-stroke');
      shape.setAttribute('opacity', visual ? '0.95' : '0.65');
      overlay.append(shape);
      drawn += 1;
    };
    for (const layer of layers) {
      if (!layer.visible || layer.type === 'adjustment') continue;
      drawRect(layer.bounds.document, layer, false);
      drawRect(layer.bounds.visual, layer, true);
    }
    viewport.append(overlay);
    return { width, height, scale, imageX, imageY, drawn };
  }, { documentResult: document, layers });

  if (projection.drawn === 0) throw new Error('No visible layer bounds were available to draw.');
  const viewport = page.locator('.lighttable-viewport');
  await viewport.screenshot({ path: path.join(outputDirectory, 'layer-bounds.png') });
  await page.screenshot({ path: path.join(outputDirectory, 'layer-bounds-full-app.png') });
  if (errors.length) throw new Error(`Renderer errors: ${JSON.stringify(errors)}`);

  const report = {
    passed: true,
    sourceFile,
    documentId,
    canonicalRevision: document.canonicalRevision,
    projection,
    layers: layers.map((layer) => ({
      id: layer.id,
      name: layer.name,
      type: layer.type,
      transform: layer.transform,
      bounds: layer.bounds
    })),
    unknownVisualBounds: layers.filter((layer) => layer.bounds.visual === null).length,
    errors
  };
  await writeFile(path.join(outputDirectory, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`Layer bounds audit passed. Screenshot: ${path.join(
    outputDirectory, 'layer-bounds.png'
  )}\n`);
} finally {
  await app.close().catch(() => {});
}
