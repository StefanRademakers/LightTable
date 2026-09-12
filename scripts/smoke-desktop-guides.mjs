import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { _electron as electron } from 'playwright-core';
import { resolveDesktopTestLaunch, waitForDesktopLauncher } from './desktop-test-startup.mjs';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';

const root = path.resolve(import.meta.dirname, '..');
const directory = path.join(root, 'tmp', 'guides-smoke');
await mkdir(directory, { recursive: true });
const output = await mkdtemp(path.join(directory, 'run-'));
const environment = { ...process.env }; delete environment.ELECTRON_RUN_AS_NODE;
const report = { checks: [], pageErrors: [] }; let app; let page;
try {
  const launch = await resolveDesktopTestLaunch(root, { requirePackaged: true });
  report.executablePath = launch.executablePath;
  app = await electron.launch({ executablePath: launch.executablePath, args: launch.args, cwd: root,
    env: { ...environment, LIGHTTABLE_AUTOMATION_USER_DATA: path.join(output, 'profile') } });
  page = await app.firstWindow(); page.on('pageerror', error => report.pageErrors.push(error.stack ?? error.message));
  await waitForDesktopLauncher({ app, page, outputDirectory: output, sourceFile: null,
    pageErrors: report.pageErrors, label: 'guides' });
  const driver = await attachLightTableAutomation(page, 'guides');
  const create = async name => {
    const result = await driver.executeWorkspace('document.create', { name, width: 480, height: 320,
      resolutionPpi: 72, bitDepth: 8, profile: 'srgb', background: { kind: 'solid', color: '#385f86' } });
    const id = result.value?.documentId; assert.ok(id); await driver.waitForReadyDocument(id, 60000); return id;
  };
  const a = await create('Guide document A');
  const artifact = async command => {
    const accepted = await driver.execute(a, command, {}, { requireCompleted: false });
    const task = await driver.waitForTask(a, accepted.taskId); assert.ok(task.artifact?.id);
    const value = await driver.readArtifact(task.artifact.id); return Buffer.from(value.bytes);
  };
  let snapshotIndex = 0;
  const guides = async () => {
    const bytes = await artifact('file.exportNative');
    assert.equal(bytes.subarray(-12, -4).toString(), 'LTBLDOC1');
    const size = bytes.readUInt32LE(bytes.length - 4);
    const manifest = JSON.parse(bytes.subarray(bytes.length - 12 - size, bytes.length - 12));
    const value = manifest.document.guides;
    await writeFile(path.join(output, `guides-${snapshotIndex++}.json`), JSON.stringify(value, null, 2));
    return value;
  };
  const png = async label => {
    const bytes = await artifact('file.exportPng'); await writeFile(path.join(output, `${label}.png`), bytes);
    return sharp(bytes).ensureAlpha().raw().toBuffer();
  };
  const baselinePixels = await png('before');
  const depth = async () => (await driver.queryDocument(a)).history.undoDepth;
  const menu = async (...items) => {
    await page.getByRole('menuitem', { name: 'View', exact: true }).click();
    for (let i = 0; i < items.length; i++) {
      const option = items[0] === 'Show' && i === 1
        ? page.locator(`[data-menu-value="show-${String(items[i]).includes('Grid') ? 'grid' : 'guides'}"]`)
        : page.getByRole('menuitem', { name: items[i], exact: typeof items[i] === 'string' });
      if (i === items.length - 1) await option.click(); else await option.hover();
    }
  };
  await menu('Guides', 'New Guide...');
  const dialog = page.getByRole('dialog', { name: 'New Guide', exact: true });
  await dialog.getByRole('textbox').fill('80');
  await dialog.getByRole('button', { name: 'OK', exact: true }).click();
  const opening = await guides(); assert.equal(opening.length, 1);
  assert.equal(opening[0].orientation, 'vertical'); assert.equal(opening[0].position, 80);
  await menu(/Rulers/);
  await page.locator('.lighttable-ruler--horizontal').waitFor({ state: 'visible' });
  await driver.execute(a, 'view.setZoom', { mode: 'custom', percent: 100 });
  await page.keyboard.press('Control+t');
  const body = page.locator('.lighttable-transform__body'); await body.waitFor();
  // Use the existing guide's exact inline image projection, not the centre of
  // its deliberately asymmetric 9px hit strip (which is offset by half a pixel).
  const frame = await page.locator('.lighttable-guide-hit--vertical').first().evaluate(element => {
    const root = element.closest('.lighttable-layout-guides').getBoundingClientRect();
    return { x: root.left + parseFloat(element.style.left) - 80,
      y: root.top + parseFloat(element.style.top) };
  });
  const point = (x, y) => ({ x: frame.x + x, y: frame.y + y });
  const hits = orientation => page.locator(`.lighttable-guide-hit--${orientation}`);
  const drag = async (start, finish) => {
    await page.mouse.move(start.x, start.y); await page.mouse.down();
    await page.mouse.move(finish.x, finish.y, { steps: 4 }); await page.mouse.up();
  };
  const vertical = await hits('vertical').first().boundingBox(); assert.ok(vertical);
  const start = point(80, 40);
  const beforeMove = await depth();
  await drag(start, { x: start.x + 40, y: start.y });
  const moved = await guides(); assert.equal(await depth(), beforeMove + 1);
  assert.equal(moved[0].position, 120);
  const afterMove = await depth();
  await page.mouse.click(start.x + 40, start.y);
  assert.equal(await depth(), afterMove, 'No-op existing-guide click must not author history');
  assert.deepEqual(await guides(), moved);
  const ruler = await page.locator('.lighttable-ruler--horizontal').boundingBox(); assert.ok(ruler);
  await drag({ x: frame.x + 220, y: ruler.y + ruler.height / 2 }, point(220, 100));
  const withHorizontal = await guides(); assert.equal(withHorizontal.length, 2);
  assert.equal(withHorizontal.find(guide => guide.orientation === 'horizontal').position, 100);
  assert.equal(await depth(), afterMove + 1);
  await page.screenshot({ path: path.join(output, 'guides-after-ruler.png') });
  report.checks.push('New Guide dialog, real guide drag/no-op and ruler drag publish exact positions in one history unit.');
  // Supplement normal mouse drags with a terminal sample different from the last
  // pointermove. This dispatches to the real input layer, not a private owner API.
  await page.locator('.lighttable-layout-guides').evaluate(element => {
    element.addEventListener('pointerdown', event => { window.__guideSmokePointerId = event.pointerId; }, { once: true });
  });
  await page.mouse.move(frame.x + 120, frame.y + 40); await page.mouse.down();
  await page.mouse.move(frame.x + 150, frame.y + 40);
  await page.locator('.lighttable-layout-guides').evaluate((element, final) => {
    element.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true,
      pointerId: window.__guideSmokePointerId, pointerType: 'mouse', button: 0,
      clientX: final.x, clientY: final.y }));
    delete window.__guideSmokePointerId;
  }, point(180, 40));
  await page.mouse.up();
  const finalSample = await guides();
  assert.equal(finalSample.find(guide => guide.orientation === 'vertical').position, 180,
    'The latest pointer-up sample, not the last pointermove, must determine canonical geometry');
  report.checks.push('Supplemental public pointer-up event commits terminal position180 after preview150.');
  const beforeDelete = await depth();
  await drag(point(180, 40), point(-30, 40));
  const deleted = await guides(); assert.equal(deleted.length, 1); assert.equal(await depth(), beforeDelete + 1);
  await driver.execute(a, 'history.undo', {}); assert.deepEqual(await guides(), finalSample);
  await driver.execute(a, 'history.redo', {}); assert.deepEqual(await guides(), deleted);
  const b = await create('Guide document B');
  assert.equal(await hits('horizontal').count(), 0, 'B must not inherit A guides');
  await page.getByRole('tab', { name: /Guide document A/ }).click(); await driver.waitForReadyDocument(a, 60000);
  assert.deepEqual(await guides(), deleted);
  const beforePresentation = await driver.queryDocument(a);
  await menu('Show', /^Grid(?: ✓)?$/);
  await menu('Show', /^Guides(?: ✓)?$/);
  assert.equal(await hits('horizontal').count(), 0);
  await menu('Show', /^Guides(?: ✓)?$/);
  assert.equal((await driver.queryDocument(a)).canonicalRevision, beforePresentation.canonicalRevision);
  assert.equal(await depth(), beforePresentation.history.undoDepth);
  assert.deepEqual(await png('after'), baselinePixels, 'Guides/grid must not change exported document pixels');
  report.checks.push('Drag-out delete and exact Undo/Redo; tab isolation; guide/grid visibility stays outside document pixels/history.');
  report.otherDocumentId = b; assert.deepEqual(report.pageErrors, []);
  await page.screenshot({ path: path.join(output, 'final-ui.png') });
  report.passed = true; console.log(`Guide smoke passed: ${output}`);
} catch (error) {
  report.passed = false; report.error = error.stack ?? String(error);
  if (page) await page.screenshot({ path: path.join(output, 'failure.png') });
  throw error;
} finally {
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  await app?.close();
}
