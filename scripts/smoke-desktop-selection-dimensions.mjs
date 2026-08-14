import { _electron as electron } from 'playwright-core';
import { access, mkdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const workspaceRoot = path.resolve(import.meta.dirname, '..');
const sourceFile = path.resolve(process.argv[2] ?? 'D:\\shapes.psd');
const executablePath = path.join(workspaceRoot, 'node_modules', 'electron', 'dist', 'electron.exe');
const outputDirectory = path.join(workspaceRoot, 'tmp', 'selection-dimensions-smoke');
const userDataPath = path.join(outputDirectory, `user-data-${process.pid}`);
const screenshotPath = path.join(outputDirectory, 'ellipse-dimensions.png');

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
  await page.locator('.lighttable-toolbar__meta').filter({ hasText: /ready/i })
    .waitFor({ state: 'visible', timeout: 60_000 });
  const viewport = page.locator('.lighttable-viewport');
  const bounds = await viewport.boundingBox();
  if (!bounds) throw new Error('Viewport bounds are unavailable.');

  await page.keyboard.press('Shift+m');
  await page.locator('.lighttable-tool-options__identity')
    .filter({ hasText: 'Elliptical selection' })
    .waitFor({ state: 'visible' });
  const marqueeSettings = page.locator('[aria-label="Marquee selection settings"]');
  await marqueeSettings.waitFor({ state: 'visible' });
  if (await page.getByText('Snap to pixels', { exact: true }).count()) {
    throw new Error('The always-on marquee pixel snap control is still visible.');
  }
  await marqueeSettings.locator('label').filter({ hasText: 'Feather' }).locator('input').fill('6');
  await page.getByLabel('Marquee selection style').selectOption('fixed');
  await marqueeSettings.locator('label').filter({ hasText: 'Width' }).locator('input').fill('40');
  await marqueeSettings.locator('label').filter({ hasText: 'Height' }).locator('input').fill('25');
  await page.mouse.move(bounds.x + bounds.width * 0.25, bounds.y + bounds.height * 0.25);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.55, bounds.y + bounds.height * 0.55, { steps: 5 });
  const ellipseMetrics = await page.locator('.lighttable-selection__dimensions').textContent() ?? '';
  for (const label of ['W:', 'H:', 'X:', 'Y:']) {
    if (!ellipseMetrics.includes(label)) throw new Error(`Ellipse dimensions omit ${label}`);
  }
  if (!ellipseMetrics.includes('W: 40') || !ellipseMetrics.includes('H: 25')) {
    throw new Error(`Fixed ellipse dimensions are incorrect: ${ellipseMetrics}`);
  }
  await page.screenshot({ path: screenshotPath });
  await page.mouse.up();

  if (pageErrors.length) throw new Error(`Page errors: ${JSON.stringify(pageErrors)}`);
  process.stdout.write(`Selection dimensions smoke passed. Screenshot: ${screenshotPath}\n`);
} finally {
  await app.close().catch(() => {});
}
