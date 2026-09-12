import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { _electron as electron } from 'playwright-core';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';
import { resolveDesktopTestLaunch, waitForDesktopLauncher } from './desktop-test-startup.mjs';

const root = path.resolve(import.meta.dirname, '..');
const output = path.resolve(process.env.LIGHTTABLE_PRESENTATION_OUTPUT ?? path.join(root, 'tmp', 'transform-presentation'));
await mkdir(output, { recursive: true });
const userData = await mkdtemp(path.join(output, 'profile-'));
const launch = await resolveDesktopTestLaunch(root, { requirePackaged: true });
const environment = { ...process.env, LIGHTTABLE_AUTOMATION_USER_DATA: userData };
delete environment.ELECTRON_RUN_AS_NODE;
const report = { executablePath: launch.executablePath, pageErrors: [] };
let app;
try {
  app = await electron.launch({ executablePath: launch.executablePath, args: launch.args,
    cwd: root, env: environment, timeout: 30_000 });
  const page = await app.firstWindow();
  page.on('pageerror', error => report.pageErrors.push(error.stack ?? error.message));
  await waitForDesktopLauncher({ app, page, outputDirectory: output, pageErrors: report.pageErrors,
    label: 'transform-presentation' });
  const driver = await attachLightTableAutomation(page, 'transform-presentation');
  const created = await driver.executeWorkspace('document.create', { name: 'Snap presentation',
    width: 1024, height: 768, resolutionPpi: 72, bitDepth: 8, profile: 'srgb',
    background: { kind: 'solid', color: '#e5e5e5' } });
  const id = created.value.documentId;
  await driver.waitForReadyDocument(id);
  const stamp = async (x, y, color) => {
    const layer = await driver.execute(id, 'vector.create', {
      name: 'Snap square', primitive: { kind: 'rectangle', x: x - 48, y: y - 48,
        width: 96, height: 96, cornerRadii: [0, 0, 0, 0] },
      style: { fill: { type: 'solid', color } }
    });
    return layer.value.layerId;
  };
  const targetId = await stamp(650, 450, [0.2, 0.25, 0.8, 1]);
  const movingId = await stamp(250, 250, [0.86, 0.2, 0.1, 1]);
  await driver.execute(id, 'view.setZoom', { mode: 'fit' });
  await page.locator(`[data-layer-id="${movingId}"] .lighttable-layer__name`).click();
  await page.keyboard.press('Control+t');
  const body = page.locator('.lighttable-transform__body');
  await body.waitFor({ state: 'visible' });
  const box = await body.boundingBox();
  assert.ok(box);
  const start = await page.evaluate(bounds => {
    for (const fy of [0.3, 0.7, 0.5]) for (const fx of [0.3, 0.7, 0.5]) {
      const point = { x: bounds.x + bounds.width * fx, y: bounds.y + bounds.height * fy };
      if (document.elementFromPoint(point.x, point.y)?.classList.contains('lighttable-transform__body')) return point;
    }
    return null;
  }, box);
  assert.ok(start, 'Transform body must be unobstructed.');
  const before = await driver.queryDocument(id);
  const layers = await driver.queryLayers(id);
  const moving = layers.find(layer => layer.id === movingId);
  const target = layers.find(layer => layer.id === targetId);
  const expectedX = target.bounds.document.x - moving.bounds.document.x;
  // Fit zoom is a viewport projection; the saved custom scale is not its value.
  const scale = box.width / moving.bounds.document.width;
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  // Stop just short of alignment: the admitted snap target must resolve it.
  await page.mouse.move(start.x + (expectedX - 2) * scale,
    start.y + 160 * scale, { steps: 12 });
  await page.screenshot({ path: path.join(output, 'during-snap.png') });
  await page.mouse.up();
  await page.keyboard.press('Enter');
  await page.waitForFunction(({ id, depth }) =>
    window.__lightTableAutomation.queryDocument(id)?.history.undoDepth === depth,
  { id, depth: before.history.undoDepth + 1 });
  const after = (await driver.queryLayers(id)).find(layer => layer.id === movingId);
  assert.ok(Math.abs(after.transform.tx - expectedX) < 0.01,
    `Expected snapped translation ${expectedX}; got ${after.transform.tx}`);
  await driver.execute(id, 'history.undo', {});
  assert.deepEqual((await driver.queryLayers(id)).find(layer => layer.id === movingId).transform,
    moving.transform);
  await driver.execute(id, 'history.redo', {});
  assert.deepEqual((await driver.queryLayers(id)).find(layer => layer.id === movingId).transform,
    after.transform);
  await page.screenshot({ path: path.join(output, 'committed.png') });
  Object.assign(report, { expectedX, scale, before, after });
  assert.deepEqual(report.pageErrors, []);
  process.stdout.write(`Transform presentation passed: ${output}\n`);
} catch (error) {
  report.failure = error.stack ?? String(error);
  if (app) await (await app.firstWindow()).screenshot({ path: path.join(output, 'failure.png') });
  throw error;
} finally {
  await writeFile(path.join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  await app?.close();
}
