import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { _electron as electron } from 'playwright-core';
import sharp from 'sharp';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';
import { resolveDesktopTestLaunch, waitForDesktopLauncher } from './desktop-test-startup.mjs';

const root = path.resolve(import.meta.dirname, '..');
const surfaceSelection = process.env.LIGHTTABLE_SURFACE_SELECTION ?? 'feathered';
assert.ok(['feathered', 'painted'].includes(surfaceSelection));
const output = path.join(root, 'tmp', surfaceSelection === 'painted'
  ? 'layer-history-gesture-painted' : 'layer-history-gesture');
await mkdir(output, { recursive: true });
const profile = await mkdtemp(path.join(output, 'profile-'));
const launch = await resolveDesktopTestLaunch(root, { requirePackaged: true });
const environment = { ...process.env, LIGHTTABLE_AUTOMATION_USER_DATA: profile };
delete environment.ELECTRON_RUN_AS_NODE;
const pageErrors = [];
let app;
await writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'running', startedAt: new Date().toISOString() }));
try {
  app = await electron.launch({ executablePath: launch.executablePath, args: launch.args,
    cwd: root, env: environment, timeout: 30_000 });
  const page = await app.firstWindow();
  page.on('pageerror', error => pageErrors.push(error.message));
  await waitForDesktopLauncher({ app, page, outputDirectory: output, sourceFile: null,
    pageErrors, label: 'layer-history-gesture' });
  const driver = await attachLightTableAutomation(page, 'layer-history-gesture');
  const created = await driver.executeWorkspace('document.create', {
    name: 'Layer gesture ownership', width: 480, height: 320, resolutionPpi: 72,
    bitDepth: 8, profile: 'srgb', background: { kind: 'solid', color: '#c84020' }
  });
  const documentId = created?.value?.documentId;
  assert.ok(documentId);
  await driver.waitForRenderedDocument(documentId, 60_000);
  const pixels = async () => {
    const state = await driver.queryDocument(documentId);
    const request = await driver.requestDocumentPreview(documentId, state.canonicalRevision, 512);
    assert.ok(request?.artifact?.id ?? request?.id, `Preview request failed: ${JSON.stringify(request)}`);
    const artifact = await driver.readArtifact(request?.artifact?.id ?? request?.id);
    assert.ok(artifact?.bytes?.length, `Preview artifact unavailable: ${JSON.stringify(artifact)}`);
    return sharp(artifact.bytes).ensureAlpha().raw().toBuffer();
  };
  const openingPixels = await pixels();
  const opening = await driver.queryDocument(documentId);
  const opacity = page.locator('.lighttable-layers__opacity-controls')
    .getByRole('slider', { name: 'Opacity', exact: true });
  await opacity.waitFor({ state: 'visible' });
  const samples = [];
  for (const fraction of [0.38, 0.74, 0.51]) {
    const before = await driver.queryDocument(documentId);
    const bounds = await opacity.boundingBox();
    assert.ok(bounds);
    const from = Number(await opacity.inputValue()) / 100;
    await page.mouse.move(bounds.x + 7 + (bounds.width - 14) * from, bounds.y + bounds.height / 2);
    await page.mouse.down();
    await page.mouse.move(bounds.x + 7 + (bounds.width - 14) * fraction,
      bounds.y + bounds.height / 2, { steps: 12 });
    // A held gesture must not publish a history entry on React preview rerenders.
    assert.equal((await driver.queryDocument(documentId)).history.undoDepth, before.history.undoDepth);
    await page.mouse.up();
    await page.waitForFunction(({ id, depth }) =>
      window.__lightTableAutomation?.queryDocument(id)?.history.undoDepth === depth,
    { id: documentId, depth: before.history.undoDepth + 1 });
    const after = await driver.queryDocument(documentId);
    assert.equal(after.history.undoLabel, 'Layer Opacity');
    samples.push({ value: await opacity.inputValue(), history: after.history });
  }
  const finalPixels = await pixels();
  assert.notDeepEqual(finalPixels, openingPixels, 'Opacity gestures must change rendered pixels.');
  // Keyboard history uses the mounted prerequisite path, not a test-only restore.
  await opacity.blur();
  for (let index = 1; index <= 3; index++) {
    await page.keyboard.press('Control+z');
    await page.waitForFunction(({ id, depth }) =>
      window.__lightTableAutomation?.queryDocument(id)?.history.undoDepth === depth,
    { id: documentId, depth: opening.history.undoDepth + 3 - index });
  }
  assert.deepEqual(await pixels(), openingPixels, 'Undo must restore exact opening pixels.');
  for (let index = 1; index <= 3; index++) {
    await page.keyboard.press('Control+Shift+z');
    await page.waitForFunction(({ id, depth }) =>
      window.__lightTableAutomation?.queryDocument(id)?.history.undoDepth === depth,
    { id: documentId, depth: opening.history.undoDepth + index });
  }
  assert.deepEqual(await pixels(), finalPixels, 'Redo must restore exact final pixels.');
  await page.keyboard.press('b');
  const viewport = page.locator('.lighttable-viewport');
  const waitTool = async tool => {
    try {
      await page.waitForFunction(name => document.querySelector('.lighttable-viewport')
        ?.classList.contains(`lighttable-viewport--${name}`), tool);
    } catch (error) {
      console.error(JSON.stringify({ expectedTool: tool, viewport: await viewport.getAttribute('class'),
        workspace: await driver.queryWorkspace(), pageErrors }));
      await page.screenshot({ path: path.join(output, 'failure.png') });
      throw error;
    }
  };
  await waitTool('brush');
  await page.keyboard.down('Space');
  await waitTool('view');
  // Repeat Space with a changed modifier: owner replaces pan with zoom, not
  // two independent UI booleans displaying pan while input executes zoom.
  await page.keyboard.down('Control');
  await page.keyboard.down('Space');
  await waitTool('zoom');
  await page.keyboard.up('Space');
  await page.keyboard.up('Control');
  await waitTool('brush');
  await page.keyboard.down('Alt');
  await page.keyboard.down('Space');
  await waitTool('zoom');
  assert.ok((await viewport.getAttribute('class')).includes('lighttable-viewport--zoom-out'));
  await page.keyboard.up('Alt');
  await page.keyboard.down('Space');
  await waitTool('view');
  assert.ok(!(await viewport.getAttribute('class')).includes('lighttable-viewport--zoom-out'));
  await page.keyboard.up('Space');
  await waitTool('brush');
  await page.keyboard.down('Space');
  await waitTool('view');
  // Browser blur exercises the keyboard terminal; native foreground suspension
  // is a separate lifecycle gate, not inferred from this synthetic event.
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.keyboard.up('Space');
  await waitTool('brush');
  assert.deepEqual(await pixels(), finalPixels, 'Temporary tools must not modify document pixels.');
  assert.equal((await driver.queryDocument(documentId)).history.undoDepth, opening.history.undoDepth + 3);
  const second = await driver.executeWorkspace('document.create', {
    name: 'Temporary override rebind', width: 320, height: 240, resolutionPpi: 72,
    bitDepth: 8, profile: 'srgb', background: { kind: 'solid', color: '#305090' }
  });
  await driver.waitForRenderedDocument(second.value.documentId, 60_000);
  // New-document initialization currently resets the persistent tool to Hand.
  // Establish Brush before testing whether a temporary override survives rebind.
  await page.keyboard.press('b');
  await waitTool('brush');
  await page.keyboard.down('Space');
  await waitTool('view');
  await page.locator('.ui-document-tabs__title', { hasText: 'Layer gesture ownership' }).click();
  await driver.waitForRenderedDocument(documentId, 60_000);
  await page.keyboard.up('Space');
  await waitTool('brush');
  assert.deepEqual(await pixels(), finalPixels, 'Tab rebind must preserve exact pixels.');
  await driver.execute(documentId, 'selection.applyShape', {
    mode: 'replace', shape: { kind: 'ellipse', points: [{ x: 80, y: 60 }, { x: 360, y: 250 }] },
    featherRadius: 6, antiAlias: true,
  });
  if (surfaceSelection === 'painted') {
    const begun = await driver.beginGesture({ documentId, kind: 'selection-paint', coordinateSpace: 'document',
      parameters: { mode: 'add', size: 22, hardness: 0.7, opacity: 0.6, smooth: 0 },
      sample: { x: 35, y: 65, pressure: 1 }, pointerId: 170 });
    assert.equal(begun.status, 'started');
    const updated = await driver.updateGesture(begun.gestureId, [
      { x: 42, y: 74, pressure: 0.7 }, { x: 55, y: 98, pressure: 1 },
    ]);
    assert.equal(updated.status, 'updated');
    assert.equal((await driver.finishGesture(begun.gestureId, true)).status, 'completed');
  }
  const selectionPixels = async () => {
    const copy = await driver.execute(documentId, 'selection.copyPixels', { source: 'active-layer' });
    const artifact = await driver.readArtifact(copy.value.artifact.id);
    return { bounds: copy.value.bounds,
      image: await sharp(artifact.bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true }) };
  };
  const initialSelectionPixels = await selectionPixels();
  await page.keyboard.press('Control+Alt+i');
  const imageSize = page.getByRole('dialog', { name: 'Image Size' });
  await imageSize.waitFor();
  await imageSize.getByLabel('Width', { exact: true }).fill('240');
  await imageSize.getByLabel('Width', { exact: true }).press('Enter');
  await imageSize.getByRole('button', { name: 'OK', exact: true }).click();
  const waitWidth = async width => {
    try {
      await page.waitForFunction(({ id, width }) =>
        window.__lightTableAutomation?.queryDocument(id)?.canvas?.width === width,
      { id: documentId, width });
    } catch (error) {
      const state = await driver.queryDocument(documentId);
      console.error(JSON.stringify({ width, state, text: (await page.locator('body').innerText()).slice(-2000), pageErrors }));
      await page.screenshot({ path: path.join(output, 'resize-failure.png') });
      throw error;
    }
  };
  await waitWidth(240);
  const resizedPixels = await pixels();
  const resizedSelectionPixels = await selectionPixels();
  await page.locator('.ui-document-tabs__title', { hasText: 'Temporary override rebind' }).click();
  await driver.waitForRenderedDocument(second.value.documentId, 60_000);
  await page.locator('.ui-document-tabs__title', { hasText: 'Layer gesture ownership' }).click();
  await driver.waitForRenderedDocument(documentId, 60_000);
  await page.waitForFunction(() => document.querySelector('.lighttable-viewport')?.getAttribute('aria-busy') === 'false');
  await page.keyboard.press('Control+z');
  await waitWidth(480);
  assert.deepEqual(await pixels(), finalPixels, 'Resize undo after tab rebind must restore exact pixels.');
  assert.deepEqual(await selectionPixels(), initialSelectionPixels, 'Resize undo must restore the feathered selection copy area.');
  await page.keyboard.press('Control+Shift+z');
  await waitWidth(240);
  assert.deepEqual(await pixels(), resizedPixels, 'Resize redo after rebind must restore exact resized pixels.');
  assert.deepEqual(await selectionPixels(), resizedSelectionPixels, 'Resize redo must restore exact selection coverage.');
  await driver.execute(documentId, 'document.applyGeometry', { operation: 'rotate', rotation: 'clockwise-90' });
  await waitWidth(160);
  const rotatedPixels = await pixels();
  const rotatedSelectionPixels = await selectionPixels();
  await page.locator('.ui-document-tabs__title', { hasText: 'Temporary override rebind' }).click();
  await driver.waitForRenderedDocument(second.value.documentId, 60_000);
  await page.locator('.ui-document-tabs__title', { hasText: 'Layer gesture ownership' }).click();
  await driver.waitForRenderedDocument(documentId, 60_000);
  await page.keyboard.press('Control+z');
  await waitWidth(240);
  assert.deepEqual(await pixels(), resizedPixels, 'Geometry undo after rebind must restore exact pixels.');
  assert.deepEqual(await selectionPixels(), resizedSelectionPixels, 'Geometry undo must restore exact selection coverage.');
  await page.keyboard.press('Control+Shift+z');
  await waitWidth(160);
  assert.deepEqual(await pixels(), rotatedPixels, 'Geometry redo after rebind must restore exact pixels.');
  assert.deepEqual(await selectionPixels(), rotatedSelectionPixels, 'Geometry redo must restore exact selection coverage.');
  assert.deepEqual(pageErrors, []);
  await page.screenshot({ path: path.join(output, 'final.png') });
  await writeFile(path.join(output, 'report.json'), JSON.stringify({
    status: 'passed', samples, exactUndoRedo: true, resizeRebindUndoRedo: true, geometryRebindUndoRedo: true,
    exactSelectionCopy: true, surfaceSelection,
    temporaryOverrides: 'pan/zoom/overlap/browser-blur/tab-rebind', pageErrors
  }, null, 2));
  console.log(`Packaged layer gesture/history smoke passed: ${output}`);
} catch (error) {
  await writeFile(path.join(output, 'report.json'), JSON.stringify({
    status: 'failed', error: error instanceof Error ? error.message : String(error), pageErrors,
  }, null, 2));
  if (app) await (await app.firstWindow()).screenshot({ path: path.join(output, 'failure.png') });
  throw error;
} finally {
  await app?.close();
}
