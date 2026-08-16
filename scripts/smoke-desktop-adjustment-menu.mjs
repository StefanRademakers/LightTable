import { _electron as electron } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { resolveDesktopTestLaunch, waitForDesktopLauncher } from './desktop-test-startup.mjs';

const workspace = path.resolve(import.meta.dirname, '..');
const output = path.join(workspace, 'tmp', 'adjustment-menu-smoke');
const reportPath = path.join(output, 'report.json');
const screenshotPath = path.join(output, 'adjustment-menu.png');
const levelsScreenshotPath = path.join(output, 'levels-properties.png');
const userData = path.join(output, `user-data-${process.pid}`);
const launch = await resolveDesktopTestLaunch(workspace);
await mkdir(userData, { recursive: true });

const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
const pageErrors = [];
const app = await electron.launch({
  executablePath: launch.executablePath,
  args: launch.args,
  cwd: workspace,
  env: { ...environment, LIGHTTABLE_AUTOMATION_USER_DATA: userData },
  timeout: 30_000
});

try {
  const page = await app.firstWindow({ timeout: 30_000 });
  page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
  await page.setViewportSize({ width: 820, height: 620 });
  await waitForDesktopLauncher({
    app,
    page,
    outputDirectory: output,
    sourceFile: 'generated-adjustment-menu-document',
    pageErrors,
    label: 'adjustment-menu'
  });
  await page.getByRole('button', { name: 'New document' }).click();
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.locator('.lighttable-toolbar__meta').filter({ hasText: /ready/i })
    .waitFor({ state: 'attached', timeout: 60_000 });

  const trigger = page.getByRole('button', { name: 'New fill or processing layer' });
  await trigger.click();
  const menu = page.getByRole('menu', { name: 'New fill or processing layer' });
  await menu.waitFor({ state: 'visible' });
  const bounds = await menu.boundingBox();
  if (!bounds) throw new Error('The adjustment menu has no visible bounds.');
  const viewport = page.viewportSize();
  if (!viewport || bounds.x < 0 || bounds.y < 0
    || bounds.x + bounds.width > viewport.width
    || bounds.y + bounds.height > viewport.height) {
    throw new Error(`The adjustment menu escaped the viewport: ${JSON.stringify(bounds)}.`);
  }
  const isPortal = await menu.evaluate((element) => (
    element.parentElement === document.body
    && !element.closest('.lighttable-layers-panel')
  ));
  if (!isPortal) throw new Error('The adjustment menu is still owned by the Layers panel DOM.');

  for (const label of ['Grade', 'Lens Fx', 'Curves', 'Exposure', 'Selective Color']) {
    await menu.getByRole('menuitem', { name: `New ${label}${[
      'Grade', 'Lens Fx'
    ].includes(label) ? '' : ' adjustment'} layer`, exact: true })
      .waitFor({ state: 'attached' });
  }
  const attachExposure = menu.getByRole('menuitem', {
    name: 'Attach Exposure to selected layer', exact: true
  });
  await attachExposure.waitFor({ state: 'visible' });
  await page.screenshot({ path: screenshotPath });
  await attachExposure.click();
  await page.locator('.lighttable-layer-effect--local-processing')
    .filter({ hasText: /^Exposure$/ })
    .waitFor({ state: 'visible' });
  await trigger.click();
  const reopenedMenu = page.getByRole('menu', { name: 'New fill or processing layer' });
  await reopenedMenu.getByRole('menuitem', {
    name: 'Attach Levels to selected layer', exact: true
  }).click();
  await page.locator('.lighttable-layer-effect--local-processing')
    .filter({ hasText: /^Levels$/ })
    .waitFor({ state: 'visible' });
  const levels = page.getByRole('complementary', { name: 'Levels properties' });
  await levels.waitFor({ state: 'visible' });
  await levels.getByLabel('RGB histogram').waitFor({ state: 'visible' });
  if (await levels.locator('input[type="range"]').count() !== 5) {
    throw new Error('Levels does not expose the expected five combined range handles.');
  }
  await page.screenshot({ path: levelsScreenshotPath });
  if (pageErrors.length) throw new Error(`Renderer errors: ${JSON.stringify(pageErrors)}`);

  await writeFile(reportPath, `${JSON.stringify({
    bounds,
    viewport,
    portalOwned: isPortal,
    attachedExposure: true,
    attachedLevels: true,
    pageErrors
  }, null, 2)}\n`);
  process.stdout.write(`Adjustment menu smoke passed. Report: ${reportPath}\n`);
} finally {
  await app.close();
}
