import { _electron as electron } from 'playwright-core';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';
import { writePsdUint8Array } from 'ag-psd';

const workspaceRoot = path.resolve(import.meta.dirname, '..');
const executablePath = path.join(workspaceRoot, 'node_modules', 'electron', 'dist', 'electron.exe');
const outputDirectory = path.join(workspaceRoot, 'tmp', 'missing-font-recovery-smoke');
const sourceFile = path.resolve(process.argv[2] ?? path.join(outputDirectory, 'missing-font.psd'));
const userDataPath = path.join(outputDirectory, `user-data-${process.pid}`);
const reportPath = path.join(outputDirectory, 'missing-font-recovery.json');
const screenshotPath = path.join(outputDirectory, 'missing-font-recovery.png');

await Promise.all([access(executablePath), mkdir(userDataPath, { recursive: true })]);
if (!process.argv[2]) {
  const imageData = (width, height, rgba) => {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let offset = 0; offset < data.length; offset += 4) data.set(rgba, offset);
    return { width, height, data };
  };
  const psd = writePsdUint8Array({
    width: 400, height: 240, imageData: imageData(400, 240, [255, 255, 255, 255]),
    children: [{
      name: 'Missing font text', imageData: imageData(300, 80, [0, 0, 0, 0]),
      left: 40, top: 80,
      text: {
        text: 'Replace me', transform: [1, 0, 0, 1, 40, 120], shapeType: 'point',
        pointBase: [0, 0],
        style: {
          font: { name: 'LightTableDefinitelyMissing-Regular' }, fontSize: 48,
          fillColor: { r: 0, g: 0, b: 0, a: 255 }, fillFlag: true
        }
      }
    }]
  }, { noBackground: true, invalidateTextLayers: false });
  await writeFile(sourceFile, psd);
} else {
  await access(sourceFile);
}
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath, args: [path.join(workspaceRoot, 'apps', 'desktop')], cwd: workspaceRoot,
  env: { ...environment, LIGHTTABLE_AUTOMATION_OPEN_FILE: sourceFile,
    LIGHTTABLE_AUTOMATION_USER_DATA: userDataPath }, timeout: 30_000
});

try {
  const page = await app.firstWindow({ timeout: 30_000 });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
  await page.getByRole('button', { name: 'Open file' }).click();
  await page.locator('.lighttable-toolbar__meta').filter({ hasText: /ready/i })
    .waitFor({ state: 'visible', timeout: 90_000 });
  const driver = await attachLightTableAutomation(page, 'missing-font-recovery-smoke');
  const documentId = (await driver.queryWorkspace())?.activeDocumentId;
  if (!documentId) throw new Error('No active document.');
  const before = await driver.queryDocument(documentId);
  const recoveryOpenSamples = [];
  const openRecovery = async () => {
    const report = page.getByRole('dialog', { name: 'Document compatibility report' });
    if (!await report.isVisible().catch(() => false)) {
      await page.getByRole('menuitem', { name: 'File', exact: true }).click();
      await page.getByText('Document Compatibility Report...', { exact: true }).click();
    }
    await report.waitFor({ state: 'visible' });
    const missingEntry = report.locator('.lighttable-psd-report__entry')
      .filter({ hasText: 'text-font' }).first();
    if (!await missingEntry.count()) {
      throw new Error(`The fixture exposes no editable missing-font entry: ${(await report.innerText()).slice(0, 2_000)}`);
    }
    const startedAt = performance.now();
    await missingEntry.getByRole('button', { name: 'Choose font...' }).click();
    const recovery = page.getByRole('dialog', { name: 'Replace missing text font' });
    await recovery.waitFor({ state: 'visible' });
    recoveryOpenSamples.push(performance.now() - startedAt);
    return recovery;
  };
  const chooseBundledFace = async (recovery) => {
    await recovery.getByRole('button', { name: 'Replacement font' }).click();
    const search = page.getByRole('searchbox', { name: 'Search fonts' });
    await search.fill('Source Serif 4');
    const option = page.getByRole('option', { name: /Source Serif 4.*Regular/i }).first();
    await option.click();
  };

  let recovery = await openRecovery();
  await chooseBundledFace(recovery);
  await page.waitForTimeout(250);
  const preview = await driver.queryDocument(documentId);
  await recovery.getByRole('button', { name: 'Cancel' }).click();
  const cancelled = await driver.queryDocument(documentId);
  if (!before || !preview || !cancelled
    || preview.history.undoDepth !== before.history.undoDepth
    || cancelled.history.undoDepth !== before.history.undoDepth) {
    throw new Error(`Font preview/Cancel changed history: ${JSON.stringify({ before, preview, cancelled })}`);
  }

  recovery = await openRecovery();
  await chooseBundledFace(recovery);
  await recovery.getByRole('button', { name: 'Replace', exact: true }).click();
  await page.waitForTimeout(500);
  const replaced = await driver.queryDocument(documentId);
  if (!replaced || replaced.history.undoDepth !== before.history.undoDepth + 1) {
    throw new Error(`Font replacement was not one history step: ${JSON.stringify({ before, replaced })}`);
  }
  await page.keyboard.press('Control+Enter');
  await page.keyboard.press('Control+z');
  const undone = await driver.queryDocument(documentId);
  await page.keyboard.press('Control+Shift+z');
  const redone = await driver.queryDocument(documentId);
  if (!undone || !redone || undone.history.redoDepth < 1
    || redone.history.undoDepth !== replaced.history.undoDepth) {
    throw new Error(`Font replacement undo/redo failed: ${JSON.stringify({ undone, redone })}`);
  }

  await page.getByRole('tab', { name: 'Debug', exact: true }).click();
  const debugText = await page.getByRole('region', { name: 'LightTable debug log' }).textContent() ?? '';
  const fontRuntime = debugText.match(/(\d+) font faces?\s*·\s*([\d.]+) (KiB|MiB) loaded/i);
  const shaping = debugText.match(/Text work:.*?\((\d+(?:\.\d+)?) ms latest\)/i);
  await page.screenshot({ path: screenshotPath });
  if (pageErrors.length) throw new Error(`Renderer errors: ${pageErrors.join('\n')}`);
  await writeFile(reportPath, `${JSON.stringify({
    sourceFile, before, preview, cancelled, replaced, undone, redone,
    metrics: {
      firstEditRecoveryMs: recoveryOpenSamples[0] ?? 0,
      configuredFaces: Number(fontRuntime?.[1] ?? 0),
      loadedFontBytes: Number(fontRuntime?.[2] ?? 0) * (fontRuntime?.[3] === 'MiB' ? 1024 * 1024 : 1024),
      latestShapingMs: Number(shaping?.[1] ?? 0)
    },
    pageErrors, screenshotPath
  }, null, 2)}\n`);
  console.log(`Missing-font recovery smoke passed. Report: ${reportPath}`);
} finally {
  await app.close().catch(() => undefined);
}
