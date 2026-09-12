import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { _electron as electron } from 'playwright-core';
import { resolveDesktopTestLaunch, waitForDesktopLauncher } from './desktop-test-startup.mjs';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';

const root = path.resolve(import.meta.dirname, '..');
const directory = path.join(root, 'tmp', 'viewport-wheel-smoke');
await mkdir(directory, { recursive: true });
const output = await mkdtemp(path.join(directory, 'run-'));
const userData = path.join(output, 'profile');
const environment = { ...process.env }; delete environment.ELECTRON_RUN_AS_NODE;
const pageErrors = []; const observations = []; let app; let page;
try {
  const launch = await resolveDesktopTestLaunch(root, { requirePackaged: true });
  app = await electron.launch({ executablePath: launch.executablePath, args: launch.args,
    cwd: root, env: { ...environment, LIGHTTABLE_AUTOMATION_USER_DATA: userData } });
  page = await app.firstWindow();
  page.on('pageerror', error => pageErrors.push(error.stack ?? error.message));
  await page.evaluate(() => localStorage.setItem('lighttable:preferences', JSON.stringify({
    version: 1, autosave: { enabled: true, intervalMs: 30000 },
    tools: { zoomWithScrollWheel: false, openMaskEditingOnDoubleClick: true }
  })));
  await page.reload();
  await waitForDesktopLauncher({ app, page, outputDirectory: output, sourceFile: null,
    pageErrors, label: 'viewport-wheel' });
  const driver = await attachLightTableAutomation(page, 'viewport-wheel');
  const created = await driver.executeWorkspace('document.create', {
    name: 'Wheel owner', width: 640, height: 480, resolutionPpi: 72, bitDepth: 8,
    profile: 'srgb', background: { kind: 'solid', color: '#386aa8' }
  });
  const documentId = created.value?.documentId; assert.ok(documentId);
  await driver.waitForReadyDocument(documentId, 60000);
  await page.keyboard.press('Control+1');
  const viewport = page.locator('.lighttable-viewport');
  await viewport.waitFor({ state: 'visible' });
  const read = () => driver.queryDocument(documentId);
  const digest = async () => {
    // Fresh final-output export, not a same-revision cached preview artifact.
    const exported = await driver.execute(documentId, 'file.exportPng', {}, { requireCompleted: false });
    const task = await driver.waitForTask(documentId, exported.taskId);
    assert.ok(task.artifact?.id);
    const artifact = await driver.readArtifact(task.artifact.id);
    assert.ok(artifact?.bytes?.length);
    return createHash('sha256').update(artifact.bytes).digest('hex');
  };
  const baseline = await read(); const baselinePixels = await digest();
  const exercise = async (label, native = false, outside = false) => {
    const before = await read();
    // Dispatch on the real viewport DOM. Native case emulates the public Electron
    // bridge event; this is not proof of a physical horizontal-wheel device.
    const prevented = await viewport.evaluate((element, { native, outside }) => {
      const rect = element.getBoundingClientRect();
      const clientX = outside ? rect.left - 10 : rect.left + rect.width / 2;
      const clientY = rect.top + rect.height / 2;
      const event = native
        ? new CustomEvent('lighttable:desktop-horizontal-wheel', {
          bubbles: true, detail: { clientX, clientY, deltaX: 24 } })
        : new WheelEvent('wheel', { bubbles: true, cancelable: true,
          clientX, clientY, deltaX: 24, deltaY: 0 });
      (outside ? window : element).dispatchEvent(event); return event.defaultPrevented;
    }, { native, outside });
    let after = await read();
    if (!outside) {
      const deadline = Date.now() + 3000;
      while (after.viewport.panX === before.viewport.panX && Date.now() < deadline) {
        await page.waitForTimeout(20); after = await read();
      }
      assert.equal(after.viewport.panX, before.viewport.panX - 24, `${label}: exact single pan`);
    } else {
      await page.waitForTimeout(100); after = await read();
      assert.equal(after.viewport.panX, before.viewport.panX, `${label}: outside must not pan`);
    }
    assert.equal(after.viewport.panY, before.viewport.panY);
    assert.equal(after.viewport.scale, before.viewport.scale);
    if (!native) assert.equal(prevented, !outside);
    assert.equal(after.canonicalRevision, baseline.canonicalRevision);
    assert.deepEqual(after.history, baseline.history);
    observations.push({ label, before: before.viewport, after: after.viewport, prevented });
  };
  await exercise('renderer horizontal wheel');
  await exercise('native bridge horizontal wheel', true);
  await exercise('outside viewport', false, true);
  await page.getByRole('radio', { name: 'Switch to Grading workspace' }).click();
  await exercise('Grading workspace rebind');
  await page.getByRole('radio', { name: 'Switch to Photo edit workspace' }).click();
  await exercise('Photo edit workspace rebind', true);
  assert.equal(await digest(), baselinePixels, 'Wheel navigation changed document pixels');
  assert.deepEqual(pageErrors, []);
  await page.screenshot({ path: path.join(output, 'final.png') });
  await writeFile(path.join(output, 'report.json'), JSON.stringify({ passed: true, observations, pageErrors }, null, 2));
  console.log(`Viewport wheel routing/rebind and unchanged pixels/history passed: ${output}`);
} catch (error) {
  await writeFile(path.join(output, 'report.json'), JSON.stringify({ passed: false, observations,
    pageErrors, error: error.stack ?? String(error) }, null, 2));
  if (page) await page.screenshot({ path: path.join(output, 'failure.png') });
  throw error;
} finally { await app?.close(); }
