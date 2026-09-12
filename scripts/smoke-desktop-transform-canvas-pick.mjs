import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { _electron as electron } from 'playwright-core';
import { resolveDesktopTestLaunch, waitForDesktopLauncher } from './desktop-test-startup.mjs';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';

const root = path.resolve(import.meta.dirname, '..');
const directory = path.join(root, 'tmp', 'transform-canvas-pick-smoke');
await mkdir(directory, { recursive: true });
const output = await mkdtemp(path.join(directory, 'run-'));
const environment = { ...process.env }; delete environment.ELECTRON_RUN_AS_NODE;
const report = { observations: [], pageErrors: [] }; let app; let page;
try {
  const launch = await resolveDesktopTestLaunch(root, { requirePackaged: true });
  report.executablePath = launch.executablePath;
  app = await electron.launch({ executablePath: launch.executablePath, args: launch.args,
    cwd: root, env: { ...environment, LIGHTTABLE_AUTOMATION_USER_DATA: path.join(output, 'profile') } });
  page = await app.firstWindow(); page.on('pageerror', error => report.pageErrors.push(error.stack ?? error.message));
  await waitForDesktopLauncher({ app, page, outputDirectory: output, sourceFile: null,
    pageErrors: report.pageErrors, label: 'transform-canvas-pick' });
  const driver = await attachLightTableAutomation(page, 'transform-canvas-pick');
  const created = await driver.executeWorkspace('document.create', {
    name: 'Canvas alpha picks', width: 512, height: 384, resolutionPpi: 72,
    bitDepth: 8, profile: 'srgb', background: { kind: 'solid', color: '#303030' }
  });
  const id = created.value?.documentId; assert.ok(id);
  await driver.waitForReadyDocument(id, 60000);
  const command = (name, parameters = {}) => driver.execute(id, name, parameters);
  const state = () => driver.queryDocument(id);
  const backgroundId = (await state()).activeLayerId;
  const rectangle = async (name, x, y, color) => (await command('vector.create', {
    name, primitive: { kind: 'rectangle', x, y, width: 160, height: 140, cornerRadii: [0, 0, 0, 0] },
    style: { fill: { type: 'solid', color } }
  })).value.layerId;
  const left = await rectangle('Left red rectangle', 35, 80, [0.9, 0.15, 0.1, 1]);
  const right = await rectangle('Upper blue rectangle', 135, 120, [0.1, 0.2, 0.9, 1]);
  const empty = (await command('layer.createRaster')).value.layerId;
  const pixels = async label => {
    const accepted = await driver.execute(id, 'file.exportPng', {}, { requireCompleted: false });
    const task = await driver.waitForTask(id, accepted.taskId); assert.ok(task.artifact?.id);
    const artifact = await driver.readArtifact(task.artifact.id); assert.ok(artifact?.bytes?.length);
    await writeFile(path.join(output, `${label}.png`), artifact.bytes);
    return createHash('sha256').update(artifact.bytes).digest('hex');
  };
  const authoredLayers = async () => (await driver.queryLayers(id)).map(({ id, type, transform, bounds }) => ({ id, type, transform, bounds }));
  const baselinePixels = await pixels('before'); const baselineLayers = await authoredLayers();
  const baselineDepth = (await state()).history.undoDepth;
  await command('view.setZoom', { mode: 'fit' });
  await page.locator(`[data-layer-id="${backgroundId}"] .lighttable-layer__name`).click();
  await page.waitForFunction(({ id, backgroundId }) => window.__lightTableAutomation.queryDocument(id).activeLayerId === backgroundId,
    { id, backgroundId });
  await page.keyboard.press('Control+t');
  await page.getByRole('checkbox', { name: 'Auto select layer' }).check();
  const body = page.locator('.lighttable-transform__body'); await body.waitFor({ state: 'visible' });
  const frame = await body.boundingBox(); assert.ok(frame);
  const client = (x, y) => ({ x: frame.x + x / 512 * frame.width, y: frame.y + y / 384 * frame.height });
  const assertSelected = async (expected, active) => {
    await page.waitForFunction(({ id, expected, active }) => {
      const selected = [...document.querySelectorAll('.lighttable-layer--selected[data-layer-id]')]
        .map(element => element.dataset.layerId).sort();
      return JSON.stringify(selected) === JSON.stringify([...expected].sort())
        && window.__lightTableAutomation.queryDocument(id).activeLayerId === active;
    }, { id, expected, active }).catch(async error => {
      report.observations.push({ kind: 'selection mismatch', expected, expectedActive: active,
        actual: await state(), actualRows: await page.locator('.lighttable-layer--selected[data-layer-id]')
          .evaluateAll(elements => elements.map(element => element.dataset.layerId)) });
      throw error;
    });
    assert.equal((await state()).history.undoDepth, baselineDepth, 'Canvas selection must not author history');
  };
  const click = async (point, expected, active, extend = false) => {
    const position = client(...point);
    const hit = await page.evaluate(({ x, y }) => Boolean(document.elementFromPoint(x, y)?.closest('.lighttable-viewport')), position);
    assert.ok(hit, 'The real canvas point must not be covered by a panel');
    if (extend) await page.keyboard.down('Shift');
    await page.mouse.click(position.x, position.y);
    if (extend) await page.keyboard.up('Shift');
    await assertSelected(expected, active);
  };
  await click([70, 110], [left], left);
  await click([170, 165], [left, right], right, true);
  await click([70, 110], [right], right, true);
  await click([170, 165], [right], right);
  report.observations.push({ kind: 'real canvas pick and Shift add/remove', left, right, skippedTransparentRaster: empty });
  // No private delay or renderer override: this exercises an ordinary zoom adjacent to a real pick.
  const position = client(70, 110);
  await page.mouse.click(position.x, position.y);
  await command('view.setZoom', { mode: 'custom', percent: 80 });
  await assertSelected([left], left);
  assert.deepEqual(await authoredLayers(), baselineLayers, 'Selection/zoom must preserve authored layer geometry');
  assert.equal(await pixels('after'), baselinePixels, 'Selection/zoom must preserve exact final PNG pixels');
  report.observations.push({ kind: 'pick adjacent to zoom rerender', historyDelta: 0, exactPng: true,
    pendingRequestTiming: 'not forced; delayed-rerender lifetime is separately covered by owner/hook tests' });
  assert.deepEqual(report.pageErrors, []);
  await page.screenshot({ path: path.join(output, 'final-ui.png') });
  report.passed = true;
  console.log(`Transform canvas-pick passed: ${output}`);
} catch (error) {
  report.passed = false; report.error = error.stack ?? String(error);
  if (page) await page.screenshot({ path: path.join(output, 'failure.png') });
  throw error;
} finally {
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  await app?.close();
}
