import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { _electron as electron } from 'playwright-core';
import { resolveDesktopTestLaunch, waitForDesktopLauncher } from './desktop-test-startup.mjs';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';

const root = path.resolve(import.meta.dirname, '..');
const directory = path.join(root, 'tmp', 'grade-clipboard-freshness-smoke');
await mkdir(directory, { recursive: true });
const output = await mkdtemp(path.join(directory, 'run-'));
const report = { passed: false, pageErrors: [], limitations: [
  'One actual Grade layer; public UI Copy/Paste and semantic commands only, no private state injection.',
  'Tests latest clipboard settings, no-op history/revision and Actions artifact association; no LUT, pixel-parity or forced lifetime-race claim.'
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
    pageErrors: report.pageErrors, label: 'grade-clipboard-freshness' });
  const driver = await attachLightTableAutomation(page, 'grade-clipboard-freshness');
  const created = await driver.executeWorkspace('document.create', { name: 'Grade clipboard freshness',
    width: 320, height: 240, resolutionPpi: 72, bitDepth: 8, profile: 'srgb',
    background: { kind: 'solid', color: '#705030' } });
  const id = created.value?.documentId; assert.ok(id);
  await driver.waitForReadyDocument(id, 60000);
  await page.getByRole('button', { name: 'New fill or processing layer', exact: true }).click();
  await page.getByRole('menu', { name: 'New fill or processing layer', exact: true })
    .getByRole('menuitem', { name: 'New Grade layer', exact: true }).click();
  await page.getByLabel('Grade Layer properties', { exact: true }).last().waitFor({ state: 'visible' });
  const layerId = (await driver.queryDocument(id)).activeLayerId; assert.ok(layerId);
  report.documentId = id; report.layerId = layerId;
  const target = { kind: 'layer', layerId };
  const grade = async () => {
    const document = await driver.queryDocument(id);
    const query = await driver.queryAdjustment(id, target, document.canonicalRevision);
    assert.equal(query?.status, 'completed', JSON.stringify(query));
    const exposure = query.stack.modules.flatMap(module => module.parameters)
      .filter(parameter => parameter.path === 'exposureEV');
    assert.equal(exposure.length, 1, 'The Grade query must expose one explicit exposure parameter');
    return { document, query, exposureEV: exposure[0].value };
  };
  const waitSteps = async count => {
    await page.waitForFunction(expected =>
      window.__lightTableAutomation.actionRecordingSnapshot()?.steps.length === expected,
    count, { timeout: 30000 });
  };
  const valueA = .5, valueB = -1;
  await driver.execute(id, 'grade.setBasic', { target, values: { exposureEV: valueA } });
  report.gradeA = await grade(); assert.equal(report.gradeA.exposureEV, valueA);
  await driver.startActionRecording('UI Copy A then semantic Copy B');
  await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Copy grade', exact: true }).click();
  await waitSteps(1);
  report.afterUiCopy = await grade();
  assert.equal(report.afterUiCopy.document.canonicalRevision, report.gradeA.document.canonicalRevision);
  assert.deepEqual(report.afterUiCopy.document.history, report.gradeA.document.history);
  const copyA = (await driver.queryActionRecording()).steps[0];
  assert.equal(copyA.command, 'grade.copy');
  const artifactA = copyA.result?.artifact?.id; assert.ok(artifactA);

  await driver.execute(id, 'grade.setBasic', { target, values: { exposureEV: valueB } });
  report.gradeB = await grade(); assert.equal(report.gradeB.exposureEV, valueB);
  assert.equal(report.gradeB.document.history.undoDepth, report.gradeA.document.history.undoDepth + 1);
  report.semanticCopyB = await driver.execute(id, 'grade.copy', {});
  const artifactB = report.semanticCopyB.value?.artifact?.id; assert.ok(artifactB);
  assert.notEqual(artifactB, artifactA, 'The two successful Copies must have distinct result artifacts');
  await waitSteps(3);
  report.beforePaste = await grade();
  assert.equal(report.beforePaste.document.canonicalRevision, report.gradeB.document.canonicalRevision);
  assert.deepEqual(report.beforePaste.document.history, report.gradeB.document.history);
  await page.screenshot({ path: path.join(output, 'before-paste.png') });
  await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();
  await page.getByRole('menuitem', { name: /^Paste grade:/ }).click();
  await waitSteps(4);
  await driver.stopActionRecording();
  report.recording = await driver.queryActionRecording(); report.afterPaste = await grade();
  report.artifacts = { copyA: artifactA, copyB: artifactB };
  await page.screenshot({ path: path.join(output, 'after-paste.png') });
  assert.deepEqual(report.recording.steps.map(step => step.command),
    ['grade.copy', 'grade.setBasic', 'grade.copy', 'grade.paste']);
  assert.equal(report.afterPaste.exposureEV, valueB,
    'UI Paste must use the newer semantic Copy B, not its older UI Copy A artifact');
  assert.equal(report.afterPaste.document.canonicalRevision, report.beforePaste.document.canonicalRevision,
    'Pasting the current copied Grade B must be a genuine no-op');
  assert.deepEqual(report.afterPaste.document.history, report.beforePaste.document.history);
  assert.deepEqual(report.recording.steps[3].parameters.artifactId,
    { $lighttableResult: { step: 3, path: 'artifact.id' } },
    'UI Paste must retain the newer successful Copy result artifact association');
  assert.deepEqual(report.pageErrors, []);
  report.passed = true; console.log(`Grade clipboard freshness passed: ${output}`);
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
