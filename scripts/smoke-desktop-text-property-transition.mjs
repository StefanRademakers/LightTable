import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { _electron as electron } from 'playwright-core';
import { resolveDesktopTestLaunch, waitForDesktopLauncher } from './desktop-test-startup.mjs';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';

const root = path.resolve(import.meta.dirname, '..');
const directory = path.join(root, 'tmp', 'text-property-transition-smoke');
await mkdir(directory, { recursive: true });
const output = await mkdtemp(path.join(directory, 'run-'));
const environment = { ...process.env }; delete environment.ELECTRON_RUN_AS_NODE;
const report = { observations: [], pageErrors: [] }; let app; let page;
try {
  const launch = await resolveDesktopTestLaunch(root, { requirePackaged: true });
  report.executablePath = launch.executablePath;
  app = await electron.launch({ executablePath: launch.executablePath, args: launch.args, cwd: root,
    env: { ...environment, LIGHTTABLE_AUTOMATION_USER_DATA: path.join(output, 'profile') } });
  page = await app.firstWindow(); page.on('pageerror', error => report.pageErrors.push(error.stack ?? error.message));
  await waitForDesktopLauncher({ app, page, outputDirectory: output, sourceFile: null,
    pageErrors: report.pageErrors, label: 'text-property-transition' });
  const driver = await attachLightTableAutomation(page, 'text-property-transition');
  const create = async name => {
    const result = await driver.executeWorkspace('document.create', { name, width: 480, height: 320,
      resolutionPpi: 72, bitDepth: 8, profile: 'srgb', background: { kind: 'solid', color: '#f0e0c0' } });
    const id = result.value?.documentId; assert.ok(id); await driver.waitForReadyDocument(id, 60000); return id;
  };
  const activate = async (id, name) => {
    await page.getByRole('tab', { name: new RegExp(name) }).click();
    await driver.waitForReadyDocument(id, 60000);
  };
  const png = async (id, label) => {
    const accepted = await driver.execute(id, 'file.exportPng', {}, { requireCompleted: false });
    const task = await driver.waitForTask(id, accepted.taskId); assert.ok(task.artifact?.id);
    const artifact = await driver.readArtifact(task.artifact.id); assert.ok(artifact?.bytes?.length);
    await writeFile(path.join(output, `${label}.png`), artifact.bytes);
    return sharp(artifact.bytes).ensureAlpha().raw().toBuffer();
  };
  const a = await create('Text property A');
  const created = await driver.execute(a, 'text.create', { mode: 'point', text: 'Property handoff', name: 'Property text',
    origin: { x: 30, y: 110 }, style: { font: { assetId: 'lighttable-inter-latin-regular', family: 'Inter', style: 'Regular' },
      fontSize: 32, fill: { enabled: true, color: '#203080' } } });
  const layerId = created.value?.layerId; assert.ok(layerId);
  const original = await png(a, 'original');
  assert.ok((await driver.queryText(a, layerId)).styleRuns.length > 0, 'The fixture must expose authored text style runs');
  const b = await create('Text property B');
  const originalB = await png(b, 'other-document');
  const baselineB = await driver.queryDocument(b);
  await activate(a, 'Text property A');
  await page.getByRole('tab', { name: 'Properties', exact: true }).click();
  await page.locator(`[data-layer-id="${layerId}"] .lighttable-layer__name`).click();
  const properties = page.getByRole('complementary', { name: 'Text properties' });
  const size = properties.getByRole('textbox', { name: 'Size', exact: true });
  await size.waitFor({ state: 'visible' });
  const baselineA = await driver.queryDocument(a);
  assert.equal(Number(await size.inputValue()), 32);
  await size.fill('48');
  assert.equal((await driver.queryDocument(a)).history.undoDepth, baselineA.history.undoDepth,
    'The real property preview must still be uncommitted before the tab click');
  await activate(b, 'Text property B');
  const afterA = await driver.queryDocument(a);
  assert.equal(afterA.history.undoDepth, baselineA.history.undoDepth + 1, 'Tab transition must commit the property exactly once');
  assert.ok((await driver.queryText(a, layerId)).styleRuns.every(run => run.fontSize === 48));
  assert.equal((await driver.queryDocument(b)).canonicalRevision, baselineB.canonicalRevision);
  assert.deepEqual(await png(b, 'other-document-after'), originalB);
  await activate(a, 'Text property A');
  const changed = await png(a, 'size-48'); assert.notDeepEqual(changed, original);
  assert.equal(Number(await size.inputValue()), 48);
  // Focusing an unchanged property opens a legitimate no-op gesture. Leaving it
  // must not reject the transition or author an empty history entry.
  await size.focus();
  await activate(b, 'Text property B');
  assert.equal((await driver.queryDocument(a)).history.undoDepth, afterA.history.undoDepth);
  assert.equal((await driver.queryDocument(a)).canonicalRevision, afterA.canonicalRevision);
  await activate(a, 'Text property A');
  await driver.execute(a, 'history.undo', {});
  assert.deepEqual(await png(a, 'undo'), original, 'One Undo must restore exact pre-gesture final-output pixels');
  assert.ok((await driver.queryText(a, layerId)).styleRuns.every(run => run.fontSize === 32));
  await driver.execute(a, 'history.redo', {});
  assert.deepEqual(await png(a, 'redo'), changed, 'Redo must restore exact committed property pixels');
  report.observations.push({ kind: 'real Properties Size edit then tab transition', oneUndoUnit: true,
    originalSize: 32, committedSize: 48, exactUndoRedoPixels: true, successorUnaffected: true });
  report.observations.push({ kind: 'unchanged focused property then tab transition', acceptedNoOp: true, historyDelta: 0 });
  report.scopeCoverage = 'Ordinary real UI transitions here; controlled stale/rejected admission is covered by focused owner/coordinator tests.';
  assert.deepEqual(report.pageErrors, []);
  await page.screenshot({ path: path.join(output, 'final-ui.png') });
  report.passed = true; console.log(`Text property transition passed: ${output}`);
} catch (error) {
  report.passed = false; report.error = error.stack ?? String(error);
  if (page) await page.screenshot({ path: path.join(output, 'failure.png') });
  throw error;
} finally {
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  await app?.close();
}
