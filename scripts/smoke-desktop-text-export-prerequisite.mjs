import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { _electron as electron } from 'playwright-core';
import { resolveDesktopTestLaunch, waitForDesktopLauncher } from './desktop-test-startup.mjs';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';

const root = path.resolve(import.meta.dirname, '..');
const point = process.argv.includes('--point');
const directory = path.join(root, 'tmp/text-export-prerequisite-smoke'); await mkdir(directory, { recursive: true });
const output = await mkdtemp(path.join(directory, 'run-'));
const report = { passed: false, creation: point ? 'short-drag point conversion' : 'paragraph drag', pageErrors: [], limitations: [
  'Actual held Type drag then semantic export; no injected private text/session state.',
  'Already-queued child, controlled cold readiness and cancellation ordering require service integration tests.'
] };
let app, page;
try {
  const launch = await resolveDesktopTestLaunch(root, { requirePackaged: true });
  const environment = { ...process.env }; delete environment.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ executablePath: launch.executablePath, args: launch.args, cwd: root,
    env: { ...environment, LIGHTTABLE_AUTOMATION_USER_DATA: path.join(output, 'profile') } });
  page = await app.firstWindow(); page.on('pageerror', error => report.pageErrors.push(error.stack || error.message || String(error)));
  await waitForDesktopLauncher({ app, page, outputDirectory: output, sourceFile: null,
    pageErrors: report.pageErrors, label: 'text-export-prerequisite' });
  const driver = await attachLightTableAutomation(page, 'text-export-prerequisite');
  const created = await driver.executeWorkspace('document.create', { name: 'Text export prerequisite', width: 640, height: 480,
    resolutionPpi: 72, bitDepth: 8, profile: 'srgb', background: { kind: 'solid', color: '#c0d0e0' } });
  const id = created.value?.documentId; assert.ok(id); await driver.waitForReadyDocument(id, 60000);
  const png = async label => {
    const accepted = await driver.execute(id, 'file.exportPng', {}, { requireCompleted: false });
    report[label + 'Result'] = accepted;
    assert.equal(accepted.status, 'accepted', JSON.stringify(accepted));
    const task = await driver.waitForTask(id, accepted.taskId); assert.ok(task.artifact?.id);
    const artifact = await driver.readArtifact(task.artifact.id); assert.ok(artifact?.bytes?.length);
    await writeFile(path.join(output, label + '.png'), artifact.bytes);
    return sharp(artifact.bytes).ensureAlpha().raw().toBuffer();
  };
  const beforePixels = await png('before');
  const before = await driver.queryDocument(id);
  await driver.startActionRecording('Pending Type export');
  await page.keyboard.press('t');
  const box = await page.locator('.lighttable-viewport__canvas').boundingBox(); assert.ok(box);
  await page.mouse.move(box.x + box.width * .25, box.y + box.height * .3);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * (point ? .25 : .7),
    box.y + box.height * (point ? .3 : .65), { steps: point ? 1 : 4 });
  await page.screenshot({ path: path.join(output, 'pending.png') });
  const exported = await png('export');
  await page.mouse.up();
  await driver.stopActionRecording(); report.recording = await driver.queryActionRecording();
  assert.deepEqual(report.recording.steps.map(step => step.command), ['text.create', 'file.exportPng']);
  const after = await driver.queryDocument(id);
  assert.equal(after.history.undoDepth, before.history.undoDepth + 1);
  assert.notDeepEqual(exported, beforePixels);
  await driver.execute(id, 'history.undo', {}); assert.deepEqual(await png('undo'), beforePixels);
  await driver.execute(id, 'history.redo', {}); assert.deepEqual(await png('redo'), exported);
  assert.deepEqual(report.pageErrors, []); report.passed = true;
  await page.screenshot({ path: path.join(output, 'final.png') });
  console.log(`Text export prerequisite passed: ${output}`);
} catch (error) {
  report.error = error.stack ?? String(error);
  if (page) { await page.screenshot({ path: path.join(output, 'failure.png') }); report.body = await page.locator('body').innerText(); }
  throw error;
} finally {
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  if (app) await app.close();
}
