import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { _electron as electron } from 'playwright-core';
import { resolveDesktopTestLaunch, waitForDesktopLauncher } from './desktop-test-startup.mjs';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';

const root = path.resolve(import.meta.dirname, '..');
const directory = path.join(root, 'tmp', 'text-to-shape-intent-smoke');
await mkdir(directory, { recursive: true });
const output = await mkdtemp(path.join(directory, 'run-'));
const environment = { ...process.env }; delete environment.ELECTRON_RUN_AS_NODE;
const report = { observations: [], pageErrors: [], limitations: [
  'Fixture creation and history use the semantic automation boundary; conversion and cancellation use the actual Type menu/dialog.',
  'Exact equality is required for Undo/Redo of each representation, not between independently rasterized text and vector glyphs.',
  'Deferred dialog/renderer retirement is covered by focused tests; this smoke does not synthesize native OS focus events.'
] };
let app, page;
try {
  const launch = await resolveDesktopTestLaunch(root, { requirePackaged: true });
  report.executablePath = launch.executablePath;
  app = await electron.launch({ executablePath: launch.executablePath, args: launch.args, cwd: root,
    env: { ...environment, LIGHTTABLE_AUTOMATION_USER_DATA: path.join(output, 'profile') } });
  page = await app.firstWindow();
  page.on('pageerror', error => report.pageErrors.push(error.stack ?? error.message));
  await waitForDesktopLauncher({ app, page, outputDirectory: output, sourceFile: null,
    pageErrors: report.pageErrors, label: 'text-to-shape-intent' });
  const driver = await attachLightTableAutomation(page, 'text-to-shape-intent');
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
  const a = await create('Shape intent A');
  const created = await driver.execute(a, 'text.create', { mode: 'point', text: 'Editable glyphs', name: 'Convert me',
    origin: { x: 30, y: 110 }, style: { font: { assetId: 'lighttable-inter-latin-regular', family: 'Inter', style: 'Regular' },
      fontSize: 32, fill: { enabled: true, color: '#203080' } } });
  const layerId = created.value?.layerId; assert.ok(layerId);
  const original = await png(a, 'original-text');
  const b = await create('Shape intent B');
  const originalB = await png(b, 'other-document');
  const baselineB = await driver.queryDocument(b);
  await activate(a, 'Shape intent A');
  await page.locator(`[data-layer-id="${layerId}"] .lighttable-layer__name`).click();
  const open = async () => {
    await page.getByRole('menuitem', { name: 'Type', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Convert to Shape...', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Convert text to shape?', exact: true });
    await dialog.waitFor({ state: 'visible' }); return dialog;
  };
  const baseline = await driver.queryDocument(a);
  await (await open()).getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal((await driver.queryDocument(a)).history.undoDepth, baseline.history.undoDepth);
  assert.equal((await driver.queryDocument(a)).canonicalRevision, baseline.canonicalRevision);
  assert.equal((await driver.queryText(a, layerId)).content.text, 'Editable glyphs');
  assert.deepEqual(await png(a, 'after-cancel'), original);
  report.observations.push({ kind: 'real Type conversion cancellation', exactPixels: true, noHistoryOrRevisionChange: true });

  await page.getByRole('tab', { name: 'Properties', exact: true }).click();
  const size = page.getByRole('complementary', { name: 'Text properties' }).getByRole('textbox', { name: 'Size', exact: true });
  await page.locator(`[data-layer-id="${layerId}"] .lighttable-layer__thumbnail`).dblclick();
  await page.getByRole('textbox', { name: /^Edit / }).waitFor({ state: 'attached' });
  await size.focus();
  await (await open()).getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal((await driver.queryDocument(a)).history.undoDepth, baseline.history.undoDepth);
  assert.deepEqual(await png(a, 'after-flow-noop-focus'), original);
  report.observations.push({ kind: 'active flow editing -> untouched Properties focus -> Type confirmation',
    acceptedNoOp: true, noExtraHistory: true, exactPixels: true });
  await size.fill('40');
  assert.equal((await driver.queryDocument(a)).history.undoDepth, baseline.history.undoDepth,
    'Real Size preview is uncommitted before opening the Type menu');
  const dialog = await open();
  const settled = await driver.queryDocument(a);
  assert.equal(settled.history.undoDepth, baseline.history.undoDepth + 1,
    'Entering the confirmation must settle the preceding text property exactly once');
  const settledRuns = (await driver.queryText(a, layerId)).styleRuns;
  assert.ok(settledRuns.length > 0 && settledRuns.every(run => run.fontSize === 40));
  // Export is a read of the already settled source, not an alternate conversion route.
  const settledText = await png(a, 'settled-text');
  assert.notDeepEqual(settledText, original, 'The Size edit must change final glyph pixels');
  await dialog.getByRole('button', { name: 'Convert', exact: true }).click();
  await page.waitForFunction(({ id, layerId }) => (
    window.__lightTableAutomation.queryLayers(id).some(layer => layer.id === layerId && layer.type === 'vector')
  ), { id: a, layerId });
  const converted = await driver.queryDocument(a);
  assert.equal(converted.history.undoDepth, settled.history.undoDepth + 1);
  const vector = await driver.queryVector(a, layerId);
  assert.ok(vector.totalElements > 0, 'Conversion must author native editable paths');
  const convertedPng = await png(a, 'converted-shape');
  assert.notDeepEqual(convertedPng, originalB, 'Converted glyphs must remain visible, not an empty layer');
  await page.screenshot({ path: path.join(output, 'converted-ui.png') });
  await activate(b, 'Shape intent B');
  const afterB = await driver.queryDocument(b);
  assert.equal(afterB.canonicalRevision, baselineB.canonicalRevision);
  assert.deepEqual(afterB.history, baselineB.history);
  assert.deepEqual(await png(b, 'other-document-after'), originalB);
  await activate(a, 'Shape intent A');
  await driver.execute(a, 'history.undo', {});
  assert.equal((await driver.queryText(a, layerId)).content.text, 'Editable glyphs');
  assert.deepEqual(await png(a, 'undo-conversion'), settledText);
  await driver.execute(a, 'history.redo', {});
  assert.deepEqual(await driver.queryVector(a, layerId), vector);
  assert.deepEqual(await png(a, 'redo-conversion'), convertedPng);
  await driver.execute(a, 'history.undo', {});
  await driver.execute(a, 'history.undo', {});
  assert.deepEqual(await png(a, 'undo-property-and-conversion'), original);
  const restoredRuns = (await driver.queryText(a, layerId)).styleRuns;
  assert.ok(restoredRuns.length > 0 && restoredRuns.every(run => run.fontSize === 32));
  report.observations.push({ kind: 'real Size preview -> Type confirmation -> Convert -> tabs -> history',
    separatePropertyAndConversionHistory: true, nativeVectorElements: vector.totalElements,
    undoRestoresEditableText: true, exactRepresentationUndoRedoPixels: true, successorUnchanged: true });
  // The dialog blocks pointer input, not semantic automation. A changed target
  // must invalidate the outstanding confirmation instead of converting new text.
  const obsoleteDialog = await open();
  await driver.execute(a, 'text.format', { layerId, style: { fontSize: 36 } });
  const externallyChanged = await driver.queryDocument(a);
  const externallyChangedPng = await png(a, 'external-edit-with-dialog');
  await obsoleteDialog.getByRole('button', { name: 'Convert', exact: true }).click();
  await page.getByText('The text layer changed after conversion was requested. Open Convert to Shape again.', { exact: true })
    .waitFor({ state: 'visible' });
  const rejected = await driver.queryDocument(a);
  assert.equal(rejected.canonicalRevision, externallyChanged.canonicalRevision);
  assert.deepEqual(rejected.history, externallyChanged.history);
  assert.equal((await driver.queryText(a, layerId)).content.text, 'Editable glyphs');
  assert.deepEqual(await png(a, 'rejected-obsolete-confirmation'), externallyChangedPng);
  report.observations.push({ kind: 'semantic text edit while real conversion dialog is open',
    obsoleteConfirmationRejected: true, errorVisible: true, noConversionHistory: true, changedTextPreserved: true });
  assert.deepEqual(report.pageErrors, []);
  await page.screenshot({ path: path.join(output, 'final-ui.png') });
  report.passed = true; console.log(`Text-to-shape intent passed: ${output}`);
} catch (error) {
  report.passed = false; report.error = error.stack ?? String(error);
  if (page) await page.screenshot({ path: path.join(output, 'failure.png') });
  throw error;
} finally {
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  await app?.close();
}
