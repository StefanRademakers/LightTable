import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import sharp from 'sharp';
import { _electron as electron } from 'playwright-core';
import { resolveDesktopTestLaunch, waitForDesktopLauncher } from './desktop-test-startup.mjs';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';

const root = path.resolve(import.meta.dirname, '..');
const directory = path.join(root, 'tmp', 'genai-reference-handoff-smoke');
await mkdir(directory, { recursive: true });
const output = await mkdtemp(path.join(directory, 'run-'));
const projectLocation = path.join(output, 'Reference project');
await mkdir(projectLocation);
const environment = { ...process.env }; delete environment.ELECTRON_RUN_AS_NODE;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const report = { observations: [], pageErrors: [], limitations: [
  'Provider discovery, workflow and cost are local IPC fixtures; no provider/network generation is exercised.',
  'Project storage, asset import/load/preview, document PNG export and UI association are production routes.',
  'File paste uses a browser ClipboardEvent, not the operating-system clipboard.',
  'Controlled stale export/project/workflow races are owner/hook tests, not timing claims from this smoke.'
] };
let app; let page;
try {
  const launch = await resolveDesktopTestLaunch(root, { requirePackaged: true });
  report.executablePath = launch.executablePath;
  app = await electron.launch({ executablePath: launch.executablePath, args: launch.args, cwd: root,
    env: { ...environment, LIGHTTABLE_AUTOMATION_USER_DATA: path.join(output, 'profile'),
      LIGHTTABLE_AUTOMATION_PROJECT_LOCATION: projectLocation } });
  page = await app.firstWindow(); page.on('pageerror', error => report.pageErrors.push(error.stack ?? error.message));
  await waitForDesktopLauncher({ app, page, outputDirectory: output, sourceFile: null,
    pageErrors: report.pageErrors, label: 'genai-reference-handoff' });
  await app.evaluate(({ ipcMain }) => {
    const provider = { id: 'openart', label: 'OpenArt fixture', status: 'connected' };
    const model = { id: 'reference-fixture-model', providerId: provider.id,
      label: 'Reference fixture', capabilities: ['image2image'] };
    const workflow = { id: 'reference-fixture-workflow', providerId: provider.id, modelId: model.id,
      label: 'Reference fixture', mode: 'image2image', fields: [
        { key: 'prompt', role: 'prompt', kind: 'string', label: 'Prompt', required: false,
          advanced: false, defaultValue: '', sourceSchema: {} },
        { key: 'references', role: 'references', kind: 'asset', label: 'References', required: false,
          advanced: false, defaultValue: [], maximum: 8, sourceSchema: {} }
      ] };
    const replace = (name, handler) => { ipcMain.removeHandler(name); ipcMain.handle(name, handler); };
    replace('lighttable:genai-provider-snapshots', () => [provider]);
    replace('lighttable:genai-provider-connect', () => provider);
    replace('lighttable:genai-model-list', () => [model]);
    replace('lighttable:genai-workflow-load', () => workflow);
    replace('lighttable:genai-cost-estimate', () => null);
    globalThis.__referenceSmokeSubmitCalls = 0;
    replace('lighttable:genai-generation-submit', () => {
      globalThis.__referenceSmokeSubmitCalls++;
      throw new Error('Paid generation is blocked by the reference handoff smoke.');
    });
  });
  await page.reload();
  await page.getByRole('button', { name: 'New Project', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Create project' });
  await dialog.getByRole('button', { name: 'Choose…' }).click();
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();
  await page.locator('.lighttable-project-home').waitFor({ state: 'visible' });
  const project = await page.evaluate(() => window.lightTableDesktop.currentProject());
  assert.ok(project?.id); report.projectId = project.id;
  const driver = await attachLightTableAutomation(page, 'genai-reference-handoff');
  const create = async (name, color) => {
    const result = await driver.executeWorkspace('document.create', { name, width: 320, height: 240,
      resolutionPpi: 72, bitDepth: 8, profile: 'srgb', background: { kind: 'solid', color } });
    const id = result.value?.documentId; assert.ok(id); await driver.waitForReadyDocument(id, 60000); return id;
  };
  const png = async (id, label) => {
    const accepted = await driver.execute(id, 'file.exportPng', {}, { requireCompleted: false });
    const task = await driver.waitForTask(id, accepted.taskId); assert.ok(task.artifact?.id);
    const artifact = await driver.readArtifact(task.artifact.id); assert.ok(artifact?.bytes?.length);
    await writeFile(path.join(output, `${label}.png`), artifact.bytes); return artifact.bytes;
  };
  const catalog = () => page.evaluate(id => window.lightTableDesktop.loadGenAiProjectAssetCatalog(id), project.id);
  const assetBytes = async assetId => Buffer.from(await page.evaluate(async ({ projectId, assetId }) => {
    const file = await window.lightTableDesktop.loadGenAiProjectAsset(projectId, assetId);
    return Array.from(file.bytes);
  }, { projectId: project.id, assetId }));
  const pixels = async bytes => sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const samePixels = async (actual, expected) => {
    const [a, b] = await Promise.all([pixels(actual), pixels(expected)]);
    assert.deepEqual(a.info, b.info); assert.deepEqual(a.data, b.data);
  };
  const first = await create('Reference source A', '#c04020');
  const before = await png(first, 'source-a');
  const baseline = await driver.queryDocument(first);
  await page.getByRole('radio', { name: 'Switch to Gen AI workspace' }).click();
  const panel = page.getByRole('complementary', { name: 'Generative AI' });
  await panel.waitFor({ state: 'visible' });
  const referenceCount = async count => {
    await page.waitForFunction(count => document.querySelectorAll('.genai-panel__reference-item').length === count, count);
    assert.equal(await panel.locator('.genai-panel__reference-item').count(), count);
  };
  const base = panel.getByRole('checkbox', { name: 'Add base image' });
  await referenceCount(1); assert.equal(await base.isChecked(), true);
  const initial = await catalog(); assert.equal(initial.assets.length, 1);
  await samePixels(await assetBytes(initial.assets[0].id), before);
  await page.waitForFunction(() => [...document.querySelectorAll('.genai-panel__reference-thumbnail')]
    .some(image => image.complete && image.naturalWidth > 0));
  await base.uncheck(); await referenceCount(0);
  assert.equal((await catalog()).assets.length, 1, 'Removing an association must retain the durable asset');
  await base.check(); await referenceCount(1);
  const rechecked = await catalog(); assert.equal(rechecked.assets.length, 2, 'Rechecking captures a fresh base image');
  const currentBase = rechecked.assets.find(asset => asset.id !== initial.assets[0].id); assert.ok(currentBase);
  await samePixels(await assetBytes(currentBase.id), before);
  report.observations.push({ kind: 'base-image export, thumbnail, remove and fresh recapture', assets: rechecked.assets.map(a => a.id) });

  const localPng = await sharp({ create: { width: 24, height: 18, channels: 4, background: '#2060e0' } }).png().toBuffer();
  await writeFile(path.join(output, 'local-reference.png'), localPng);
  await panel.locator('.genai-panel__reference-well').hover();
  await panel.locator('.genai-panel__reference-well').evaluate((element, bytes) => {
    const data = new DataTransfer(); data.items.add(new File([new Uint8Array(bytes)], 'local-reference.png', { type: 'image/png' }));
    element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
  }, [...localPng]);
  await referenceCount(2);
  const imported = await catalog(); assert.equal(imported.assets.length, 3);
  const local = imported.assets.find(asset => !rechecked.assets.some(prior => prior.id === asset.id)); assert.ok(local);
  assert.equal(hash(await assetBytes(local.id)), hash(localPng), 'Real local import must retain exact encoded bytes');
  await base.uncheck(); await referenceCount(1);
  report.observations.push({ kind: 'UI file paste through real asset storage', assetId: local.id, exactBytes: true });
  const second = await create('Reference source B', '#20a060');
  await referenceCount(1); assert.equal(await base.isChecked(), false);
  const secondBaseline = await driver.queryDocument(second);
  await page.getByRole('tab', { name: /Reference source A/ }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Add as reference', exact: true }).click();
  await page.waitForFunction(id => window.__lightTableAutomation.queryWorkspace().activeDocumentId === id, first);
  await referenceCount(2);
  const finalCatalog = await catalog(); assert.equal(finalCatalog.assets.length, 4);
  assert.ok(finalCatalog.assets.every(asset => asset.projectId === project.id), 'All durable references must belong to the captured project');
  const tabAsset = finalCatalog.assets.find(asset => !imported.assets.some(prior => prior.id === asset.id)); assert.ok(tabAsset);
  await samePixels(await assetBytes(tabAsset.id), before);
  await samePixels(await png(first, 'source-a-after'), before);
  const firstAfter = await driver.queryDocument(first), secondAfter = await driver.queryDocument(second);
  assert.equal(firstAfter.history.undoDepth, baseline.history.undoDepth);
  assert.equal(firstAfter.canonicalRevision, baseline.canonicalRevision);
  assert.equal(secondAfter.history.undoDepth, secondBaseline.history.undoDepth);
  assert.equal(secondAfter.canonicalRevision, secondBaseline.canonicalRevision);
  assert.equal(firstAfter.history.currentStateId, baseline.history.currentStateId);
  assert.equal(secondAfter.history.currentStateId, secondBaseline.history.currentStateId);
  report.observations.push({ kind: 'inactive tab reference handoff', source: first, priorActive: second,
    assetId: tabAsset.id, exactSourcePixels: true, historyDelta: 0 });
  report.generationSubmitCalls = await app.evaluate(() => globalThis.__referenceSmokeSubmitCalls);
  assert.equal(report.generationSubmitCalls, 0); assert.deepEqual(report.pageErrors, []);
  await page.screenshot({ path: path.join(output, 'final-ui.png') });
  report.passed = true; console.log(`GenAI reference handoff passed: ${output}`);
} catch (error) {
  report.passed = false; report.error = error.stack ?? String(error);
  if (page) await page.screenshot({ path: path.join(output, 'failure.png') });
  throw error;
} finally {
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  await app?.close();
}
