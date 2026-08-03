import { _electron as electron } from 'playwright-core';
import { access, mkdir, writeFile } from 'node:fs/promises';
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
const selectLayer = argument('select-layer', '');
const canvasClickX = Number.parseFloat(argument('canvas-click-x', 'NaN'));
const canvasClickY = Number.parseFloat(argument('canvas-click-y', 'NaN'));
const nudgeX = Number.parseInt(argument('nudge-x', '0'), 10);
const nudgeY = Number.parseInt(argument('nudge-y', '0'), 10);
const dragX = Number.parseFloat(argument('drag-x', '0'));
const dragY = Number.parseFloat(argument('drag-y', '0'));
const enableFill = argument('enable-fill', '');
const fillColor = argument('fill-color', '');
const strokeColor = argument('stroke-color', '');
const strokeWidth = Number.parseFloat(argument('stroke-width', 'NaN'));
const strokeAlignment = argument('stroke-alignment', '');
const mergeDown = argument('merge-down', '') === 'true';
const openPdfPreflight = argument('pdf-preflight', '') === 'true';
const validatePdfFonts = argument('pdf-validate-fonts', '') === 'true';
const outputFile = path.resolve(argument(
  'output',
  path.join(workspaceRoot, 'tmp', 'screenshots', 'desktop-text-test.png')
));
const executablePath = path.resolve(argument('executable', defaultExecutable));
const reportFile = outputFile.replace(/\.[^.]+$/, '.json');
const userDataPath = path.join(workspaceRoot, 'tmp', 'playwright-user-data');

await Promise.all([access(sourceFile), access(executablePath)]).catch((error) => {
  throw new Error(
    `Screenshot prerequisites are missing. Build the desktop app and check the input path.\n${error}`
  );
});
await Promise.all([
  mkdir(path.dirname(outputFile), { recursive: true }),
  mkdir(userDataPath, { recursive: true })
]);

const diagnostics = {
  sourceFile,
  expectedFlowLayers,
  expectedVectorLayers,
  interaction: {
    selectLayer, canvasClickX, canvasClickY, nudgeX, nudgeY, dragX, dragY,
    enableFill, fillColor, strokeColor, strokeWidth, strokeAlignment, mergeDown,
    openPdfPreflight, validatePdfFonts
  },
  outputFile,
  executablePath,
  capturedAt: new Date().toISOString(),
  console: [],
  pageErrors: [],
  layers: [],
  status: '',
  debugPanel: '',
  runtime: null
};
const launchEnvironment = { ...process.env };
delete launchEnvironment.ELECTRON_RUN_AS_NODE;

let electronApp;
let window;
let failure;
try {
  electronApp = await electron.launch({
    executablePath,
    args: [desktopAppPath],
    cwd: workspaceRoot,
    env: {
      ...launchEnvironment,
      LIGHTTABLE_AUTOMATION_OPEN_FILE: sourceFile,
      LIGHTTABLE_AUTOMATION_USER_DATA: userDataPath
    },
    timeout: 30_000
  });
  window = await electronApp.firstWindow({ timeout: 30_000 });
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
    .waitFor({ state: 'visible', timeout: 30_000 });

  await window.waitForFunction(() => {
    const status = document.querySelector('.lighttable-toolbar__status')?.textContent ?? '';
    return !status.includes('Preparing the text engine');
  }, undefined, { timeout: 15_000 }).catch(() => {});
  await window.waitForTimeout(750);

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

  if (openPdfPreflight) {
    await window.getByRole('button', { name: 'File', exact: true }).click();
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
    await window.waitForTimeout(250);
  }

  diagnostics.layers = await window.locator('.lighttable-layer').evaluateAll((rows) => rows.map((row) => ({
    name: row.querySelector('.lighttable-layer__name')?.value ?? '',
    type: row.querySelector('.lighttable-layer__thumbnail')?.getAttribute('title') ?? '',
    statuses: [...row.querySelectorAll('.lighttable-layer__text-status')]
      .map((status) => status.textContent?.trim() ?? '')
      .filter(Boolean)
  })));
  diagnostics.status = await window.locator('.lighttable-toolbar__status').textContent() ?? '';
  diagnostics.runtime = await window.evaluate(() => ({
    crossOriginIsolated: globalThis.crossOriginIsolated === true,
    webGpuAvailable: Boolean(navigator.gpu),
    canvasCount: document.querySelectorAll('canvas').length,
    documentTitle: document.querySelector('.lighttable-document-tab--active')?.textContent?.trim() ?? ''
  }));
  const debugTab = window.getByRole('tab', { name: 'Debug' });
  if (!openPdfPreflight && await debugTab.count()) {
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
  if (flowLayers.length !== expectedFlowLayers) {
    throw new Error(
      `Expected ${expectedFlowLayers} editable flow-text layers, found ${flowLayers.length}.`
    );
  }
  if (vectorLayers.length !== expectedVectorLayers) {
    throw new Error(
      `Expected ${expectedVectorLayers} editable vector layers, found ${vectorLayers.length}.`
    );
  }
  if (incompatible.length > 0) {
    throw new Error(`Imported text is not exact: ${JSON.stringify(incompatible)}.`);
  }
  if (expectedFlowLayers > 0 && /text-renderer is unavailable/i.test(diagnostics.status)) {
    throw new Error(diagnostics.status);
  }
  if (diagnostics.pageErrors.length > 0) {
    throw new Error(`Desktop screenshot reported page errors: ${diagnostics.pageErrors.join('\n')}`);
  }
} catch (error) {
  failure = error;
  diagnostics.failure = error instanceof Error ? (error.stack ?? error.message) : String(error);
} finally {
  if (window && !window.isClosed()) {
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
