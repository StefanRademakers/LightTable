import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { _electron as electron } from 'playwright-core';
import { resolveDesktopTestLaunch, waitForDesktopLauncher } from './desktop-test-startup.mjs';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';

const root = path.resolve(import.meta.dirname, '..');
const directory = path.join(root, 'tmp/marquee-edge-pan-smoke');
await mkdir(directory, { recursive: true });
const output = await mkdtemp(path.join(directory, 'run-'));
const report = { passed: false, pageErrors: [], phase: 'launch' };
let app, page, driver, id;
try {
  const launch = await resolveDesktopTestLaunch(root, { requirePackaged: true });
  const env = { ...process.env, LIGHTTABLE_AUTOMATION_USER_DATA: path.join(output, 'profile') };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ executablePath: launch.executablePath, args: launch.args, cwd: root, env });
  page = await app.firstWindow();
  page.on('pageerror', error => report.pageErrors.push(error.stack || error.message || String(error)));
  await waitForDesktopLauncher({ app, page, outputDirectory: output, sourceFile: null,
    pageErrors: report.pageErrors, label: 'marquee-edge-pan' });
  driver = await attachLightTableAutomation(page, 'marquee-edge-pan');
  const created = await driver.executeWorkspace('document.create', { name: 'Edge pan', width: 1000, height: 800,
    resolutionPpi: 72, bitDepth: 8, profile: 'srgb', background: { kind: 'solid', color: '#6699aa' } });
  id = created.value?.documentId; assert.ok(id); await driver.waitForReadyDocument(id, 60000);
  await driver.execute(id, 'view.setZoom', { mode: 'custom', percent: 200 });
  await page.keyboard.press('m');
  await page.getByLabel('Marquee selection settings').waitFor();
  const bounds = await page.locator('.lighttable-viewport').boundingBox(); assert.ok(bounds);
  const before = await driver.queryDocument(id); report.before = before;
  report.phase = 'edge-drag';
  await page.mouse.move(bounds.x + bounds.width * .5, bounds.y + bounds.height * .3);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 2, bounds.y + bounds.height * .55, { steps: 6 });
  // Observe real stationary edge-pan frames; this is not an app-state injection.
  await page.waitForTimeout(200);
  const during = await driver.queryDocument(id); report.during = during;
  await page.screenshot({ path: path.join(output, 'edge-drag.png') });
  assert.deepEqual(report.pageErrors, []);
  assert.notEqual(during.viewport.panX, before.viewport.panX, 'Stationary edge drag did not pan');
  assert.equal(during.history.undoDepth, before.history.undoDepth, 'Preview must not add history');
  await page.mouse.up();
  // Pointer delivery returns before the selection's asynchronous terminal publication.
  await page.waitForFunction(({ id, depth }) =>
    window.__lightTableAutomation?.queryDocument(id)?.history.undoDepth === depth,
  { id, depth: before.history.undoDepth + 1 }, { timeout: 10000 });
  const after = await driver.queryDocument(id); report.after = after;
  assert.equal(after.history.undoDepth, before.history.undoDepth + 1);
  report.phase = 'undo-redo';
  await driver.execute(id, 'history.undo', {});
  assert.equal((await driver.queryDocument(id)).history.undoDepth, before.history.undoDepth);
  await driver.execute(id, 'history.redo', {});
  assert.equal((await driver.queryDocument(id)).history.undoDepth, after.history.undoDepth);
  assert.deepEqual(report.pageErrors, []);
  report.passed = true;
  console.log(`Marquee edge pan passed: ${output}`);
} catch (error) {
  report.error = error.stack ?? String(error);
  if (page) {
    await page.screenshot({ path: path.join(output, 'failure.png') });
    report.body = await page.locator('body').innerText();
  }
  throw error;
} finally {
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  await app?.close();
}
