import { _electron as electron } from 'playwright-core';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

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
  await page.getByRole('button', { name: 'Open file' }).click();
  const status = page.locator('.lighttable-toolbar__meta').filter({ hasText: /ready/i });
  await status.waitFor({ state: 'visible', timeout: 60_000 });
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
  await page.mouse.click(center.x, center.y);
  await waitForZoomChange(temporaryInBefore, 1);
  await page.keyboard.up('Space');
  await page.keyboard.up('Control');

  const temporaryOutBefore = await zoomPercent();
  await page.keyboard.down('Alt');
  await page.keyboard.down('Space');
  await viewport.evaluate((node) => {
    if (!node.classList.contains('lighttable-viewport--zoom-out')) {
      throw new Error('Alt+Space did not activate temporary Zoom Out.');
    }
  });
  await page.mouse.click(center.x, center.y);
  await waitForZoomChange(temporaryOutBefore, -1);
  await page.keyboard.up('Space');
  await page.keyboard.up('Alt');

  if (pageErrors.length) throw new Error(`Page errors: ${JSON.stringify(pageErrors)}`);
  await writeFile(reportPath, `${JSON.stringify({
    sourceFile, actual, fit, shortcutIn, rectangleBefore, rectangleAfter,
    temporaryInAfter: temporaryOutBefore,
    temporaryOutAfter: await zoomPercent(),
    pageErrors, screenshotPath
  }, null, 2)}\n`);
  process.stdout.write(`Zoom UX smoke passed. Report: ${reportPath}\n`);
} finally {
  await app.close().catch(() => {});
}
