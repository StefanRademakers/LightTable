import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { _electron as electron } from 'playwright-core';
import { resolveDesktopTestLaunch, waitForDesktopLauncher } from './desktop-test-startup.mjs';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';

const root = path.resolve(import.meta.dirname, '..');
const directory = path.join(root, 'tmp/text-geometry-smoke'); await mkdir(directory, { recursive: true });
const output = await mkdtemp(path.join(directory, 'run-'));
const report = { passed: false, phase: 'launch', pageErrors: [] };
let app, page;
try {
  const launch = await resolveDesktopTestLaunch(root, { requirePackaged: true });
  const env = { ...process.env, LIGHTTABLE_AUTOMATION_USER_DATA: path.join(output, 'profile') };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ executablePath: launch.executablePath, args: launch.args, cwd: root, env });
  page = await app.firstWindow();
  page.on('pageerror', error => report.pageErrors.push(error.stack || error.message || String(error)));
  await waitForDesktopLauncher({ app, page, outputDirectory: output, sourceFile: null,
    pageErrors: report.pageErrors, label: 'text-geometry' });
  const driver = await attachLightTableAutomation(page, 'text-geometry');
  const created = await driver.executeWorkspace('document.create', { name: 'Text geometry', width: 1000, height: 700,
    resolutionPpi: 72, bitDepth: 8, profile: 'srgb', background: { kind: 'solid', color: '#d0dce8' } });
  const id = created.value?.documentId; assert.ok(id); await driver.waitForReadyDocument(id, 60000);
  await driver.execute(id, 'view.setZoom', { mode: 'custom', percent: 100 });
  const bounds = await page.locator('.lighttable-viewport').boundingBox(); assert.ok(bounds);
  const screen = (x, y) => ({ x: bounds.x + (bounds.width - 1000) / 2 + x,
    y: bounds.y + (bounds.height - 700) / 2 + y });
  const drag = async (a, b) => {
    await page.mouse.move(a.x, a.y); await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 8 }); await page.mouse.up();
  };
  const depth = async () => (await driver.queryDocument(id)).history.undoDepth;
  const waitDepth = n => page.waitForFunction(({ id, n }) =>
    window.__lightTableAutomation?.queryDocument(id)?.history.undoDepth === n,
  { id, n }, { timeout: 10000 });
  report.phase = 'create-paragraph';
  await page.keyboard.press('t');
  await drag(screen(130, 100), screen(430, 280));
  const input = page.getByRole('textbox', { name: /^Edit / }); await input.waitFor({ state: 'attached' });
  const layer = (await driver.queryLayers(id)).find(layer => layer.type === 'text'); assert.ok(layer);
  const before = await driver.queryText(id, layer.id); report.before = before;
  assert.equal(before.layout.mode, 'paragraph');
  const openingDepth = await depth();
  const corner = text => screen(text.transform.tx + text.layout.frame.x + text.layout.frame.width,
    text.transform.ty + text.layout.frame.y + text.layout.frame.height);
  const a = corner(before);
  report.phase = 'resize-frame';
  await drag(a, { x: a.x + 80, y: a.y + 45 });
  await waitDepth(openingDepth + 1);
  const resized = await driver.queryText(id, layer.id); report.resized = resized;
  assert.equal(resized.layout.frame.width, before.layout.frame.width + 80);
  assert.equal(resized.layout.frame.height, before.layout.frame.height + 45);
  assert.deepEqual(resized.content, before.content);
  assert.deepEqual(resized.transform, before.transform);
  await driver.execute(id, 'history.undo', {});
  assert.deepEqual((await driver.queryText(id, layer.id)).layout, before.layout);
  await driver.execute(id, 'history.redo', {});
  assert.deepEqual((await driver.queryText(id, layer.id)).layout, resized.layout);
  // Re-enter the visible text through its ordinary hit route after history replay.
  const textPoint = screen(resized.transform.tx + 20, resized.transform.ty + 25);
  await page.mouse.dblclick(textPoint.x, textPoint.y);
  await input.waitFor({ state: 'attached' });
  report.phase = 'ctrl-drag-move';
  const moveDepth = await depth();
  await page.keyboard.down('Control');
  await drag(textPoint, { x: textPoint.x + 50, y: textPoint.y + 35 });
  await page.keyboard.up('Control');
  await waitDepth(moveDepth + 1);
  const moved = await driver.queryText(id, layer.id); report.moved = moved;
  assert.equal(moved.transform.tx, resized.transform.tx + 50);
  assert.equal(moved.transform.ty, resized.transform.ty + 35);
  assert.deepEqual(moved.layout, resized.layout); assert.deepEqual(moved.content, before.content);
  await driver.execute(id, 'history.undo', {});
  assert.deepEqual((await driver.queryText(id, layer.id)).transform, resized.transform);
  await driver.execute(id, 'history.redo', {});
  assert.deepEqual((await driver.queryText(id, layer.id)).transform, moved.transform);
  report.phase = 'create-path-text';
  await page.keyboard.press('Escape');
  await page.keyboard.press('p');
  await page.locator('.lighttable-tool-options__identity').filter({ hasText: 'Pen' }).waitFor();
  for (const point of [screen(130, 400), screen(600, 400)]) await page.mouse.click(point.x, point.y);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Shift+a');
  const pathStart = screen(130, 400); await page.mouse.click(pathStart.x, pathStart.y);
  await page.locator('[data-tool-group="Text tools"] > .ui-toolbar__button').click();
  await page.getByRole('toolbar', { name: 'Text tools' })
    .getByRole('button', { name: 'Path text (T)', exact: true }).click();
  const pathHit = screen(220, 400); await page.mouse.click(pathHit.x, pathHit.y);
  await input.waitFor({ state: 'attached' });
  const pathLayer = (await driver.queryLayers(id)).find(candidate => candidate.type === 'text' && candidate.id !== layer.id);
  assert.ok(pathLayer); const pathBefore = await driver.queryText(id, pathLayer.id); report.pathBefore = pathBefore;
  assert.equal(pathBefore.layout.mode, 'path'); assert.equal(pathBefore.layout.startOffset, 0);
  const pathDepth = await depth();
  report.phase = 'drag-path-start';
  await drag(pathStart, screen(210, 400)); await waitDepth(pathDepth + 1);
  const pathAfter = await driver.queryText(id, pathLayer.id); report.pathAfter = pathAfter;
  assert.ok(Math.abs(pathAfter.layout.startOffset - 80) < .01, 'Path start handle did not move 80 document pixels');
  assert.deepEqual(pathAfter.content, pathBefore.content);
  assert.deepEqual(pathAfter.transform, pathBefore.transform);
  await driver.execute(id, 'history.undo', {});
  assert.deepEqual((await driver.queryText(id, pathLayer.id)).layout, pathBefore.layout);
  await driver.execute(id, 'history.redo', {});
  assert.deepEqual((await driver.queryText(id, pathLayer.id)).layout, pathAfter.layout);
  assert.deepEqual(report.pageErrors, []);
  await page.screenshot({ path: path.join(output, 'final.png') }); report.passed = true;
  console.log(`Text geometry passed: ${output}`);
} catch (error) {
  report.error = error.stack ?? String(error);
  if (page) { await page.screenshot({ path: path.join(output, 'failure.png') }); report.body = await page.locator('body').innerText(); }
  throw error;
} finally {
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  await app?.close();
}
