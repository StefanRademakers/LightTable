import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { _electron as electron } from 'playwright-core';
import { resolveDesktopTestLaunch, waitForDesktopLauncher } from './desktop-test-startup.mjs';

const root = path.resolve(import.meta.dirname, '..');
const sourceFile = path.resolve(process.argv[2]
  ?? 'D:/mediavibe/LightTableTestFiles/RandomFiles/shapes.psd');
const output = path.join(root, 'tmp', 'tool-options-composition-smoke');
await mkdir(output, { recursive: true });
const launch = await resolveDesktopTestLaunch(root, { requirePackaged: true });
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: launch.executablePath, args: launch.args,
  cwd: root, env: { ...environment, LIGHTTABLE_AUTOMATION_OPEN_FILE: sourceFile,
    LIGHTTABLE_AUTOMATION_USER_DATA: path.join(output, `profile-${process.pid}`) } });
const report = { passed: false, pageErrors: [], sourceFile };

try {
  const page = await app.firstWindow({ timeout: 30_000 });
  page.on('pageerror', error => report.pageErrors.push(error.stack ?? error.message));
  const open = await waitForDesktopLauncher({ app, page, outputDirectory: output,
    sourceFile, pageErrors: report.pageErrors, label: 'tool-options-composition' });
  await open.click();
  await page.locator('.lighttable-toolbar__meta').filter({ hasText: /ready/i })
    .waitFor({ state: 'visible', timeout: 60_000 });
  const viewport = page.locator('.lighttable-viewport');
  const openContext = async () => {
    const bounds = await viewport.boundingBox();
    assert.ok(bounds, 'Viewport bounds are unavailable');
    await page.mouse.click(bounds.x + bounds.width * 0.5, bounds.y + bounds.height * 0.5,
      { button: 'right' });
    const dialog = page.getByRole('dialog', { name: 'Tool settings' });
    await dialog.waitFor({ state: 'visible' });
    return dialog;
  };

  await page.keyboard.press('u');
  let dialog = await openContext();
  const ellipse = dialog.getByRole('button', { name: 'Ellipse (U)' });
  await ellipse.click();
  dialog = page.getByRole('dialog', { name: 'Tool settings' });
  await dialog.waitFor({ state: 'visible' });
  assert.equal(await dialog.getByRole('button', { name: 'Ellipse (U)' }).getAttribute('aria-pressed'), 'true');
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });

  await page.getByRole('button', { name: 'Warp', exact: true }).click();
  dialog = await openContext();
  await dialog.getByRole('button', { name: 'Reset Warp', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
  assert.deepEqual(report.pageErrors, []);
  report.passed = true;
  await page.screenshot({ path: path.join(output, 'final.png') });
  console.log(`Tool Options composition passed: ${output}`);
} finally {
  await writeFile(path.join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await app.close().catch(() => {});
}
