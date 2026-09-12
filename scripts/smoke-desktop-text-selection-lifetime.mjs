import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { _electron as electron } from 'playwright-core';
import { resolveDesktopTestLaunch, waitForDesktopLauncher } from './desktop-test-startup.mjs';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';

const root = path.resolve(import.meta.dirname, '..');
const directory = path.join(root, 'tmp', 'text-selection-lifetime-smoke');
await mkdir(directory, { recursive: true });
const output = await mkdtemp(path.join(directory, 'run-'));
const report = { passed: false, pageErrors: [], observations: [], limitations: [
  'Real packaged pointer/input/tab interactions and public queries; no private state injection.',
  'No forced callback-after-cancellation, equal-ID session replacement, or React scheduling race; focused tests cover those lifetimes.',
  'Assertions concern exact authored text/history and Actions; screenshots are visual evidence, not pixel-equality gates.'
] };
let app, page;
try {
  const launch = await resolveDesktopTestLaunch(root, { requirePackaged: true });
  report.executablePath = launch.executablePath;
  report.packageSha256 = createHash('sha256').update(await readFile(
    path.join(path.dirname(launch.executablePath), 'resources', 'app.asar'))).digest('hex');
  const environment = { ...process.env }; delete environment.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ executablePath: launch.executablePath, args: launch.args, cwd: root,
    env: { ...environment, LIGHTTABLE_AUTOMATION_USER_DATA: path.join(output, 'profile') } });
  page = await app.firstWindow();
  page.on('pageerror', error => report.pageErrors.push(error.stack ?? error.message));
  await waitForDesktopLauncher({ app, page, outputDirectory: output, sourceFile: null,
    pageErrors: report.pageErrors, label: 'text-selection-lifetime' });
  const driver = await attachLightTableAutomation(page, 'text-selection-lifetime');
  const create = async name => {
    const result = await driver.executeWorkspace('document.create', { name, width: 640, height: 400,
      resolutionPpi: 72, bitDepth: 8, profile: 'srgb', background: { kind: 'solid', color: '#eee8dc' } });
    const id = result.value?.documentId; assert.ok(id);
    await driver.waitForReadyDocument(id, 60000); return id;
  };
  const activate = async (id, name) => {
    await page.getByRole('tab', { name: new RegExp(name) }).click();
    await driver.waitForReadyDocument(id, 60000);
    assert.equal((await driver.queryWorkspace()).activeDocumentId, id);
  };
  const waitText = async (id, layerId, text) => {
    await page.waitForFunction(({ id, layerId, text }) =>
      window.__lightTableAutomation.queryText(id, layerId)?.content?.text === text,
    { id, layerId, text }, { timeout: 30000 });
    assert.equal((await driver.queryText(id, layerId)).content.text, text);
  };
  const waitHistory = async (id, depth) => {
    await page.waitForFunction(({ id, depth }) =>
      window.__lightTableAutomation.queryDocument(id)?.history.undoDepth === depth,
    { id, depth }, { timeout: 30000 });
    assert.equal((await driver.queryDocument(id)).history.undoDepth, depth);
  };
  const b = await create('Selection lifetime B');
  const beforeB = await driver.queryDocument(b), layersB = await driver.queryLayers(b);
  const a = await create('Selection lifetime A');
  report.documents = { a, b };
  await page.keyboard.press('t');
  const size = page.locator('.lighttable-tool-options').getByLabel('Size');
  await size.fill('24'); await size.press('Enter');
  const coordinates = async () => {
    const box = await page.locator('.lighttable-viewport__canvas').boundingBox(); assert.ok(box);
    return { x: box.x + box.width * .1, y: box.y + box.height * .2, scale: box.width / 640 };
  };
  const origin = await coordinates();
  await page.mouse.move(origin.x, origin.y); await page.mouse.down();
  await page.mouse.move(origin.x + 480 * origin.scale, origin.y + 150 * origin.scale, { steps: 8 });
  await page.mouse.up();
  const input = page.locator('.lighttable-text-input-bridge');
  await input.waitFor({ state: 'attached', timeout: 30000 });
  const waitInput = async expected => {
    await page.waitForFunction(text => document.querySelector('.lighttable-text-input-bridge')?.value === text,
      expected, { timeout: 30000 });
    assert.equal(await input.inputValue(), expected);
  };
  const originalText = 'Alpha bravo charlie delta echo.';
  await input.press('Control+A');
  await input.pressSequentially(originalText);
  await waitInput(originalText);
  await input.press('Control+Enter');
  const textLayers = (await driver.queryLayers(a)).filter(layer => layer.type === 'text');
  assert.equal(textLayers.length, 1); const layerId = textLayers[0].id;
  report.layerId = layerId;
  await waitText(a, layerId, originalText);
  const baseline = await driver.queryDocument(a);

  await driver.startActionRecording('Real text drag replacement');
  const point = await coordinates();
  await page.mouse.dblclick(point.x + 30 * point.scale, point.y + 14 * point.scale, { delay: 45 });
  await input.waitFor({ state: 'attached' });
  await page.mouse.move(point.x + 12 * point.scale, point.y + 14 * point.scale);
  await page.mouse.down();
  await page.mouse.move(point.x + 150 * point.scale, point.y + 14 * point.scale, { steps: 16 });
  await page.mouse.up();
  await page.waitForFunction(() => {
    const bridge = document.querySelector('.lighttable-text-input-bridge');
    return bridge instanceof HTMLTextAreaElement && bridge.selectionStart < bridge.selectionEnd;
  });
  const selection = await input.evaluate(bridge => ({ start: bridge.selectionStart,
    end: bridge.selectionEnd, text: bridge.value.slice(bridge.selectionStart, bridge.selectionEnd) }));
  assert.ok(selection.start < selection.end && selection.end <= originalText.length);
  assert.ok(selection.text.length < originalText.length, 'The pointer drag must select a proper text subset');
  assert.equal(selection.text, originalText.slice(selection.start, selection.end));
  assert.equal((await driver.queryDocument(a)).history.undoDepth, baseline.history.undoDepth,
    'Caret and drag selection must not create document history');
  await page.screenshot({ path: path.join(output, 'drag-selection.png') });
  const replacement = 'REPLACED';
  const replacedText = originalText.slice(0, selection.start) + replacement + originalText.slice(selection.end);
  await input.pressSequentially(replacement); await waitInput(replacedText);
  await input.press('Control+Enter');
  await waitText(a, layerId, replacedText); await waitHistory(a, baseline.history.undoDepth + 1);
  await driver.stopActionRecording(); report.replacementRecording = await driver.queryActionRecording();
  assert.deepEqual(report.replacementRecording.steps.map(step => step.command), ['text.replaceRange']);
  assert.equal(report.replacementRecording.steps[0].documentId, a);
  assert.equal(report.replacementRecording.steps[0].parameters.text, replacement);
  assert.equal(report.replacementRecording.steps[0].parameters.start, selection.start);
  assert.equal(report.replacementRecording.steps[0].parameters.end, selection.end);
  await driver.execute(a, 'history.undo', {}); await waitText(a, layerId, originalText);
  await waitHistory(a, baseline.history.undoDepth);
  await driver.execute(a, 'history.redo', {}); await waitText(a, layerId, replacedText);
  await waitHistory(a, baseline.history.undoDepth + 1);
  report.observations.push({ kind: 'real pointer selection and replacement', selection, replacedText,
    historyDelta: 1, exactTextUndoRedo: true, observedCommands: 1 });

  await driver.startActionRecording('Typing commits to original document on tab change');
  const reentry = await coordinates();
  await page.mouse.dblclick(reentry.x + 30 * reentry.scale, reentry.y + 14 * reentry.scale, { delay: 45 });
  await input.waitFor({ state: 'attached' }); await input.press('Control+End');
  const suffix = ' original document';
  await input.pressSequentially(suffix);
  await waitInput(replacedText + suffix);
  const beforeSwitch = await driver.queryDocument(a);
  assert.equal(beforeSwitch.history.undoDepth, baseline.history.undoDepth + 1,
    'Typing must still be pending before the real document tab click');
  await page.screenshot({ path: path.join(output, 'pending-typing.png') });
  await activate(b, 'Selection lifetime B');
  await waitText(a, layerId, replacedText + suffix);
  await waitHistory(a, baseline.history.undoDepth + 2);
  assert.deepEqual(await driver.queryLayers(b), layersB);
  const afterB = await driver.queryDocument(b);
  assert.equal(afterB.canonicalRevision, beforeB.canonicalRevision);
  assert.deepEqual(afterB.history, beforeB.history);
  await driver.stopActionRecording(); report.switchRecording = await driver.queryActionRecording();
  // Start resumes the existing Actions recording; the first step must remain
  // identical and the tab terminal must append exactly one original-document edit.
  assert.deepEqual(report.switchRecording.steps.map(step => step.command), ['text.replaceRange', 'text.replaceRange']);
  assert.deepEqual(report.switchRecording.steps[0], report.replacementRecording.steps[0]);
  assert.equal(report.switchRecording.steps[1].documentId, a);
  assert.equal(report.switchRecording.steps[1].parameters.text, suffix);
  assert.equal(report.switchRecording.steps[1].parameters.start, replacedText.length);
  assert.equal(report.switchRecording.steps[1].parameters.end, replacedText.length);
  await activate(a, 'Selection lifetime A');
  await driver.execute(a, 'history.undo', {}); await waitText(a, layerId, replacedText);
  await driver.execute(a, 'history.redo', {}); await waitText(a, layerId, replacedText + suffix);
  assert.equal((await driver.queryDocument(b)).canonicalRevision, beforeB.canonicalRevision);
  report.observations.push({ kind: 'pending typing then real tab switch', originalDocument: a,
    successorDocument: b, exactOriginalText: replacedText + suffix, successorUnchanged: true,
    historyDelta: 1, observedCommands: 1, exactTextUndoRedo: true });
  assert.deepEqual(report.pageErrors, []);
  await page.screenshot({ path: path.join(output, 'final-ui.png') });
  report.passed = true; console.log(`Text selection lifetime passed: ${output}`);
} catch (error) {
  report.error = error.stack ?? String(error);
  if (page) {
    await page.screenshot({ path: path.join(output, 'failure.png') });
    report.body = await page.locator('body').innerText();
  }
  throw error;
} finally {
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  await app?.close();
}
