import { _electron as electron } from 'playwright-core';
import { access, mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const workspaceRoot = path.resolve(import.meta.dirname, '..');
const desktopAppPath = path.join(workspaceRoot, 'apps', 'desktop');
const defaultExecutable = path.join(
  workspaceRoot, 'node_modules', 'electron', 'dist', 'electron.exe'
);

const argument = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};

const sourceFile = path.resolve(argument('file', 'D:\\TextTest.psd'));
const sourceName = path.basename(sourceFile);
const expectedFlowLayers = Number.parseInt(argument(
  'expect-flow-layers',
  /^TextTest\.psd$/i.test(sourceName) ? '5' : '0'
), 10);
const expectedVectorLayers = Number.parseInt(argument(
  'expect-vector-layers',
  /^TextTest\.psd$/i.test(sourceName) ? '1' : '0'
), 10);
const allowSubstitutedText = argument('allow-substituted-text', '') === 'true';
const selectLayer = argument('select-layer', '');
const openLayerEffects = argument('open-layer-effects', '') === 'true';
const canvasClickX = Number.parseFloat(argument('canvas-click-x', 'NaN'));
const canvasClickY = Number.parseFloat(argument('canvas-click-y', 'NaN'));
const nudgeX = Number.parseInt(argument('nudge-x', '0'), 10);
const nudgeY = Number.parseInt(argument('nudge-y', '0'), 10);
const waitAfterMs = Math.max(0, Number.parseInt(argument('wait-after-ms', '0'), 10) || 0);
const viewportWidth = Number.parseInt(argument('viewport-width', '0'), 10);
const viewportHeight = Number.parseInt(argument('viewport-height', '0'), 10);
const dragX = Number.parseFloat(argument('drag-x', '0'));
const dragY = Number.parseFloat(argument('drag-y', '0'));
const enableFill = argument('enable-fill', '');
const fillColor = argument('fill-color', '');
const strokeColor = argument('stroke-color', '');
const strokeWidth = Number.parseFloat(argument('stroke-width', 'NaN'));
const strokeAlignment = argument('stroke-alignment', '');
const mergeDown = argument('merge-down', '') === 'true';
const createRectangle = argument('create-rectangle', '') === 'true';
const createGradientFill = argument('create-gradient-fill', '') === 'true';
const openGradientEditor = argument('open-gradient-editor', '') === 'true';
const dragGradientEnd = argument('drag-gradient-end', '') === 'true';
const createRasterLayerForPaint = argument('create-raster-layer', '') === 'true';
const paintStroke = argument('paint-stroke', '') === 'true';
const paintExistingLayer = argument('paint-existing-layer', '') === 'true';
const paintColor = argument('paint-color', '#ff0000');
const paintTool = argument('paint-tool', 'brush');
const sampleLayer = argument('sample-layer', '');
const sampleX = Number.parseFloat(argument('sample-x', '0.35'));
const sampleY = Number.parseFloat(argument('sample-y', '0.35'));
const paintX = Number.parseFloat(argument('paint-x', '0.2'));
const paintY = Number.parseFloat(argument('paint-y', '0.25'));
const brushSize = Number.parseFloat(argument('brush-size', '48'));
const healingDiffusion = Number.parseInt(argument('healing-diffusion', '5'), 10);
const paintStrokeLength = Number.parseFloat(argument('paint-stroke-length', '0.2'));
const saveLightTableArgument = argument('save-lighttable', '');
const saveLightTableFile = saveLightTableArgument ? path.resolve(saveLightTableArgument) : null;
const expectLayer = argument('expect-layer', '');
const expectNonemptyLayer = argument('expect-nonempty-layer', '');
const openCompatibilityReport = argument('open-compatibility-report', '') === 'true';
const editTextLayer = argument('edit-text-layer', '');
const replacementFont = argument('replacement-font', '');
const targetZoomPercent = Number.parseFloat(argument('zoom-percent', 'NaN'));
const zoomFocusX = Number.parseFloat(argument('zoom-focus-x', 'NaN'));
const zoomFocusY = Number.parseFloat(argument('zoom-focus-y', 'NaN'));
const validatePdfFonts = argument('pdf-validate-fonts', '') === 'true';
const exportFlattenedPdf = argument('pdf-export-flattened', '') === 'true';
const exportNativePdf = argument('pdf-export-native', '') === 'true';
const exportNativeVectorPdf = argument('pdf-export-vectors', '') === 'true';
const exportNativeMixedPdf = argument('pdf-export-mixed', '') === 'true';
const openPdfPreflight = argument('pdf-preflight', '') === 'true'
  || validatePdfFonts || exportFlattenedPdf || exportNativePdf
  || exportNativeVectorPdf || exportNativeMixedPdf;
const outputFile = path.resolve(argument(
  'output',
  path.join(workspaceRoot, 'tmp', 'screenshots', 'desktop-text-test.png')
));
const executablePath = path.resolve(argument('executable', defaultExecutable));
const reportFile = outputFile.replace(/\.[^.]+$/, '.json');
const exportedPdfFile = path.resolve(argument(
  'pdf-output',
  outputFile.replace(/\.[^.]+$/, '.pdf')
));
const userDataPath = path.resolve(argument(
  'user-data',
  path.join(workspaceRoot, 'tmp', 'playwright-user-data')
));

await Promise.all([access(sourceFile), access(executablePath)]).catch((error) => {
  throw new Error(
    `Screenshot prerequisites are missing. Build the desktop app and check the input path.\n${error}`
  );
});
await Promise.all([
  mkdir(path.dirname(outputFile), { recursive: true }),
  mkdir(userDataPath, { recursive: true }),
  ...(saveLightTableFile ? [mkdir(path.dirname(saveLightTableFile), { recursive: true })] : [])
]);

const diagnostics = {
  sourceFile,
  expectedFlowLayers,
  expectedVectorLayers,
  interaction: {
    selectLayer, openLayerEffects, canvasClickX, canvasClickY, nudgeX, nudgeY, dragX, dragY,
    enableFill, fillColor, strokeColor, strokeWidth, strokeAlignment, mergeDown, createRectangle,
    createGradientFill, openGradientEditor, dragGradientEnd,
    createRasterLayerForPaint, paintStroke, paintExistingLayer, paintColor, paintTool,
    sampleLayer, sampleX, sampleY, paintX, paintY, brushSize, healingDiffusion,
    paintStrokeLength,
    saveLightTableFile, expectLayer, expectNonemptyLayer, openCompatibilityReport,
    editTextLayer, replacementFont,
    targetZoomPercent, zoomFocusX, zoomFocusY,
    openPdfPreflight, validatePdfFonts, exportFlattenedPdf, exportNativePdf,
    exportNativeVectorPdf, exportNativeMixedPdf
  },
  outputFile,
  executablePath,
  capturedAt: new Date().toISOString(),
  console: [],
  pageErrors: [],
  layers: [],
  status: '',
  metadata: '',
  metadataTitle: '',
  debugPanel: '',
  runtime: null
};
const launchEnvironment = { ...process.env };
delete launchEnvironment.ELECTRON_RUN_AS_NODE;

let electronApp;
let window;
let failure;
let screenshotCaptured = false;
try {
  electronApp = await electron.launch({
    executablePath,
    args: [desktopAppPath],
    cwd: workspaceRoot,
    env: {
      ...launchEnvironment,
      LIGHTTABLE_AUTOMATION_OPEN_FILE: sourceFile,
      LIGHTTABLE_AUTOMATION_USER_DATA: userDataPath,
      ...(saveLightTableFile ? { LIGHTTABLE_AUTOMATION_SAVE_FILE: saveLightTableFile } : {})
    },
    timeout: 30_000
  });
  window = await electronApp.firstWindow({ timeout: 30_000 });
  if (viewportWidth > 0 && viewportHeight > 0) {
    await window.setViewportSize({ width: viewportWidth, height: viewportHeight });
  }
  await window.evaluate(() => {
    globalThis.__lightTableLongTasks = [];
    if (PerformanceObserver.supportedEntryTypes.includes('longtask')) {
      new PerformanceObserver((list) => {
        globalThis.__lightTableLongTasks.push(...list.getEntries().map((entry) => ({
          startTime: entry.startTime,
          duration: entry.duration
        })));
      }).observe({ type: 'longtask', buffered: true });
    }
  });
  window.on('console', (message) => diagnostics.console.push({
    type: message.type(),
    text: message.text()
  }));
  window.on('pageerror', (error) => diagnostics.pageErrors.push(error.stack ?? error.message));

  await window.getByRole('button', { name: 'Open file' }).click();
  const escapedSourceName = sourceName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  await window.getByRole('tab', { name: new RegExp(escapedSourceName, 'i') }).waitFor({
    state: 'visible',
    timeout: 30_000
  });
  if (expectedFlowLayers > 0) {
    await window.locator('.lighttable-layer__text-status', { hasText: 'Flow' })
      .first()
      .waitFor({ state: 'visible', timeout: 30_000 });
  }
  if (expectedVectorLayers > 0) {
    await window.locator('.lighttable-layer__thumbnail[title="Vector layer"]')
      .first()
      .waitFor({ state: 'visible', timeout: 30_000 });
  }
  await window.locator('.lighttable-toolbar__meta')
    .filter({ hasText: /ready/i })
    .waitFor({ state: 'attached', timeout: 30_000 });

  await window.waitForFunction(() => {
    const status = document.querySelector('.lighttable-toolbar__status')?.textContent ?? '';
    return !status.includes('Preparing the text engine');
  }, undefined, { timeout: 15_000 }).catch(() => {});
  await window.waitForTimeout(750);

  if (Number.isFinite(targetZoomPercent)) {
    const focusZoom = Number.isFinite(zoomFocusX) && Number.isFinite(zoomFocusY);
    if (focusZoom) {
      const box = await window.locator('.lighttable-viewport').boundingBox();
      if (!box) throw new Error('The document viewport has no zoom bounds.');
      await window.mouse.move(
        box.x + box.width * Math.max(0, Math.min(1, zoomFocusX)),
        box.y + box.height * Math.max(0, Math.min(1, zoomFocusY))
      );
    }
    let currentZoom = 0;
    for (let attempt = 0; attempt < 32; attempt += 1) {
      const metadataText = await window.locator('.lighttable-toolbar__meta').textContent() ?? '';
      currentZoom = Number(metadataText.match(/(\d+(?:\.\d+)?)%/)?.[1] ?? 0);
      if (currentZoom >= targetZoomPercent) break;
      if (focusZoom) await window.mouse.wheel(0, -240);
      else await window.keyboard.press('Control+Equal');
      await window.waitForTimeout(30);
    }
    diagnostics.zoomPercent = currentZoom;
    if (currentZoom < targetZoomPercent) {
      throw new Error(`Could not reach requested zoom ${targetZoomPercent}% (reached ${currentZoom}%).`);
    }
  }

  if (createRasterLayerForPaint || paintStroke) {
    let activeLayer;
    if (paintExistingLayer) {
      if (!selectLayer) throw new Error('--paint-existing-layer requires --select-layer.');
      activeLayer = window.locator('.lighttable-layer').filter({
        has: window.locator(`.lighttable-layer__name[value="${selectLayer.replaceAll('"', '\\"')}"]`)
      }).first();
      await activeLayer.click();
    } else {
      const layerCount = await window.locator('.lighttable-layer').count();
      await window.getByRole('button', { name: 'New raster layer' }).click();
      await window.waitForFunction((expected) =>
        document.querySelectorAll('.lighttable-layer').length === expected,
      layerCount + 1, { timeout: 15_000 });
      activeLayer = window.locator('.lighttable-layer--active');
    }
    await activeLayer.waitFor({ state: 'visible', timeout: 15_000 });
    diagnostics.paint = {
      layerName: await activeLayer.locator('.lighttable-layer__name').inputValue(),
      thumbnailBefore: await activeLayer.locator('.lighttable-layer__thumbnail-preview')
        .getAttribute('src').catch(() => null)
    };
    activeLayer = window.locator('.lighttable-layer').filter({
      has: window.locator(`.lighttable-layer__name[value="${diagnostics.paint.layerName.replaceAll('"', '\\"')}"]`)
    }).first();

    if (paintStroke) {
      if (!/^#[\da-f]{6}$/i.test(paintColor)) {
        throw new Error('--paint-color must be a six-digit hex colour.');
      }
      const paintToolLabel = paintTool === 'clone-stamp'
        ? 'Clone Stamp (S)'
        : paintTool === 'healing-brush' ? 'Healing Brush (J)' : 'Brush (B)';
      await window.getByRole('button', { name: paintToolLabel }).click();
      const sizeControl = window.getByLabel('Size', { exact: true });
      await sizeControl.focus();
      await sizeControl.press('Home');
      for (let value = 1; value < Math.round(brushSize); value += 1) {
        await sizeControl.press('ArrowRight');
      }
      if (paintTool === 'healing-brush') {
        if (healingDiffusion < 1 || healingDiffusion > 7) {
          throw new Error('--healing-diffusion must be an integer from 1 through 7.');
        }
        await window.getByLabel('Diffusion', { exact: true }).fill(String(healingDiffusion));
      }
      await window.locator('input[type="color"][aria-label="Foreground color"]').fill(paintColor);
      const viewport = window.locator('.lighttable-viewport');
      const box = await viewport.boundingBox();
      if (!box) throw new Error('The document viewport has no interactive bounds.');
      const metadataText = await window.locator('.lighttable-toolbar__meta').textContent() ?? '';
      const size = metadataText.match(/(\d+)\s*[x×]\s*(\d+)/i);
      const zoom = metadataText.match(/(\d+(?:\.\d+)?)%/);
      if (!size || !zoom) throw new Error(`Could not resolve document display geometry: ${metadataText}`);
      const displayWidth = Number(size[1]) * Number(zoom[1]) / 100;
      const displayHeight = Number(size[2]) * Number(zoom[1]) / 100;
      const documentLeft = box.x + (box.width - displayWidth) / 2;
      const documentTop = box.y + (box.height - displayHeight) / 2;
      const startX = documentLeft + displayWidth * paintX;
      const startY = documentTop + displayHeight * paintY;
      if (paintTool !== 'brush') {
        if (!sampleLayer) throw new Error('--sample-layer is required for sampled paint tools.');
        const sourceLayer = window.locator('.lighttable-layer').filter({
          has: window.locator(`.lighttable-layer__name[value="${sampleLayer.replaceAll('"', '\\"')}"]`)
        }).first();
        await sourceLayer.click();
        await window.keyboard.down('Alt');
        await window.waitForTimeout(40);
        await window.mouse.move(
          documentLeft + displayWidth * sampleX,
          documentTop + displayHeight * sampleY
        );
        await window.mouse.down();
        await window.mouse.up();
        await window.keyboard.up('Alt');
        diagnostics.paint.sampleStatus = await window.locator('.lighttable-toolbar__status').textContent();
        await activeLayer.click();
      }
      await window.mouse.move(startX, startY);
      await window.mouse.down();
      if (paintStrokeLength !== 0) {
        await window.mouse.move(
          startX + displayWidth * paintStrokeLength,
          startY,
          { steps: 16 }
        );
      }
      await window.mouse.up();
      const thumbnail = activeLayer.locator('.lighttable-layer__thumbnail-preview');
      await thumbnail.waitFor({ state: 'visible', timeout: 15_000 });
      await window.waitForFunction(
        ({ selector, before }) => document.querySelector(selector)?.getAttribute('src') !== before,
        {
          selector: '.lighttable-layer--active .lighttable-layer__thumbnail-preview',
          before: diagnostics.paint.thumbnailBefore
        },
        { timeout: 10_000 }
      ).catch(() => {});
      diagnostics.paint.thumbnailAfter = await thumbnail.getAttribute('src');
      diagnostics.paint.viewport = { displayWidth, displayHeight, startX, startY };
      if (diagnostics.paint.thumbnailAfter === diagnostics.paint.thumbnailBefore) {
        throw new Error('The raster-layer thumbnail did not change after the brush stroke.');
      }
    }
  }

  if (createRectangle) {
    await window.getByRole('button', { name: 'Rectangle (U)' }).click();
    const canvas = window.locator('.lighttable-viewport');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('The document canvas has no interactive bounds.');
    // Keep the gesture clear of the floating Layers panel used by this fixture.
    const startX = box.x + box.width * 0.68;
    const startY = box.y + box.height * 0.68;
    await window.mouse.move(startX, startY);
    await window.mouse.down();
    await window.mouse.move(startX + 160, startY + 100, { steps: 12 });
    await window.mouse.up();
    await window.waitForTimeout(500);
  }

  if (createGradientFill) {
    const layerCount = await window.locator('.lighttable-layer').count();
    await window.getByRole('button', { name: 'New Gradient Fill layer' }).click();
    await window.waitForFunction((expected) =>
      document.querySelectorAll('.lighttable-layer').length === expected,
    layerCount + 1, { timeout: 15_000 });
    const row = window.locator('.lighttable-layer--active');
    await row.waitFor({ state: 'visible', timeout: 15_000 });
    diagnostics.gradientFill = { layerName: await row.locator('.lighttable-layer__name').inputValue() };
    await window.getByRole('button', { name: /Path selection/i }).click();
    if (dragGradientEnd) {
      const viewport = window.locator('.lighttable-viewport');
      const box = await viewport.boundingBox();
      if (!box) throw new Error('The document viewport has no gradient bounds.');
      const metadataText = await window.locator('.lighttable-toolbar__meta').textContent() ?? '';
      const size = metadataText.match(/(\d+)\s*[x×]\s*(\d+)/i);
      const zoom = metadataText.match(/(\d+(?:\.\d+)?)%/);
      if (!size || !zoom) throw new Error(`Could not resolve gradient display geometry: ${metadataText}`);
      const displayWidth = Number(size[1]) * Number(zoom[1]) / 100;
      const displayHeight = Number(size[2]) * Number(zoom[1]) / 100;
      const right = box.x + (box.width + displayWidth) / 2;
      const middle = box.y + box.height / 2;
      await window.mouse.move(right, middle);
      await window.mouse.down();
      await window.mouse.move(right - 150, middle + 90, { steps: 15 });
      await window.mouse.up();
      await window.waitForTimeout(250);
    }
    if (openGradientEditor) {
      await window.getByRole('button', { name: 'Edit fill gradient' }).click();
      await window.getByText('Fill gradient', { exact: true }).waitFor({ state: 'visible' });
    }
    await window.waitForTimeout(500);
  }

  if (selectLayer) {
    const layerRow = window.locator('.lighttable-layer').filter({
      has: window.locator(`.lighttable-layer__name[value="${selectLayer.replaceAll('"', '\\"')}"]`)
    });
    await layerRow.click();
    await window.getByRole('button', { name: /Path selection/i }).click();
    if (Number.isFinite(canvasClickX) && Number.isFinite(canvasClickY)) {
      const canvas = window.locator('.lighttable-viewport__canvas');
      await canvas.click({
        position: { x: canvasClickX, y: canvasClickY }
      });
      if (dragX !== 0 || dragY !== 0) {
        const box = await canvas.boundingBox();
        if (!box) throw new Error('The document canvas has no interactive bounds.');
        await window.mouse.move(box.x + canvasClickX, box.y + canvasClickY);
        await window.mouse.down();
        await window.mouse.move(
          box.x + canvasClickX + dragX,
          box.y + canvasClickY + dragY,
          { steps: 12 }
        );
        await window.mouse.up();
      }
    }
    const horizontalKey = nudgeX < 0 ? 'ArrowLeft' : 'ArrowRight';
    const verticalKey = nudgeY < 0 ? 'ArrowUp' : 'ArrowDown';
    for (let index = 0; index < Math.abs(nudgeX); index += 1) await window.keyboard.press(horizontalKey);
    for (let index = 0; index < Math.abs(nudgeY); index += 1) await window.keyboard.press(verticalKey);
    if (enableFill === 'true' || enableFill === 'false') {
      const checkbox = window.getByRole('checkbox', { name: 'Fill: enabled' });
      if (enableFill === 'true') await checkbox.check();
      else await checkbox.uncheck();
    }
    if (/^#[\da-f]{6}$/i.test(fillColor)) {
      await window.locator('input[type="color"][aria-label="Fill"]').fill(fillColor);
      await window.getByRole('checkbox', { name: 'Fill: enabled' }).waitFor({ state: 'visible' });
      if (!await window.getByRole('checkbox', { name: 'Fill: enabled' }).isChecked()) {
        throw new Error('Choosing a fill color did not enable shape fill.');
      }
    }
    if (/^#[\da-f]{6}$/i.test(strokeColor)) {
      await window.locator('input[type="color"][aria-label="Line"]').fill(strokeColor);
      await window.getByRole('checkbox', { name: 'Line: enabled' }).waitFor({ state: 'visible' });
      if (!await window.getByRole('checkbox', { name: 'Line: enabled' }).isChecked()) {
        throw new Error('Choosing a stroke color did not enable shape stroke.');
      }
    }
    if (Number.isFinite(strokeWidth)) {
      const input = window.getByRole('spinbutton', { name: 'Weight' });
      await input.fill(String(strokeWidth));
      await input.blur();
    }
    if (['inside', 'center', 'outside'].includes(strokeAlignment)) {
      await window.getByRole('combobox', { name: 'Stroke alignment' }).selectOption(strokeAlignment);
    }
    if (mergeDown) {
      const layerCount = await window.locator('.lighttable-layer').count();
      await window.keyboard.press('Control+e');
      await window.waitForFunction((expected) =>
        document.querySelectorAll('.lighttable-layer').length === expected,
      layerCount - 1, { timeout: 15_000 });
      const mergedRow = window.locator('.lighttable-layer').filter({
        has: window.locator(`.lighttable-layer__name[value="${selectLayer.replaceAll('"', '\\"')}"]`)
      });
      if (await mergedRow.locator('.lighttable-layer__thumbnail[title="Edit layer pixels"]').count() !== 1) {
        throw new Error('Merge Down did not replace the shape-over-raster pair with a raster layer.');
      }
    }
    await window.waitForTimeout(500);
  }

  if (openLayerEffects) {
    await window.getByRole('button', { name: 'Add layer style' }).click();
    const effectsTab = window.getByRole('tab', { name: 'Effects', exact: true });
    await effectsTab.waitFor({ state: 'visible', timeout: 15_000 });
    await window.waitForFunction(() => {
      const tab = [...document.querySelectorAll('[role="tab"]')]
        .find((candidate) => candidate.textContent?.trim() === 'Effects');
      return tab?.getAttribute('aria-selected') === 'true'
        || tab?.classList.contains('dv-active-tab');
    }, undefined, { timeout: 15_000 });
    await window.getByRole('region', { name: 'Layer Style' })
      .waitFor({ state: 'visible', timeout: 15_000 });
    diagnostics.layerEffectsPanel = await window.evaluate(() => {
      const tab = [...document.querySelectorAll('[role="tab"]')]
        .find((candidate) => candidate.textContent?.trim() === 'Effects');
      const region = document.querySelector('[role="region"][aria-label="Layer Style"]');
      const bounds = region?.getBoundingClientRect();
      return {
        tabClass: tab?.className ?? null,
        tabSelected: tab?.getAttribute('aria-selected') ?? null,
        regionDisplay: region ? getComputedStyle(region).display : null,
        regionVisibility: region ? getComputedStyle(region).visibility : null,
        regionBounds: bounds ? { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height } : null,
        regionText: region?.textContent?.slice(0, 120) ?? null
      };
    });
    await window.waitForTimeout(250);
  }

  if (openCompatibilityReport) {
    await window.getByRole('menuitem', { name: 'File', exact: true }).click();
    const option = window.getByRole('menuitem', {
      name: 'Document Compatibility Report...',
      exact: true
    });
    if (await option.isDisabled()) {
      throw new Error('The document compatibility report menu action is disabled.');
    }
    await option.click();
    await window.getByRole('dialog', {
      name: /(?:Document compatibility|Photoshop import) report/i
    }).waitFor({ state: 'visible', timeout: 15_000 });
  }

  if (editTextLayer) {
    const escapedLayerName = editTextLayer.replaceAll('"', '\\"');
    const row = window.locator('.lighttable-layer').filter({
      has: window.locator(`.lighttable-layer__name[value="${escapedLayerName}"]`)
    }).first();
    if (await row.count() === 0) throw new Error(`Text layer "${editTextLayer}" was not found.`);
    // Dispatch on the row itself. React's semantic edit gesture lives there;
    // targeting the thumbnail relied on synthetic bubbling that differs
    // between packaged Electron/Chromium revisions.
    await row.click();
    await row.dispatchEvent('dblclick');
    const dialog = window.getByRole('dialog', { name: 'Replace missing text font' });
    const editor = window.getByRole('textbox', { name: `Edit ${editTextLayer}` });
    await Promise.race([
      dialog.waitFor({ state: 'visible', timeout: 15_000 }),
      editor.waitFor({ state: 'attached', timeout: 15_000 })
    ]);
    if (await dialog.isVisible()) {
      const selector = dialog.getByRole('combobox', { name: 'Replacement font' });
      if (replacementFont) {
        const option = await selector.locator('option').evaluateAll((options, expected) =>
          options.find(({ textContent }) => textContent?.includes(expected))?.value ?? '',
        replacementFont);
        if (!option) throw new Error(`Replacement font "${replacementFont}" is unavailable.`);
        await selector.selectOption(option);
      }
      diagnostics.fontRecovery = {
        layerName: editTextLayer,
        selectedFont: await selector.locator('option:checked').textContent()
      };
      await dialog.getByRole('button', { name: 'Replace', exact: true }).click();
      await dialog.waitFor({ state: 'hidden', timeout: 15_000 });
    }
    await editor.waitFor({
      state: 'attached', timeout: 15_000
    });
    diagnostics.fontRecovery = {
      ...(diagnostics.fontRecovery ?? { layerName: editTextLayer, selectedFont: null }),
      editing: true
    };
  }

  if (openPdfPreflight) {
    await window.getByRole('menuitem', { name: 'File', exact: true }).click();
    await window.getByText('PDF Export Preflight...', { exact: true }).click();
    await window.getByRole('dialog', { name: 'PDF export preflight' }).waitFor({
      state: 'visible', timeout: 15_000
    });
    if (validatePdfFonts) {
      await window.getByRole('button', { name: 'Validate font resources' }).click();
      await window.getByRole('status').filter({ hasText: /font resources? ready/i }).waitFor({
        state: 'visible', timeout: 30_000
      });
    }
    if (exportFlattenedPdf) {
      await mkdir(path.dirname(exportedPdfFile), { recursive: true });
      await electronApp.evaluate(({ session }, savePath) => {
        session.defaultSession.once('will-download', (_event, item) => {
          item.setSavePath(savePath);
        });
      }, exportedPdfFile);
      await window.getByRole('button', { name: 'Export flattened PDF…' }).click();
      await window.getByRole('status').filter({ hasText: /Flattened PDF ready/i }).waitFor({
        state: 'visible', timeout: 30_000
      });
      const deadline = Date.now() + 30_000;
      let exported;
      while (!exported && Date.now() < deadline) {
        exported = await stat(exportedPdfFile).catch(() => undefined);
        if (!exported) await new Promise((resolve) => setTimeout(resolve, 100));
      }
      if (!exported) throw new Error('The flattened PDF download was not written by Electron.');
      diagnostics.exportedPdf = {
        kind: 'flattened',
        path: exportedPdfFile,
        byteLength: exported.size
      };
    }
  if (exportNativePdf) {
      await mkdir(path.dirname(exportedPdfFile), { recursive: true });
      await electronApp.evaluate(({ session }, savePath) => {
        session.defaultSession.once('will-download', (_event, item) => {
          item.setSavePath(savePath);
        });
      }, exportedPdfFile);
      await window.getByRole('button', { name: /Export native text PDF/i }).click();
      await window.getByRole('status').filter({ hasText: /Native PDF ready/i }).waitFor({
        state: 'visible', timeout: 60_000
      });
      const deadline = Date.now() + 30_000;
      let exported;
      while (!exported && Date.now() < deadline) {
        exported = await stat(exportedPdfFile).catch(() => undefined);
        if (!exported) await new Promise((resolve) => setTimeout(resolve, 100));
      }
      if (!exported) throw new Error('The native PDF download was not written by Electron.');
      diagnostics.exportedPdf = {
        kind: 'native-text',
        path: exportedPdfFile,
        byteLength: exported.size
      };
    }
    await window.waitForTimeout(250);
  }
  if (exportNativeVectorPdf) {
    await mkdir(path.dirname(exportedPdfFile), { recursive: true });
    await electronApp.evaluate(({ session }, savePath) => {
      session.defaultSession.once('will-download', (_event, item) => {
        item.setSavePath(savePath);
      });
    }, exportedPdfFile);
    await window.getByRole('button', { name: 'Export native vectors PDF...' }).click();
    await window.getByRole('status').filter({ hasText: /Native vector PDF ready/i }).waitFor({
      state: 'visible', timeout: 30_000
    });
    const deadline = Date.now() + 30_000;
    let exported;
    while (!exported && Date.now() < deadline) {
      exported = await stat(exportedPdfFile).catch(() => undefined);
      if (!exported) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!exported) throw new Error('The native vector PDF download was not written by Electron.');
    diagnostics.exportedPdf = {
      kind: 'native-vectors', path: exportedPdfFile, byteLength: exported.size
    };
  }
  if (exportNativeMixedPdf) {
    await mkdir(path.dirname(exportedPdfFile), { recursive: true });
    await electronApp.evaluate(({ session }, savePath) => {
      session.defaultSession.once('will-download', (_event, item) => {
        item.setSavePath(savePath);
      });
    }, exportedPdfFile);
    await window.getByRole('button', { name: 'Export native text + vectors PDF...' }).click();
    await window.getByRole('status').filter({ hasText: /Native mixed PDF ready/i }).waitFor({
      state: 'visible', timeout: 60_000
    });
    const deadline = Date.now() + 30_000;
    let exported;
    while (!exported && Date.now() < deadline) {
      exported = await stat(exportedPdfFile).catch(() => undefined);
      if (!exported) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!exported) throw new Error('The native mixed PDF download was not written by Electron.');
    diagnostics.exportedPdf = {
      kind: 'native-mixed', path: exportedPdfFile, byteLength: exported.size
    };
  }

  if (waitAfterMs > 0) await window.waitForTimeout(waitAfterMs);
  diagnostics.longTasks = await window.evaluate(() => globalThis.__lightTableLongTasks ?? []);
  diagnostics.layers = await window.locator('.lighttable-layer').evaluateAll((rows) => rows.map((row) => ({
    name: row.querySelector('.lighttable-layer__name')?.value ?? '',
    type: row.querySelector('.lighttable-layer__thumbnail')?.getAttribute('title') ?? '',
    statuses: [...row.querySelectorAll('.lighttable-layer__text-status')]
      .map((status) => status.textContent?.trim() ?? '')
      .filter(Boolean)
  })));
  diagnostics.status = await window.locator('.lighttable-toolbar__status').textContent() ?? '';
  diagnostics.metadata = await window.locator('.lighttable-toolbar__meta').textContent() ?? '';
  diagnostics.metadataTitle = await window.locator('.lighttable-toolbar__meta').getAttribute('title') ?? '';
  diagnostics.runtime = await window.evaluate(() => ({
    crossOriginIsolated: globalThis.crossOriginIsolated === true,
    webGpuAvailable: Boolean(navigator.gpu),
    canvasCount: document.querySelectorAll('canvas').length,
    documentTitle: document.querySelector('.lighttable-document-tab--active')?.textContent?.trim() ?? ''
  }));
  const debugTab = window.getByRole('tab', { name: 'Debug' });
  if (!openPdfPreflight && !openCompatibilityReport && !openGradientEditor && await debugTab.count()) {
    await debugTab.click();
    diagnostics.debugPanel = await window.getByRole('region', { name: 'LightTable debug log' })
      .textContent() ?? '';
    const textTab = window.getByRole('tab', { name: 'Text', exact: true });
    if (await textTab.count()) await textTab.click();
  }

  const flowLayers = diagnostics.layers.filter(({ statuses }) => statuses.includes('Flow'));
  const vectorLayers = diagnostics.layers.filter(({ type }) => type === 'Vector layer');
  const incompatible = diagnostics.layers.filter(({ statuses }) => statuses.some((status) =>
    /substituted|unavailable|raster/i.test(status)
  ));
  if (Number.isFinite(expectedFlowLayers) && flowLayers.length !== expectedFlowLayers) {
    throw new Error(
      `Expected ${expectedFlowLayers} editable flow-text layers, found ${flowLayers.length}.`
    );
  }
  if (Number.isFinite(expectedVectorLayers) && vectorLayers.length !== expectedVectorLayers) {
    throw new Error(
      `Expected ${expectedVectorLayers} editable vector layers, found ${vectorLayers.length}.`
    );
  }
  if (!allowSubstitutedText && incompatible.length > 0) {
    throw new Error(`Imported text is not exact: ${JSON.stringify(incompatible)}.`);
  }
  if (!allowSubstitutedText
      && expectedFlowLayers > 0
      && /text-renderer is unavailable/i.test(diagnostics.status)) {
    throw new Error(diagnostics.status);
  }
  if (expectLayer && !diagnostics.layers.some(({ name }) => name === expectLayer)) {
    throw new Error(`Expected layer "${expectLayer}" was not found.`);
  }
  if (expectNonemptyLayer) {
    const escapedLayerName = expectNonemptyLayer.replaceAll('"', '\\"');
    const row = window.locator('.lighttable-layer').filter({
      has: window.locator(`.lighttable-layer__name[value="${escapedLayerName}"]`)
    });
    const source = await row.locator('.lighttable-layer__thumbnail-preview').getAttribute('src');
    if (!source) throw new Error(`Layer "${expectNonemptyLayer}" has no pixel thumbnail.`);
    const hasVisiblePixels = await window.evaluate(async (url) => {
      const bitmap = await createImageBitmap(await (await fetch(url)).blob());
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext('2d');
      if (!context) return false;
      context.drawImage(bitmap, 0, 0);
      const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
      bitmap.close();
      for (let index = 3; index < pixels.length; index += 4) {
        if (pixels[index] > 0) return true;
      }
      return false;
    }, source);
    diagnostics.nonemptyLayer = { name: expectNonemptyLayer, hasVisiblePixels };
    if (!hasVisiblePixels) {
      throw new Error(`Layer "${expectNonemptyLayer}" contains no visible pixels.`);
    }
  }
  if (diagnostics.pageErrors.length > 0) {
    throw new Error(`Desktop screenshot reported page errors: ${diagnostics.pageErrors.join('\n')}`);
  }
  if (paintStroke) {
    const gpuDiagnostics = diagnostics.console
      .map(({ text }) => text)
      .filter((text) => /invalid (bindgroup|commandbuffer)|binding size|webgpu runtime error/i.test(text));
    if (/webgpu runtime error/i.test(diagnostics.status) || gpuDiagnostics.length > 0) {
      throw new Error(`Paint smoke reported WebGPU validation errors:\n${gpuDiagnostics.join('\n')}`);
    }
  }
  if (saveLightTableFile) {
    await window.screenshot({ path: outputFile });
    screenshotCaptured = true;
    if (editTextLayer) await window.keyboard.press('Escape');
    // The registered save command is explicitly allowed while/after text
    // editing and owns transaction finalization. Exercise that canonical path
    // for every document instead of coupling automation to menu markup.
    await window.keyboard.press('Control+s');
    const deadline = Date.now() + 120_000;
    let saved;
    while (!saved && Date.now() < deadline) {
      saved = await stat(saveLightTableFile).catch(() => undefined);
      if (!saved) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!saved) throw new Error('The native LightTable save was not written by Electron.');
    diagnostics.savedLightTable = { path: saveLightTableFile, byteLength: saved.size };
  }
} catch (error) {
  failure = error;
  diagnostics.failure = error instanceof Error ? (error.stack ?? error.message) : String(error);
} finally {
  if (!screenshotCaptured && window && !window.isClosed()) {
    await window.screenshot({ path: outputFile }).catch((error) => {
      diagnostics.screenshotError = String(error);
    });
  }
  await writeFile(reportFile, `${JSON.stringify(diagnostics, null, 2)}\n`);
  await electronApp?.close().catch(() => {});
}

if (failure) throw failure;
console.info(`LightTable screenshot: ${outputFile}`);
console.info(`LightTable diagnostics: ${reportFile}`);
