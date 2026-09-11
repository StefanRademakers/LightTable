import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { _electron as electron } from 'playwright-core';
import sharp from 'sharp';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';
import { verifyAttachedGradeInspector } from './processing-rebind-attached-grade.mjs';
import { resolveDesktopTestLaunch, waitForDesktopLauncher } from './desktop-test-startup.mjs';

const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, 'tmp', 'processing-rebind');
await mkdir(output, { recursive: true });
const profile = await mkdtemp(path.join(output, 'profile-'));
const launch = await resolveDesktopTestLaunch(root, { requirePackaged: true });
const environment = { ...process.env, LIGHTTABLE_AUTOMATION_USER_DATA: profile };
delete environment.ELECTRON_RUN_AS_NODE;
const report = { status: 'running', pageErrors: [], checks: [], timings: [] };
let app;
try {
  app = await electron.launch({ executablePath: launch.executablePath, args: launch.args,
    cwd: root, env: environment, timeout: 30_000 });
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.show(); window.focus(); });
  page.on('pageerror', error => report.pageErrors.push(error.message));
  await waitForDesktopLauncher({ app, page, outputDirectory: output, sourceFile: null,
    pageErrors: report.pageErrors, label: 'processing-rebind' });
  const driver = await attachLightTableAutomation(page, 'processing-rebind');
  const ready = async id => {
    // Session revision includes global processing; telemetry's document revision
    // is ImageDocument.revision. They are not comparable. Require this renderer's
    // completed open and first composite, then read uncached final-output pixels.
    await page.waitForFunction(id => {
      const api = window.__lightTableAutomation;
      const doc = api?.queryDocument(id);
      const frame = api?.queryRenderTelemetry(id);
      return api?.queryWorkspace().activeDocumentId === id
        && doc?.lifecycle === 'ready' && doc.renderer.status === 'ready'
        && doc.renderer.active && doc.tasks.activeCount === 0
        && frame?.submittedFrames > 0 && frame.stages['document-composite'].executions > 0;
    }, id);
  };
  const create = async (name, color) => {
    const result = await driver.executeWorkspace('document.create', {
      name, width: 320, height: 240, resolutionPpi: 72, bitDepth: 8, profile: 'srgb',
      background: { kind: 'solid', color }
    });
    const id = result.value?.documentId; assert.ok(id);
    await ready(id); return id;
  };
  const pixels = async id => {
    const exported = await driver.execute(id, 'file.exportPng', {}, { requireCompleted: false });
    const task = await driver.waitForTask(id, exported.taskId);
    assert.ok(task.artifact?.id, JSON.stringify(task));
    const artifact = await driver.readArtifact(task.artifact.id);
    assert.ok(artifact?.bytes?.length);
    return sharp(artifact.bytes).ensureAlpha().raw().toBuffer();
  };
  const activate = async id => {
    const ws = await driver.queryWorkspace();
    const index = ws.documents.findIndex(document => document.id === id); assert.ok(index >= 0);
    const before = await driver.queryDocument(id);
    const start = performance.now();
    await page.locator('.ui-document-tabs__tab').nth(index).locator('.ui-document-tabs__title').click();
    await ready(id);
    const after = await driver.queryDocument(id);
    assert.equal(after.canonicalRevision, before.canonicalRevision);
    assert.equal(after.history.undoDepth, before.history.undoDepth);
    report.timings.push({ tab: id, driverClickToReadyMs: performance.now() - start });
  };
  const a = await create('Processing A', '#805030');
  const originalA = await pixels(a);
  await driver.execute(a, 'grade.setBasic', { target: { kind: 'document' }, values: { exposureEV: 1 } });
  const documentGradeA = await pixels(a);
  assert.notDeepEqual(documentGradeA, originalA);
  const layer = (await driver.queryLayers(a))[0];
  await driver.execute(a, 'grade.setBasic', { target: { kind: 'layer', layerId: layer.id }, values: { exposureEV: -0.5 } });
  const combinedA = await pixels(a);
  assert.notDeepEqual(combinedA, documentGradeA);
  const b = await create('Processing B', '#206080');
  await driver.execute(b, 'grade.setBasic', { target: { kind: 'document' }, values: { exposureEV: -1 } });
  const gradedB = await pixels(b);
  for (const id of [a, b, a, b, a]) {
    await activate(id);
    assert.deepEqual(await pixels(id), id === a ? combinedA : gradedB, 'Rebind changed processing pixels.');
  }
  report.checks.push('Document/global and raster-local Grade remain isolated across real tab transitions.');
  await driver.execute(a, 'history.undo', {});
  assert.deepEqual(await pixels(a), documentGradeA, 'Undo local Grade changed global processing.');
  await driver.execute(a, 'history.undo', {});
  assert.deepEqual(await pixels(a), originalA, 'Undo document Grade did not restore original pixels.');
  await driver.execute(a, 'history.redo', {});
  assert.deepEqual(await pixels(a), documentGradeA);
  await driver.execute(a, 'history.redo', {});
  assert.deepEqual(await pixels(a), combinedA);
  report.checks.push('Retained processing history replays exact pixels after same-mounted-editor tab rebind.');
  // Local inspector must also follow the restored history, not an old binding's store.
  await page.getByRole('treeitem', { name: /Background/ }).click();
  const exposure = page.getByRole('slider', { name: 'Exposure', exact: true });
  await exposure.waitFor({ state: 'visible' });
  assert.equal(Number(await exposure.inputValue()), -0.5);
  await driver.execute(a, 'history.undo', {});
  await page.waitForFunction(() => Number(document.querySelector('input[aria-label="Exposure"]')?.value) === 0);
  await driver.execute(a, 'history.redo', {});
  await page.waitForFunction(() => Number(document.querySelector('input[aria-label="Exposure"]')?.value) === -0.5);
  report.checks.push('Current local Exposure control follows undo/redo after rebind.');
  await page.getByRole('tab', { name: 'Properties', exact: true }).click();
  report.checks.push(await verifyAttachedGradeInspector({ page, driver, documentId: a, layerId: layer.id, pixels }));
  await page.screenshot({ path: path.join(output, 'final.png') });
  assert.deepEqual(report.pageErrors, []);
  report.status = 'passed';
  console.log(`Packaged processing rebind passed: ${output}`);
} catch (error) {
  report.status = 'failed'; report.error = error.stack ?? String(error); throw error;
} finally {
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  if (app) await app.close();
}
