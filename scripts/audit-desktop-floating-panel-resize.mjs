import { _electron as electron } from 'playwright-core';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { resolveDesktopTestLaunch, waitForDesktopLauncher } from './desktop-test-startup.mjs';

const workspaceRoot = path.resolve(import.meta.dirname, '..');
const sourceFile = path.resolve(process.argv[2] ?? 'D:/shapes.psd');
const outputDirectory = path.join(workspaceRoot, 'tmp', 'quality-audit', 'floating-panel-resize');
const userDataPath = path.join(outputDirectory, `user-data-${process.pid}`);
const reportPath = path.join(outputDirectory, 'report.json');

await Promise.all([access(sourceFile), mkdir(userDataPath, { recursive: true })]);
const launch = await resolveDesktopTestLaunch(workspaceRoot);
const launchEnvironment = { ...process.env };
delete launchEnvironment.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath: launch.executablePath,
  args: launch.args,
  cwd: workspaceRoot,
  env: {
    ...launchEnvironment,
    LIGHTTABLE_AUTOMATION_OPEN_FILE: sourceFile,
    LIGHTTABLE_AUTOMATION_USER_DATA: userDataPath
  },
  timeout: 30_000
});

const report = { sourceFile, measurements: [], pageErrors: [], consoleErrors: [] };

try {
  const page = await app.firstWindow({ timeout: 30_000 });
  page.on('pageerror', (error) => report.pageErrors.push(error.stack ?? error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') report.consoleErrors.push(message.text());
  });
  await page.evaluate(() => localStorage.removeItem('lighttable:workspace-layout'));
  await page.reload();
  const openFileButton = await waitForDesktopLauncher({
    app, page, outputDirectory, sourceFile, pageErrors: report.pageErrors, label: 'floating-panel-resize'
  });
  await openFileButton.click();
  await page.locator('.lighttable-toolbar__meta').filter({ hasText: /ready/i })
    .waitFor({ state: 'visible', timeout: 60_000 });

  const frame = page.locator('.dv-resize-container').first();
  await frame.waitFor({ state: 'visible' });
  const settle = () => page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
  const bounds = async () => {
    const value = await frame.evaluate((element) => {
      const frameBox = element.getBoundingClientRect();
      const gridBox = element.querySelector(':scope > .dv-grid-view')?.getBoundingClientRect();
      return {
        left: frameBox.left,
        top: frameBox.top,
        right: frameBox.right,
        bottom: frameBox.bottom,
        width: frameBox.width,
        height: frameBox.height,
        gridWidth: gridBox?.width ?? null,
        gridHeight: gridBox?.height ?? null
      };
    });
    report.measurements.push(value);
    return value;
  };
  const dragHandle = async (className, deltaX, deltaY) => {
    const handle = frame.locator(`.${className}`);
    const box = await handle.boundingBox();
    if (!box) throw new Error(`Floating resize handle ${className} is unavailable.`);
    const start = {
      x: className.includes('left') ? box.x + 2
        : className.includes('right') ? box.x + box.width - 2
          : box.x + box.width / 2,
      y: className.includes('top') ? box.y + 2
        : className.includes('bottom') ? box.y + box.height - 2
          : box.y + box.height / 2
    };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + deltaX, start.y + deltaY, { steps: 12 });
    await page.mouse.up();
    await settle();
  };
  const near = (a, b, tolerance = 1.1) => Math.abs(a - b) <= tolerance;

  const initial = await bounds();
  await dragHandle('dv-resize-handle-right', 400, 0);
  const expandedRight = await bounds();
  if (!near(initial.left, expandedRight.left) || expandedRight.width > 520.1) {
    throw new Error(`Right resize moved its fixed left edge: ${JSON.stringify({ initial, expandedRight })}`);
  }

  await dragHandle('dv-resize-handle-right', -140, 0);
  const contractedRight = await bounds();
  if (!near(expandedRight.left, contractedRight.left)) {
    throw new Error(`Right resize moved its fixed left edge while contracting: ${JSON.stringify({ expandedRight, contractedRight })}`);
  }

  await dragHandle('dv-resize-handle-left', -100, 0);
  const expandedLeft = await bounds();
  if (!near(contractedRight.right, expandedLeft.right) || expandedLeft.width <= contractedRight.width) {
    throw new Error(`Left resize moved its fixed right edge: ${JSON.stringify({ contractedRight, expandedLeft })}`);
  }

  await dragHandle('dv-resize-handle-bottom', 0, 80);
  const expandedBottom = await bounds();
  if (!near(expandedLeft.top, expandedBottom.top)) {
    throw new Error(`Bottom resize moved its fixed top edge: ${JSON.stringify({ expandedLeft, expandedBottom })}`);
  }

  await dragHandle('dv-resize-handle-top', 0, -40);
  const expandedTop = await bounds();
  if (!near(expandedBottom.bottom, expandedTop.bottom) || expandedTop.height <= expandedBottom.height) {
    throw new Error(`Top resize moved its fixed bottom edge: ${JSON.stringify({ expandedBottom, expandedTop })}`);
  }

  for (const measurement of report.measurements) {
    if (
      measurement.gridWidth === null || measurement.gridHeight === null
      || Math.abs(measurement.width - measurement.gridWidth) > 2.1
      || Math.abs(measurement.height - measurement.gridHeight) > 2.1
    ) {
      throw new Error(`Floating frame and content diverged: ${JSON.stringify(measurement)}`);
    }
  }

  await page.waitForTimeout(250);
  report.savedLayout = await page.evaluate(() => {
    const entry = Object.entries(localStorage).find(([key]) => key.includes('workspace'));
    return entry ? { key: entry[0], value: JSON.parse(entry[1]) } : null;
  });
  await page.screenshot({ path: path.join(outputDirectory, 'final.png') });
  if (report.pageErrors.length || report.consoleErrors.length) {
    throw new Error(`Runtime errors were reported: ${JSON.stringify(report)}`);
  }
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.error = error instanceof Error ? error.stack ?? error.message : String(error);
  throw error;
} finally {
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await app.close();
}

console.log(JSON.stringify({ reportPath, measurements: report.measurements }, null, 2));
