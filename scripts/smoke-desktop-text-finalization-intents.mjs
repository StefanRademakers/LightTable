import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { _electron as electron } from 'playwright-core';
import { resolveDesktopTestLaunch, waitForDesktopLauncher } from './desktop-test-startup.mjs';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';
import { createPositionedRecoveryFixture } from './positioned-text-recovery-fixture.mjs';

const root = path.resolve(import.meta.dirname, '..');
const directory = path.join(root, 'tmp/text-finalization-intents');
await mkdir(directory, { recursive: true });
const output = await mkdtemp(path.join(directory, 'run-'));
const report = { observations: [], pageErrors: [], consoleErrors: [], limitations: [
  'Fixture authored through native layered codec and real bundled-font glyph shaping, opened through the packaged file route.',
  'Actual Properties recovery and Type rasterize entry; history/query/export through public semantic automation.',
  'Existing text worker explicitly rejects positioned realization. Original/undo export rejection is asserted, NOT visual preservation.',
  'Recovered flow/raster representations must restore exactly. Positioned-to-flow is intentional reconstruction, not pixel-parity conversion.',
  'Delayed terminal and retired renderer/session races are focused-test evidence, not native-window timing claims.'
] };
let app, page;
try {
  const fixture = await createPositionedRecoveryFixture(root, output);
  const launch = await resolveDesktopTestLaunch(root, { requirePackaged: true });
  report.executablePath = launch.executablePath;
  const environment = { ...process.env }; delete environment.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ executablePath: launch.executablePath, args: launch.args, cwd: root,
    env: { ...environment, LIGHTTABLE_AUTOMATION_OPEN_FILE: fixture.filePath,
      LIGHTTABLE_AUTOMATION_USER_DATA: path.join(output, 'profile') } });
  page = await app.firstWindow();
  page.on('pageerror', error => report.pageErrors.push(error.stack ?? error.message));
  page.on('console', message => { if (message.type() === 'error' || message.type() === 'warning') report.consoleErrors.push(message.text()); });
  const open = await waitForDesktopLauncher({ app, page, outputDirectory: output, sourceFile: fixture.filePath,
    pageErrors: report.pageErrors, label: 'text-finalization' });
  await open.click();
  const driver = await attachLightTableAutomation(page, 'text-finalization-intents');
  await page.waitForFunction(() => window.__lightTableAutomation.queryWorkspace()?.activeDocumentId);
  const a = (await driver.queryWorkspace()).activeDocumentId;
  await driver.waitForReadyDocument(a, 60000);
  const layerId = fixture.layerId;
  const png = async (id, label) => {
    const accepted = await driver.execute(id, 'file.exportPng', {}, { requireCompleted: false });
    const task = await driver.waitForTask(id, accepted.taskId); assert.ok(task.artifact?.id);
    const artifact = await driver.readArtifact(task.artifact.id); assert.ok(artifact?.bytes?.length);
    await writeFile(path.join(output, `${label}.png`), artifact.bytes);
    return sharp(artifact.bytes).ensureAlpha().raw().toBuffer();
  };
  const originalQuery = await driver.queryText(a, layerId);
  report.originalQuery = originalQuery;
  assert.equal(originalQuery.sourceKind, 'positioned');
  await assert.rejects(png(a, 'positioned-original'), /Text sources changed or could not be prepared for export/);
  const blank = await sharp({ create: { width: 320, height: 200, channels: 4,
    background: '#f0e0c0' } }).raw().toBuffer();
  const baseline = await driver.queryDocument(a);
  await page.locator(`[data-layer-id="${layerId}"] .lighttable-layer__name`).click();
  await page.getByRole('tab', { name: 'Properties', exact: true }).click();
  await page.getByRole('button', { name: 'Recover editable text', exact: true }).click();
  await page.waitForFunction(({ a, layerId }) => window.__lightTableAutomation.queryText(a, layerId)?.sourceKind === 'flow', { a, layerId });
  assert.equal((await driver.queryDocument(a)).history.undoDepth, baseline.history.undoDepth + 1);
  const flowQuery = await driver.queryText(a, layerId);
  assert.equal(flowQuery.content.text, 'A'); assert.equal(flowQuery.editable, true);
  const flow = await png(a, 'recovered-flow'); assert.notDeepEqual(flow, blank);
  await page.screenshot({ path: path.join(output, 'recovered-ui.png') });
  await driver.execute(a, 'history.undo', {});
  assert.deepEqual(await driver.queryText(a, layerId), originalQuery);
  await assert.rejects(png(a, 'undo-recovery'), /Text sources changed or could not be prepared for export/);
  await driver.execute(a, 'history.redo', {});
  assert.deepEqual(await driver.queryText(a, layerId), flowQuery);
  assert.deepEqual(await png(a, 'redo-recovery'), flow);
  report.observations.push({ kind: 'actual native positioned import -> Properties recovery -> Undo/Redo',
    nativeFlowText: true, oneHistory: true, exactRestoredSourceQuery: true, exactFlowRedoPixels: true,
    positionedRendering: 'existing explicit worker limitation; initial and undo exports reject' });

  const size = page.getByRole('complementary', { name: 'Text properties' }).getByRole('textbox', { name: 'Size', exact: true });
  const beforeSize = await driver.queryDocument(a);
  await size.fill('80');
  assert.equal((await driver.queryDocument(a)).history.undoDepth, beforeSize.history.undoDepth);
  await page.getByRole('menuitem', { name: 'Layer', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Rasterize', exact: true }).hover();
  await page.getByRole('menuitem', { name: 'Rasterize Type', exact: true }).click();
  await page.waitForFunction(({ a, oldId }) => {
    const layers = window.__lightTableAutomation.queryLayers(a);
    return !layers.some(layer => layer.id === oldId) && layers.length === 2 && layers.every(layer => layer.type === 'raster');
  }, { a, oldId: layerId });
  const rasterized = await driver.queryDocument(a);
  assert.equal(rasterized.history.undoDepth, beforeSize.history.undoDepth + 2,
    'One preceding Size commit and one fresh-destination rasterization');
  const raster = await png(a, 'rasterized'); assert.notDeepEqual(raster, blank);
  assert.notDeepEqual(raster, flow, 'Pending Size must not be discarded by Rasterize Type');
  const rasterLayers = await driver.queryLayers(a);
  await driver.execute(a, 'history.undo', {});
  const editedQuery = await driver.queryText(a, layerId);
  assert.equal(editedQuery.sourceKind, 'flow');
  assert.ok(editedQuery.styleRuns.length && editedQuery.styleRuns.every(run => run.fontSize === 80));
  const edited = await png(a, 'undo-rasterization-editable'); assert.notDeepEqual(edited, blank);
  await driver.execute(a, 'history.redo', {});
  assert.deepEqual(await driver.queryLayers(a), rasterLayers);
  assert.deepEqual(await png(a, 'redo-rasterization'), raster);
  await driver.execute(a, 'history.undo', {});
  await driver.execute(a, 'history.undo', {});
  assert.deepEqual(await png(a, 'undo-size-and-rasterization'), flow);
  report.observations.push({ kind: 'actual Size preview -> Type Rasterize -> Undo/Redo',
    freshDestination: true, separatePropertyAndRasterizationHistory: true, restoresEditableText: true,
    exactRepresentationPixels: true });
  assert.deepEqual(report.pageErrors, []);
  await page.screenshot({ path: path.join(output, 'final-ui.png') });
  report.passed = true; console.log(`Text finalization intents passed: ${output}`);
} catch (error) {
  report.passed = false; report.error = error.stack ?? String(error);
  if (page) await page.screenshot({ path: path.join(output, 'failure.png') });
  throw error;
} finally {
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  await app?.close();
}
