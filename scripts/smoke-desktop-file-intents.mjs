import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { _electron as electron } from 'playwright-core';
import { resolveDesktopTestLaunch, waitForDesktopLauncher } from './desktop-test-startup.mjs';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';

const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, 'tmp', 'file-intents');
await mkdir(output, { recursive: true });
const run = await mkdtemp(path.join(output, 'run-'));
const sourceFile = path.join(run, 'source.png');
const saveTarget = path.join(run, 'source-lighttable.png');
await sharp({ create: { width: 512, height: 384, channels: 4, background: '#386aa8ff' } })
  .png().toFile(sourceFile);
const launch = await resolveDesktopTestLaunch(root, { requirePackaged: true });
const env = { ...process.env, LIGHTTABLE_AUTOMATION_USER_DATA: path.join(run, 'profile'),
  LIGHTTABLE_AUTOMATION_OPEN_FILE: sourceFile, LIGHTTABLE_AUTOMATION_SAVE_FILE: saveTarget };
delete env.ELECTRON_RUN_AS_NODE;
const report = { passed: false, run, pageErrors: [] };
let app;
try {
  app = await electron.launch({ executablePath: launch.executablePath, args: launch.args, cwd: root, env });
  const page = await app.firstWindow();
  page.on('pageerror', error => report.pageErrors.push(String(error.stack ?? error)));
  const open = await waitForDesktopLauncher({ app, page, outputDirectory: run, sourceFile,
    pageErrors: report.pageErrors, label: 'file-intents' });
  await open.click();
  const driver = await attachLightTableAutomation(page, 'file-intents');
  const id = (await driver.queryWorkspace()).activeDocumentId;
  await driver.waitForReadyDocument(id, 60_000);
  const opening = await driver.queryDocument(id);
  assert.equal(opening.dirty, false, 'Save precondition must be a clean source document');
  await page.keyboard.press('Control+t');
  const body = page.locator('.lighttable-transform__body');
  await body.waitFor();
  const box = await body.boundingBox();
  assert.ok(box);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 45, box.y + box.height / 2 + 25, { steps: 6 });
  await page.mouse.up();
  assert.equal((await driver.queryDocument(id)).history.undoDepth, opening.history.undoDepth,
    'Transform must still be uncommitted when Save is requested');
  await page.screenshot({ path: path.join(run, 'pending-transform.png') });
  await page.keyboard.press('Control+s');
  let saved;
  const deadline = Date.now() + 60_000;
  while (!saved && Date.now() < deadline) {
    try { saved = await readFile(saveTarget); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!saved) await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.ok(saved?.length, 'Save skipped the pending transform on a clean source');
  await page.waitForFunction(({ id, depth }) => {
    const state = window.__lightTableAutomation?.queryDocument(id);
    return state?.history.undoDepth === depth && !state.dirty && state.tasks.activeCount === 0;
  }, { id, depth: opening.history.undoDepth + 1 }, { timeout: 30_000 });
  const afterSave = await driver.queryDocument(id);
  assert.equal(afterSave.history.undoDepth, opening.history.undoDepth + 1);
  assert.equal(afterSave.dirty, false);
  const preview = await driver.requestDocumentPreview(id, afterSave.canonicalRevision, 512);
  const artifact = await driver.readArtifact(preview?.artifact?.id ?? preview?.id);
  assert.ok(artifact?.bytes?.length);
  const savedPixels = await sharp(saved).ensureAlpha().raw().toBuffer();
  const currentPixels = await sharp(artifact.bytes).ensureAlpha().raw().toBuffer();
  assert.deepEqual(savedPixels, currentPixels, 'Save did not capture the committed transform pixels');
  assert.notDeepEqual(savedPixels, await sharp(sourceFile).ensureAlpha().raw().toBuffer());
  // First Type activation: request Save immediately after the click, without
  // waiting for the font/creation continuation or manually committing text.
  await page.keyboard.press('t');
  const canvasBox = await page.locator('.lighttable-viewport__canvas').boundingBox();
  assert.ok(canvasBox);
  await page.mouse.click(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);
  await page.keyboard.press('Control+s');
  await page.waitForFunction(id => {
    const api = window.__lightTableAutomation;
    const state = api?.queryDocument(id);
    return api?.queryLayers(id)?.some(layer => layer.type === 'text') && state && !state.dirty
      && state.tasks.activeCount === 0;
  }, id, { timeout: 60_000 });
  const textSaved = await readFile(saveTarget);
  assert.notDeepEqual(textSaved, saved, 'Immediate Type/Save did not update the saved document');
  const textState = await driver.queryDocument(id);
  const textPreview = await driver.requestDocumentPreview(id, textState.canonicalRevision, 512);
  const textArtifact = await driver.readArtifact(textPreview?.artifact?.id ?? textPreview?.id);
  assert.ok(textArtifact?.bytes?.length);
  assert.deepEqual(await sharp(textSaved).ensureAlpha().raw().toBuffer(),
    await sharp(textArtifact.bytes).ensureAlpha().raw().toBuffer(),
    'Immediate Type/Save did not capture the current text pixels');
  assert.deepEqual(report.pageErrors, []);
  report.passed = true;
  report.transformSave = { startedClean: true, committedOnce: true, exactSavedPixels: true };
  report.typeSave = { immediateAfterClick: true, textLayerRetained: true, exactSavedPixels: true };
  console.log(`Packaged file intent smoke passed: ${run}`);
} catch (error) {
  report.error = String(error.stack ?? error);
  throw error;
} finally {
  await writeFile(path.join(run, 'report.json'), JSON.stringify(report, null, 2));
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  await app?.close();
}
