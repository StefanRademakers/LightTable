import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright-core';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { resolveDesktopTestLaunch, waitForDesktopLauncher } from './desktop-test-startup.mjs';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';

const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, 'tmp', 'viewport-layout-smoke');
await mkdir(output, { recursive: true });
const userData = await mkdtemp(path.join(output, 'profile-'));
const launch = await resolveDesktopTestLaunch(root, { requirePackaged: true });
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
const pageErrors = [];
const report = { layouts: [], pageErrors };
let app;

try {
  app = await electron.launch({
    executablePath: launch.executablePath,
    args: launch.args,
    cwd: root,
    env: { ...environment, LIGHTTABLE_AUTOMATION_USER_DATA: userData },
    timeout: 30_000
  });
  const page = await app.firstWindow({ timeout: 30_000 });
  page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
  await waitForDesktopLauncher({
    app, page, outputDirectory: output, sourceFile: null, pageErrors, label: 'viewport-layout'
  });
  const driver = await attachLightTableAutomation(page, 'viewport-layout');
  const created = await driver.executeWorkspace('document.create', {
    name: 'Viewport layout ownership',
    width: 640,
    height: 480,
    resolutionPpi: 72,
    bitDepth: 8,
    profile: 'srgb',
    background: { kind: 'solid', color: '#386aa8' }
  });
  const documentId = created.value?.documentId;
  assert.ok(documentId, 'Viewport layout smoke did not create a document.');
  await driver.waitForReadyDocument(documentId, 60_000);
  const viewport = page.locator('.lighttable-viewport');
  await viewport.waitFor({ state: 'visible' });
  await page.keyboard.press('Control+1');

  const expected = { x: 100, y: 120, width: 80, height: 60 };
  const exerciseLayout = async (label) => {
    await page.keyboard.press('Control+D');
    await page.keyboard.press('m');
    await page.waitForTimeout(150);
    const document = await driver.queryDocument(documentId);
    const bounds = await viewport.boundingBox();
    assert.ok(document?.canvas && bounds, `${label}: document viewport is unavailable.`);
    const image = {
      x: (bounds.width - document.canvas.width) / 2 + document.viewport.panX,
      y: (bounds.height - document.canvas.height) / 2 + document.viewport.panY
    };
    const client = (x, y) => ({ x: bounds.x + image.x + x, y: bounds.y + image.y + y });
    const start = client(expected.x, expected.y);
    const end = client(expected.x + expected.width, expected.y + expected.height);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 6 });
    await page.mouse.up();

    let copiedBounds = null;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const copied = await driver.execute(documentId, 'selection.copyPixels', { source: 'merged' });
      copiedBounds = copied.value?.bounds ?? null;
      if (copiedBounds) break;
      await page.waitForTimeout(50);
    }
    assert.deepEqual(copiedBounds, expected, `${label}: layout changed document projection.`);
    report.layouts.push({
      label,
      viewport: bounds,
      image,
      copiedBounds,
      rulers: await page.locator('.lighttable-ruler').count()
    });
  };

  await exerciseLayout('Photo edit / floating Layers');

  const grading = page.getByRole('radio', { name: 'Switch to Grading workspace' });
  await grading.click();
  await page.locator('.dv-active-tab').filter({ hasText: /^Scopes$/ })
    .waitFor({ state: 'visible' });
  await page.waitForTimeout(250);
  await exerciseLayout('Grading / docked scopes and properties');

  const photo = page.getByRole('radio', { name: 'Switch to Photo edit workspace' });
  await photo.click();
  await page.locator('.dv-active-tab').filter({ hasText: /^Properties$/ })
    .waitFor({ state: 'visible' });
  await page.keyboard.press('Control+R');
  await page.locator('.lighttable-ruler').first().waitFor({ state: 'visible' });
  await exerciseLayout('Photo edit / rulers and tool options');

  if (pageErrors.length) throw new Error(`Viewport layout page errors: ${JSON.stringify(pageErrors)}`);
  await page.screenshot({ path: path.join(output, 'viewport-layout.png') });
  await writeFile(path.join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`Viewport layout smoke passed. Output: ${output}\n`);
} finally {
  await app?.close().catch(() => {});
}
