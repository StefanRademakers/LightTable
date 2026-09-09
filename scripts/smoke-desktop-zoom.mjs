import { _electron as electron } from 'playwright-core';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';

const workspaceRoot = path.resolve(import.meta.dirname, '..');
const sourceFile = path.resolve(process.argv[2] ?? 'D:\\shapes.psd');
const executablePath = path.join(workspaceRoot, 'node_modules', 'electron', 'dist', 'electron.exe');
const outputDirectory = path.join(workspaceRoot, 'tmp', 'zoom-smoke');
const userDataPath = path.join(outputDirectory, `user-data-${process.pid}`);
const screenshotPath = path.join(outputDirectory, 'zoom-rectangle.png');
const reportPath = path.join(outputDirectory, 'zoom.json');

await Promise.all([access(sourceFile), access(executablePath), mkdir(userDataPath, { recursive: true })]);
const launchEnvironment = { ...process.env };
delete launchEnvironment.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath,
  args: [path.join(workspaceRoot, 'apps', 'desktop')],
  cwd: workspaceRoot,
  env: {
    ...launchEnvironment,
    LIGHTTABLE_AUTOMATION_OPEN_FILE: sourceFile,
    LIGHTTABLE_AUTOMATION_USER_DATA: userDataPath
  },
  timeout: 30_000
});

try {
  const page = await app.firstWindow({ timeout: 30_000 });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
  await page.waitForLoadState('domcontentloaded');
  const sourceTab = page.getByRole('tab', { name: new RegExp(path.basename(sourceFile), 'i') });
  await page.waitForTimeout(1_500);
  if (!await sourceTab.isVisible().catch(() => false)) {
    await page.getByRole('button', { name: 'Open', exact: true }).click();
  }
  await sourceTab.waitFor({ timeout: 30_000 });
  const status = page.locator('.lighttable-toolbar__meta').filter({ hasText: /ready/i });
  await status.waitFor({ state: 'visible', timeout: 60_000 });
  const driver = await attachLightTableAutomation(page, 'viewport-pan-zoom-smoke');
  const documentId = (await driver.queryWorkspace())?.activeDocumentId;
  if (!documentId) throw new Error('No active image document was exposed to automation.');
  const viewport = page.locator('.lighttable-viewport');
  const bounds = await viewport.boundingBox();
  if (!bounds) throw new Error('Viewport bounds are unavailable.');
  const zoomPercent = async () => {
    const text = await status.textContent() ?? '';
    const match = text.match(/(\d+(?:\.\d+)?)%/);
    if (!match) throw new Error(`Zoom percentage is unavailable: ${text}`);
    return Number(match[1]);
  };
  const waitForZoomChange = async (before, direction) => page.waitForFunction(
    ({ before, direction }) => {
      const text = [...document.querySelectorAll('.lighttable-toolbar__meta')]
        .map((node) => node.textContent ?? '').find((value) => /ready/i.test(value)) ?? '';
      const value = Number(text.match(/(\d+(?:\.\d+)?)%/)?.[1] ?? before);
      return direction > 0 ? value > before : value < before;
    },
    { before, direction },
    { timeout: 5_000 }
  );

  await page.keyboard.press('b');
  const middlePanBefore = await driver.queryDocument(documentId);
  await page.keyboard.down('Control');
  await page.keyboard.down('Alt');
  await page.keyboard.down('Shift');
  await page.mouse.move(bounds.x + bounds.width * 0.66, bounds.y + bounds.height * 0.62);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(bounds.x + bounds.width * 0.66 + 54, bounds.y + bounds.height * 0.62 + 31, { steps: 5 });
  await page.mouse.up({ button: 'middle' });
  await page.keyboard.up('Shift');
  await page.keyboard.up('Alt');
  await page.keyboard.up('Control');
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const middlePanAfter = await driver.queryDocument(documentId);
  if (!middlePanBefore || !middlePanAfter
    || middlePanAfter.viewport.panX === middlePanBefore.viewport.panX
    || middlePanAfter.viewport.panY === middlePanBefore.viewport.panY
    || middlePanAfter.viewport.zoomMode !== 'custom'
    || middlePanAfter.history.undoDepth !== middlePanBefore.history.undoDepth) {
    throw new Error(`Middle-button pan violated viewport ownership: ${JSON.stringify({
      before: middlePanBefore?.viewport,
      after: middlePanAfter?.viewport,
      historyBefore: middlePanBefore?.history.undoDepth,
      historyAfter: middlePanAfter?.history.undoDepth
    })}`);
  }

  await page.keyboard.press('z');
  await viewport.evaluate((node) => {
    if (!node.classList.contains('lighttable-viewport--zoom')) throw new Error('Z did not activate Zoom.');
  });

  await page.keyboard.press('Control+1');
  await page.waitForFunction(() => [...document.querySelectorAll('.lighttable-toolbar__meta')]
    .some((node) => node.textContent?.includes('100%')), undefined, { timeout: 5_000 });
  const actual = await zoomPercent();
  await page.keyboard.press('Control+0');
  const fit = await zoomPercent();

  await page.keyboard.down('Control');
  await page.keyboard.press('Equal');
  await page.keyboard.up('Control');
  await waitForZoomChange(fit, 1);
  const shortcutIn = await zoomPercent();
  await page.keyboard.press('Control+-');
  await waitForZoomChange(shortcutIn, -1);

  await page.keyboard.press('Control+0');
  const rectangleBefore = await zoomPercent();
  // Keep the gesture clear of the floating Layers panel, which is intentionally
  // rendered above the document and must win hit testing over viewport tools.
  const center = { x: bounds.x + bounds.width * 0.78, y: bounds.y + bounds.height * 0.34 };
  const visibleDocumentPoint = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  await page.mouse.move(center.x - 70, center.y - 45);
  await page.mouse.down();
  await page.mouse.move(center.x + 70, center.y + 45, { steps: 5 });
  await page.screenshot({ path: screenshotPath });
  await page.mouse.up();
  await waitForZoomChange(rectangleBefore, 1);
  const rectangleAfter = await zoomPercent();

  await page.keyboard.press('b');
  await page.keyboard.down('Control');
  await page.keyboard.down('Space');
  await viewport.evaluate((node) => {
    if (!node.classList.contains('lighttable-viewport--zoom')) throw new Error('Ctrl+Space did not activate temporary Zoom.');
  });
  const temporaryInBefore = await zoomPercent();
  await page.mouse.click(visibleDocumentPoint.x, visibleDocumentPoint.y);
  await waitForZoomChange(temporaryInBefore, 1);
  await page.keyboard.up('Space');
  await page.keyboard.up('Control');
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

  const temporaryOutBefore = await zoomPercent();
  await page.keyboard.down('Alt');
  await page.keyboard.down('Space');
  await viewport.evaluate((node) => {
    if (!node.classList.contains('lighttable-viewport--zoom-out')) {
      throw new Error('Alt+Space did not activate temporary Zoom Out.');
    }
  });
  const temporaryOutStateBefore = await driver.queryDocument(documentId);
  await page.mouse.click(visibleDocumentPoint.x, visibleDocumentPoint.y);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const temporaryOutStateAfter = await driver.queryDocument(documentId);
  if (!temporaryOutStateBefore || !temporaryOutStateAfter
    || temporaryOutStateAfter.viewport.scale >= temporaryOutStateBefore.viewport.scale) {
    throw new Error(`Temporary Zoom Out did not decrease document scale: ${JSON.stringify({
      before: temporaryOutStateBefore?.viewport,
      after: temporaryOutStateAfter?.viewport,
      statusBefore: temporaryOutBefore,
      statusAfter: await zoomPercent()
    })}`);
  }
  await page.keyboard.up('Space');
  await page.keyboard.up('Alt');

  // A retained gesture belongs to the document where pointer-down happened.
  // Switching tabs before move/up must not reinterpret that gesture as input
  // for the newly active document.
  await page.keyboard.press('Control+N');
  const newDocumentDialog = page.getByRole('dialog', { name: 'New document' });
  await newDocumentDialog.getByRole('button', { name: 'Create', exact: true }).click();
  await newDocumentDialog.waitFor({ state: 'hidden' });
  let secondDocumentId = null;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate = (await driver.queryWorkspace())?.activeDocumentId ?? null;
    if (candidate && candidate !== documentId) {
      secondDocumentId = candidate;
      break;
    }
    await page.waitForTimeout(100);
  }
  if (!secondDocumentId || secondDocumentId === documentId) {
    throw new Error('A second document was not created for the gesture ownership smoke.');
  }
  await sourceTab.click();
  const panSwitchSourceBefore = await driver.queryDocument(documentId);
  const panSwitchTargetBefore = await driver.queryDocument(secondDocumentId);
  await page.mouse.move(bounds.x + bounds.width * 0.45, bounds.y + bounds.height * 0.45);
  await page.mouse.down({ button: 'middle' });
  await page.keyboard.press('Control+Tab');
  await page.mouse.move(bounds.x + bounds.width * 0.45 + 80, bounds.y + bounds.height * 0.45 + 50);
  await page.mouse.up({ button: 'middle' });
  const panSwitchSourceAfter = await driver.queryDocument(documentId);
  const panSwitchTargetAfter = await driver.queryDocument(secondDocumentId);
  if (!panSwitchSourceBefore || !panSwitchTargetBefore || !panSwitchSourceAfter || !panSwitchTargetAfter
    || JSON.stringify(panSwitchSourceAfter.viewport) !== JSON.stringify(panSwitchSourceBefore.viewport)
    || JSON.stringify(panSwitchTargetAfter.viewport) !== JSON.stringify(panSwitchTargetBefore.viewport)) {
    throw new Error('A middle-pan gesture crossed the document boundary.');
  }

  await sourceTab.click();
  await page.keyboard.press('b');
  const zoomSwitchSourceBefore = await driver.queryDocument(documentId);
  const zoomSwitchTargetBefore = await driver.queryDocument(secondDocumentId);
  await page.keyboard.down('Control');
  await page.keyboard.down('Space');
  await page.mouse.move(bounds.x + bounds.width * 0.5, bounds.y + bounds.height * 0.5);
  await page.mouse.down();
  await page.keyboard.up('Space');
  await page.keyboard.up('Control');
  await page.keyboard.press('Control+Tab');
  await page.mouse.move(bounds.x + bounds.width * 0.5 + 40, bounds.y + bounds.height * 0.5 + 30);
  await page.mouse.up();
  const zoomSwitchSourceAfter = await driver.queryDocument(documentId);
  const zoomSwitchTargetAfter = await driver.queryDocument(secondDocumentId);
  if (!zoomSwitchSourceBefore || !zoomSwitchTargetBefore || !zoomSwitchSourceAfter || !zoomSwitchTargetAfter
    || JSON.stringify(zoomSwitchSourceAfter.viewport) !== JSON.stringify(zoomSwitchSourceBefore.viewport)
    || JSON.stringify(zoomSwitchTargetAfter.viewport) !== JSON.stringify(zoomSwitchTargetBefore.viewport)) {
    throw new Error('A zoom gesture crossed the document boundary.');
  }

  if (pageErrors.length) throw new Error(`Page errors: ${JSON.stringify(pageErrors)}`);
  await writeFile(reportPath, `${JSON.stringify({
    sourceFile, actual, fit, shortcutIn, rectangleBefore, rectangleAfter,
    middlePan: { before: middlePanBefore.viewport, after: middlePanAfter.viewport },
    temporaryInAfter: temporaryOutBefore,
    temporaryOutAfter: await zoomPercent(),
    pageErrors, screenshotPath
  }, null, 2)}\n`);
  process.stdout.write(`Zoom UX smoke passed. Report: ${reportPath}\n`);
} finally {
  await app.close().catch(() => {});
}
