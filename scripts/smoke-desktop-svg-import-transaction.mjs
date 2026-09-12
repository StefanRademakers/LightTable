import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { _electron as electron } from 'playwright-core';
import { resolveDesktopTestLaunch, waitForDesktopLauncher } from './desktop-test-startup.mjs';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';

const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, 'tmp', 'svg-import-transaction');
await mkdir(output, { recursive: true });
const userData = await mkdtemp(path.join(output, 'profile-'));
const launch = await resolveDesktopTestLaunch(root, { requirePackaged: true });
const env = { ...process.env, LIGHTTABLE_AUTOMATION_USER_DATA: userData };
delete env.ELECTRON_RUN_AS_NODE;
const report = { passed: false, pageErrors: [] };
let app;
try {
  app = await electron.launch({ executablePath: launch.executablePath, args: launch.args, cwd: root, env });
  const page = await app.firstWindow();
  page.on('pageerror', error => report.pageErrors.push(String(error.stack ?? error)));
  await waitForDesktopLauncher({ app, page, outputDirectory: output, sourceFile: null,
    pageErrors: report.pageErrors, label: 'svg-import-transaction' });
  const driver = await attachLightTableAutomation(page, 'svg-import-transaction');
  const create = name => driver.executeWorkspace('document.create', {
    name, width: 200, height: 100, resolutionPpi: 72, bitDepth: 8, profile: 'srgb',
    background: { kind: 'transparent' }
  });
  const id = (await create('SVG transaction primary')).value.documentId;
  await driver.waitForReadyDocument(id, 60_000);
  const pixels = async name => {
    const state = await driver.queryDocument(id);
    const preview = await driver.requestDocumentPreview(id, state.canonicalRevision, 200);
    const artifact = await driver.readArtifact(preview?.artifact?.id ?? preview?.id);
    assert.ok(artifact?.bytes?.length, `Missing ${name} preview`);
    await writeFile(path.join(output, `${name}.png`), artifact.bytes);
    return sharp(artifact.bytes).ensureAlpha().raw().toBuffer();
  };
  const svg = (x, color) => `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect x="${x}" y="20" width="40" height="50" fill="${color}"/></svg>`;
  const before = await pixels('before');
  const opening = await driver.queryDocument(id);
  const imported = await driver.execute(id, 'vector.importSvg', {
    svg: svg(20, '#ff0000'), placement: 'document', layerName: 'First SVG'
  });
  assert.ok(imported.value.layerId);
  assert.equal((await driver.queryDocument(id)).history.undoDepth, opening.history.undoDepth + 1);
  const first = await pixels('first');
  assert.notDeepEqual(first, before, 'Mounted SVG import rendered no content');
  await driver.execute(id, 'history.undo');
  assert.deepEqual(await pixels('undo'), before);
  await driver.execute(id, 'history.redo');
  assert.deepEqual(await pixels('redo'), first);

  const secondId = (await create('SVG transaction secondary')).value.documentId;
  await driver.waitForReadyDocument(secondId, 60_000);
  const inactiveBefore = await driver.queryDocument(id);
  const inactive = await driver.execute(id, 'vector.importSvg', {
    svg: svg(110, '#00ff00'), placement: 'document', layerName: 'Inactive SVG'
  });
  assert.ok(inactive.value.layerId);
  assert.equal((await driver.queryDocument(id)).history.undoDepth, inactiveBefore.history.undoDepth + 1);
  assert.equal((await driver.queryWorkspace()).activeDocumentId, secondId,
    'Canonical inactive import must not activate its document');
  await page.locator('.ui-document-tabs__title', { hasText: 'SVG transaction primary' }).click();
  await driver.waitForReadyDocument(id, 60_000);
  const both = await pixels('inactive-rebound');
  assert.notDeepEqual(both, first);
  await driver.execute(id, 'history.undo');
  assert.deepEqual(await pixels('inactive-undo'), first);
  await driver.execute(id, 'history.redo');
  assert.deepEqual(await pixels('inactive-redo'), both);
  assert.deepEqual(report.pageErrors, []);
  report.passed = true;
  report.mounted = { layerId: imported.value.layerId, oneHistoryEntry: true, exactUndoRedo: true };
  report.inactive = { layerId: inactive.value.layerId, retainedInactive: true, exactReboundUndoRedo: true };
  console.log(`Packaged SVG import transaction passed: ${output}`);
} catch (error) {
  report.error = String(error.stack ?? error);
  throw error;
} finally {
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  await app?.close();
}
