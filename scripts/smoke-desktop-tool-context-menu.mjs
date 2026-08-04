import { _electron as electron } from 'playwright-core';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const workspaceRoot = path.resolve(import.meta.dirname, '..');
const sourceFile = path.resolve(process.argv[2] ?? 'D:\\shapes.psd');
const executablePath = path.join(workspaceRoot, 'node_modules', 'electron', 'dist', 'electron.exe');
const outputDirectory = path.join(workspaceRoot, 'tmp', 'tool-context-menu-smoke');
const userDataPath = path.join(outputDirectory, `user-data-${process.pid}`);
const screenshotPath = path.join(outputDirectory, 'shape-context-menu.png');
const reportPath = path.join(outputDirectory, 'shape-context-menu.json');

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
  await page.keyboard.press('u');
  await page.keyboard.press('Shift+u');

  const viewport = page.locator('.lighttable-viewport');
  const viewportBounds = await viewport.boundingBox();
  if (!viewportBounds) throw new Error('Viewport bounds are unavailable.');
  const click = {
    x: viewportBounds.x + viewportBounds.width - 18,
    y: viewportBounds.y + viewportBounds.height - 18
  };
  await page.mouse.click(click.x, click.y, { button: 'right' });

  const layout = page.getByRole('dialog', { name: 'Tool settings' });
  await layout.waitFor({ state: 'visible' });
  const family = page.getByRole('toolbar', { name: 'Shape tools' });
  await family.waitFor({ state: 'visible' });
  for (const name of ['Rectangle (U)', 'Ellipse (Shift+U)', 'Triangle', 'Line']) {
    await family.getByRole('button', { name }).waitFor({ state: 'visible' });
  }

  const placement = await page.evaluate(() => {
    const layout = document.querySelector('.lighttable-tool-options-menu-layout');
    const family = document.querySelector('.lighttable-tool-options-menu__family');
    const properties = document.querySelector('.lighttable-tool-options-menu');
    if (!layout || !family || !properties) throw new Error('Context menu columns are unavailable.');
    const outer = layout.getBoundingClientRect();
    const familyBounds = family.getBoundingClientRect();
    const propertyBounds = properties.getBoundingClientRect();
    return {
      outer: { left: outer.left, top: outer.top, right: outer.right, bottom: outer.bottom },
      gap: propertyBounds.left - familyBounds.right,
      viewport: { width: window.innerWidth, height: window.innerHeight }
    };
  });
  if (Math.abs(placement.gap - 8) > 0.1) {
    throw new Error(`Tool family/property gap is ${placement.gap}px instead of 8px.`);
  }
  if (placement.outer.left < 8 || placement.outer.top < 8
    || placement.outer.right > placement.viewport.width - 8
    || placement.outer.bottom > placement.viewport.height - 8) {
    throw new Error(`Context menu escaped the viewport: ${JSON.stringify(placement)}`);
  }

  await page.screenshot({ path: screenshotPath });
  await family.getByRole('button', { name: 'Rectangle (U)' }).click();
  await family.getByRole('button', { name: 'Rectangle (U)' })
    .waitFor({ state: 'visible' });
  if (pageErrors.length) throw new Error(`Page errors: ${JSON.stringify(pageErrors)}`);
  await writeFile(reportPath, `${JSON.stringify({
    sourceFile,
    click,
    placement,
    pageErrors,
    screenshotPath
  }, null, 2)}\n`);
  process.stdout.write(`Tool context-menu smoke passed. Report: ${reportPath}\n`);
} finally {
  await app.close().catch(() => {});
}
