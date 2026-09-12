import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import sharp from 'sharp';
import { _electron as electron } from 'playwright-core';
import { resolveDesktopTestLaunch, waitForDesktopLauncher } from './desktop-test-startup.mjs';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';

const root = path.resolve(import.meta.dirname, '..');
const directory = path.join(root, 'tmp', 'remove-object-smoke');
await mkdir(directory, { recursive: true });
const output = await mkdtemp(path.join(directory, 'run-'));
const projectLocation = path.join(output, 'Remove Object project');
await mkdir(projectLocation);
const environment = { ...process.env }; delete environment.ELECTRON_RUN_AS_NODE;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const report = { observations: [], pageErrors: [], limitations: [
  'Provider catalog/workflow/cost and generation-submit are local main-process IPC fixtures. No paid/provider generation is invoked.',
  'Project creation, durable asset import/load, canonical selection, renderer export and Select > Remove Object are production routes.',
  'Submission returns a valid submitted fixture with no generated result. Provider processing, job persistence/polling and result placement are not tested.',
  'The stale case controls workflow discovery, then uses a real tab switch. It does not claim every GPU/encoding/import timing race.',
  'Two successful user requests and one deliberately retired request are expected; there are no automatic retries.'
] };
let app, page;
try {
  const launch = await resolveDesktopTestLaunch(root, { requirePackaged: true });
  report.executablePath = launch.executablePath;
  app = await electron.launch({ executablePath: launch.executablePath, args: launch.args, cwd: root,
    env: { ...environment, LIGHTTABLE_AUTOMATION_USER_DATA: path.join(output, 'profile'),
      LIGHTTABLE_AUTOMATION_PROJECT_LOCATION: projectLocation } });
  page = await app.firstWindow(); page.on('pageerror', error => report.pageErrors.push(error.stack ?? error.message));
  await waitForDesktopLauncher({ app, page, outputDirectory: output, sourceFile: null,
    pageErrors: report.pageErrors, label: 'remove-object' });
  await app.evaluate(({ ipcMain }) => {
    const provider = { id: 'openart', label: 'Local Remove Object fixture', status: 'connected' };
    const model = { id: 'remove-object-fixture-model', providerId: provider.id,
      label: 'Remove Object fixture', capabilities: ['image2image', 'image.inpaint'] };
    const state = globalThis.__removeObjectSmoke = {
      submissions: [], submissionWaiters: [], workflowRequests: [], holdNextInpaint: false,
      held: null, entered: null, signalEntered: null
    };
    const replace = (name, handler) => { ipcMain.removeHandler(name); ipcMain.handle(name, handler); };
    replace('lighttable:genai-provider-snapshots', () => [provider]);
    replace('lighttable:genai-provider-connect', () => provider);
    replace('lighttable:genai-model-list', () => [model]);
    replace('lighttable:genai-cost-estimate', () => null);
    replace('lighttable:genai-workflow-load', async (_event, providerId, modelId, mode) => {
      if (providerId !== provider.id || modelId !== model.id) throw new Error('Unexpected fixture catalog target.');
      state.workflowRequests.push({ providerId, modelId, mode });
      if (mode === 'image.inpaint' && state.holdNextInpaint) {
        state.holdNextInpaint = false;
        await new Promise(resolve => { state.held = resolve; state.signalEntered(); });
      }
      return { id: `remove-object-fixture-${mode}`, providerId, modelId, label: 'Local fixture', mode, fields: [
        { key: 'prompt', role: 'prompt', kind: 'string', label: 'Prompt', required: false,
          advanced: false, defaultValue: '', sourceSchema: {} },
        { key: 'references', role: 'references', kind: 'asset', label: 'References', required: false,
          advanced: false, defaultValue: [], maximum: 8, sourceSchema: {} }
      ] };
    });
    replace('lighttable:genai-generation-submit', (_event, projectId, request) => {
      if (request?.operation !== 'image.inpaint' || request?.intent !== 'remove-object') {
        throw new Error('Only fixture Remove Object submission is permitted.');
      }
      state.submissions.push({ projectId, request });
      const number = state.submissions.length;
      for (const waiter of state.submissionWaiters) if (number >= waiter.count) waiter.resolve();
      state.submissionWaiters = state.submissionWaiters.filter(waiter => number < waiter.count);
      return { jobId: `local-remove-object-${number}`, providerJobId: `local-provider-${number}`, status: 'submitted' };
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
  const driver = await attachLightTableAutomation(page, 'remove-object');
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
  const pixels = bytes => sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const samePixels = async (actual, expected) => {
    const [a, b] = await Promise.all([pixels(actual), pixels(expected)]);
    assert.deepEqual(a.info, b.info); assert.deepEqual(a.data, b.data);
  };
  const select = id => driver.execute(id, 'selection.applyShape', {
    mode: 'replace', shape: { kind: 'rectangle', points: [{ x: 60, y: 50 }, { x: 180, y: 150 }] },
    featherRadius: 6, antiAlias: true
  });
  const activate = async (id, name) => {
    await page.getByRole('tab', { name: new RegExp(name) }).click();
    await page.waitForFunction(id => window.__lightTableAutomation.queryWorkspace().activeDocumentId === id, id);
    await driver.waitForReadyDocument(id, 60000);
  };
  const remove = async () => {
    await page.getByRole('menuitem', { name: 'Select', exact: true }).click();
    const item = page.getByRole('menuitem', { name: 'Remove Object', exact: true });
    assert.equal(await item.isEnabled(), true); await item.click();
  };
  const submissions = () => app.evaluate(() => globalThis.__removeObjectSmoke.submissions);
  const waitSubmitted = async count => {
    await app.evaluate(async (_electron, count) => {
      const state = globalThis.__removeObjectSmoke;
      if (state.submissions.length >= count) return;
      let timer;
      try { await Promise.race([
        new Promise(resolve => state.submissionWaiters.push({ count, resolve })),
        new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error(`Submission ${count} was not reached.`)), 45000); })
      ]); } finally { clearTimeout(timer); }
    }, count);
    await page.getByText('Remove Object submitted.', { exact: true }).waitFor({ state: 'visible', timeout: 15000 });
  };
  const first = await create('Remove Object A', '#c04020');
  // The ordinary Setup auto-base association is independent of Remove Object.
  // Settle and disable it through its real UI so later tab switches cannot import unrelated assets.
  await page.getByRole('radio', { name: 'Switch to Gen AI workspace' }).click();
  const genAiPanel = page.getByRole('complementary', { name: 'Generative AI' });
  await genAiPanel.waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.querySelectorAll('.genai-panel__reference-item').length === 1);
  await genAiPanel.getByRole('checkbox', { name: 'Add base image' }).uncheck();
  await page.waitForFunction(() => document.querySelectorAll('.genai-panel__reference-item').length === 0);
  await page.getByRole('radio', { name: 'Switch to Photo edit workspace' }).click();
  const second = await create('Remove Object B', '#2060a0');
  const secondBefore = await png(second, 'source-b-before'), secondState = await driver.queryDocument(second);
  await activate(first, 'Remove Object A'); await select(first);
  const before = await png(first, 'source-a-before'), baseline = await driver.queryDocument(first);
  const initialAssets = (await catalog()).assets;
  const initialAssetIds = initialAssets.map(asset => asset.id);
  report.initialAssets = initialAssets;
  const expectedAssets = count => initialAssets.length + count;

  const inspectSubmission = async (record, label) => {
    assert.equal(record.projectId, project.id);
    const request = record.request;
    assert.equal(request.operation, 'image.inpaint'); assert.equal(request.intent, 'remove-object');
    assert.deepEqual(request.editorDelivery, { projectId: project.id, documentId: first,
      sourceRevision: baseline.canonicalRevision, behavior: 'place-edit' });
    assert.equal(request.output.aspectRatio, '320:240'); assert.equal(request.output.count, 1);
    assert.deepEqual(request.selection, { assetId: request.selection.assetId, format: 'grayscale', interpretation: 'white-is-selected' });
    assert.ok(request.baseImageAssetId && request.selection.assetId !== request.baseImageAssetId);
    assert.deepEqual(request.references.map(asset => asset.id).sort(), [request.baseImageAssetId, request.selection.assetId].sort());
    assert.ok(request.references.every(asset => asset.projectId === project.id));
    const base = await assetBytes(request.baseImageAssetId), maskBytes = await assetBytes(request.selection.assetId);
    await writeFile(path.join(output, `${label}-base.png`), base);
    await writeFile(path.join(output, `${label}-mask.png`), maskBytes);
    await samePixels(base, before);
    const mask = await pixels(maskBytes);
    assert.equal(mask.info.width, 320); assert.equal(mask.info.height, 240);
    let featherPixels = 0;
    for (let offset = 0; offset < mask.data.length; offset += 4) {
      assert.equal(mask.data[offset], mask.data[offset + 1]); assert.equal(mask.data[offset], mask.data[offset + 2]);
      assert.equal(mask.data[offset + 3], 255);
      if (mask.data[offset] > 0 && mask.data[offset] < 255) featherPixels++;
    }
    assert.equal(mask.data[(100 * 320 + 120) * 4], 255, 'Selected center must be white');
    assert.equal(mask.data[0], 0, 'Unselected corner must be black');
    assert.ok(featherPixels > 0, 'Feathered canonical coverage must survive mask export');
    report.observations.push({ kind: label, baseAssetId: request.baseImageAssetId, maskAssetId: request.selection.assetId,
      baseHash: hash(base), maskHash: hash(maskBytes), exactSourcePixels: true, featherPixels, editorDelivery: request.editorDelivery });
  };
  await remove(); await waitSubmitted(1);
  let records = await submissions(); assert.equal(records.length, 1); await inspectSubmission(records[0], 'first-request');
  assert.equal((await catalog()).assets.length, expectedAssets(2));

  await app.evaluate(() => {
    const state = globalThis.__removeObjectSmoke;
    state.holdNextInpaint = true;
    state.entered = new Promise(resolve => { state.signalEntered = resolve; });
  });
  await remove();
  await app.evaluate(async () => {
    let timer;
    try { await Promise.race([globalThis.__removeObjectSmoke.entered,
      new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Deferred inpaint discovery was not reached.')), 15000); })]); }
    finally { clearTimeout(timer); }
  });
  assert.equal((await catalog()).assets.length, expectedAssets(2), 'Discovery must precede imports');
  await activate(second, 'Remove Object B');
  await app.evaluate(() => { const state = globalThis.__removeObjectSmoke; state.held(); state.held = null; });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal((await submissions()).length, 1, 'Retired discovery must not submit');
  assert.equal((await catalog()).assets.length, expectedAssets(2), 'Retired discovery must not import inputs');
  report.observations.push({ kind: 'deferred workflow discovery retired by real tab switch', imports: 0, submissions: 0 });

  await activate(first, 'Remove Object A');
  await remove(); await waitSubmitted(2);
  records = await submissions(); assert.equal(records.length, 2, 'The explicit current retry must submit once, without reviving its predecessor');
  assert.equal((await catalog()).assets.length, expectedAssets(4)); await inspectSubmission(records[1], 'current-retry');
  await samePixels(await png(first, 'source-a-after'), before);
  const after = await driver.queryDocument(first);
  assert.equal(after.canonicalRevision, baseline.canonicalRevision);
  assert.equal(after.history.currentStateId, baseline.history.currentStateId);
  assert.equal(after.history.undoDepth, baseline.history.undoDepth);
  await activate(second, 'Remove Object B'); await samePixels(await png(second, 'source-b-after'), secondBefore);
  const secondAfter = await driver.queryDocument(second);
  assert.equal(secondAfter.canonicalRevision, secondState.canonicalRevision);
  assert.equal(secondAfter.history.currentStateId, secondState.history.currentStateId);
  assert.equal(secondAfter.history.undoDepth, secondState.history.undoDepth);
  assert.equal((await submissions()).length, 2);
  const finalAssets = (await catalog()).assets;
  assert.equal(finalAssets.length, expectedAssets(4));
  assert.ok(initialAssetIds.every(id => finalAssets.some(asset => asset.id === id)), 'Unrelated durable references remain untouched');
  report.submissions = records; assert.deepEqual(report.pageErrors, []);
  await page.screenshot({ path: path.join(output, 'final-ui.png') });
  report.passed = true; console.log(`Remove Object smoke passed: ${output}`);
} catch (error) {
  report.passed = false; report.error = error.stack ?? String(error);
  if (page) await page.screenshot({ path: path.join(output, 'failure.png') });
  throw error;
} finally {
  if (app) report.fixture = await app.evaluate(() => ({
    submissions: globalThis.__removeObjectSmoke?.submissions ?? [], workflowRequests: globalThis.__removeObjectSmoke?.workflowRequests ?? []
  })).catch(() => null);
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  await app?.close();
}
