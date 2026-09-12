import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { _electron as electron } from 'playwright-core';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';
import { resolveDesktopTestLaunch, waitForDesktopLauncher } from './desktop-test-startup.mjs';

const root = path.resolve(import.meta.dirname, '..');
const directory = path.join(root, 'tmp', 'painted-selection-mask');
await mkdir(directory, { recursive: true });
const output = await mkdtemp(path.join(directory, 'run-'));
const environment = { ...process.env }; delete environment.ELECTRON_RUN_AS_NODE;
const pageErrors = []; let app; let page;
try {
  const launch = await resolveDesktopTestLaunch(root, { requirePackaged: true });
  app = await electron.launch({ executablePath: launch.executablePath, args: launch.args,
    cwd: root, env: { ...environment, LIGHTTABLE_AUTOMATION_USER_DATA: path.join(output, 'profile') } });
  page = await app.firstWindow();
  page.on('pageerror', error => pageErrors.push(error.stack ?? error.message));
  await waitForDesktopLauncher({ app, page, outputDirectory: output, sourceFile: null,
    pageErrors, label: 'painted-selection-mask' });
  const driver = await attachLightTableAutomation(page, 'painted-selection-mask');
  const created = await driver.executeWorkspace('document.create', {
    name: 'Painted selection mask', width: 256, height: 192, resolutionPpi: 72,
    bitDepth: 8, profile: 'srgb', background: { kind: 'solid', color: '#4d80b3' }
  });
  const id = created.value?.documentId; assert.ok(id);
  await driver.waitForReadyDocument(id, 60000);
  const pixels = async label => {
    const accepted = await driver.execute(id, 'file.exportPng', {}, { requireCompleted: false });
    const task = await driver.waitForTask(id, accepted.taskId);
    const artifact = await driver.readArtifact(task.artifact.id);
    await writeFile(path.join(output, `${label}.png`), artifact.bytes);
    return sharp(artifact.bytes).ensureAlpha().raw().toBuffer();
  };
  const original = await pixels('original');
  const opening = await driver.queryDocument(id);
  const gesture = await driver.beginGesture({ documentId: id, kind: 'selection-paint',
    coordinateSpace: 'document', parameters: { mode: 'replace', size: 32, hardness: 1, opacity: 1, smooth: 0 },
    sample: { x: 100, y: 80, pressure: 1 } });
  assert.equal(gesture.status, 'started', JSON.stringify(gesture));
  await driver.updateGesture(gesture.gestureId, [{ x: 130, y: 80, pressure: 1 }]);
  await driver.finishGesture(gesture.gestureId, true);
  await page.waitForFunction(({ id, depth }) =>
    window.__lightTableAutomation?.queryDocument(id)?.history.undoDepth === depth,
  { id, depth: opening.history.undoDepth + 1 }, { timeout: 30000 });
  const before = await driver.queryDocument(id);
  await writeFile(path.join(output, 'before-mask.json'), JSON.stringify(before, null, 2));
  await page.getByRole('button', { name: 'Add layer mask', exact: true }).click();
  await page.waitForFunction(({ id, depth }) =>
    window.__lightTableAutomation?.queryDocument(id)?.history.undoDepth === depth,
  { id, depth: before.history.undoDepth + 1 }, { timeout: 30000 });
  const masked = await pixels('masked');
  assert.equal(masked[(80 * 256 + 110) * 4 + 3], 255, 'Painted center must remain opaque');
  assert.equal(masked[(10 * 256 + 10) * 4 + 3], 0, 'Add Mask must use painted coverage, not reveal-all');
  await driver.execute(id, 'history.undo');
  assert.deepEqual(await pixels('undo'), original);
  await driver.execute(id, 'history.redo');
  assert.deepEqual(await pixels('redo'), masked);
  assert.equal(pageErrors.length, 0, JSON.stringify(pageErrors));
  await page.screenshot({ path: path.join(output, 'result.png') });
  await writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', pageErrors }, null, 2));
  process.stdout.write(`Painted selection Add Mask passed: ${output}\n`);
} catch (error) {
  await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
  await writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'failed', error: String(error), pageErrors }, null, 2));
  throw error;
} finally { await app?.close(); }
