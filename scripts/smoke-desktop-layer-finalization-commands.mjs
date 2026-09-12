import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { _electron as electron } from 'playwright-core';
import sharp from 'sharp';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';
import { resolveDesktopTestLaunch, waitForDesktopLauncher } from './desktop-test-startup.mjs';

const root = path.resolve(import.meta.dirname, '..');
// Keep every failure and diagnostic run; never overwrite prior pixel evidence.
const output = path.join(root, 'tmp', `layer-finalization-commands-${Date.now()}`);
await mkdir(output, { recursive: true });
const userData = await mkdtemp(path.join(output, 'profile-'));
const environment = { ...process.env }; delete environment.ELECTRON_RUN_AS_NODE;
const uiEntry = process.env.LIGHTTABLE_FINALIZATION_ENTRY === 'ui';
const pageErrors = []; const observations = []; const previewDiagnostics = [];
let app; let page;
try {
  const launch = await resolveDesktopTestLaunch(root, { requirePackaged: true });
  app = await electron.launch({ executablePath: launch.executablePath, args: launch.args, cwd: root,
    env: { ...environment, LIGHTTABLE_AUTOMATION_USER_DATA: userData }, timeout: 30_000 });
  page = await app.firstWindow({ timeout: 30_000 });
  page.on('pageerror', error => pageErrors.push(error.stack ?? error.message));
  await waitForDesktopLauncher({ app, page, outputDirectory: output, sourceFile: null,
    pageErrors, label: 'layer-finalization-commands' });
  const driver = await attachLightTableAutomation(page, 'layer-finalization-commands');
  const created = await driver.executeWorkspace('document.create', {
    name: 'Finalization output ownership', width: 256, height: 192, resolutionPpi: 72,
    bitDepth: 8, profile: 'srgb', background: { kind: 'solid', color: '#4d80b3' }
  });
  const documentId = created.value?.documentId; assert.ok(documentId);
  await driver.waitForReadyDocument(documentId, 60_000);
  const command = (name, parameters = {}) => driver.execute(documentId, name, parameters);
  const tree = async () => (await driver.queryLayers(documentId))
    .map(({ id, type, parentId, name }) => ({ id, type, parentId, name }));
  const depth = async () => (await driver.queryDocument(documentId)).history.undoDepth;
  // Final PNG compares one representation throughout. Bounded preview uses interactive
  // glyph coverage after undo, while text command completion prepares outline sources;
  // its separate diagnostic is not a final-quality or recent viewport-frame guarantee.
  const pixels = async (label) => {
    const state = await driver.queryDocument(documentId);
    const preview = await driver.requestDocumentPreview(documentId, state.canonicalRevision, 256);
    const previewArtifact = await driver.readArtifact(preview?.artifact?.id ?? preview?.id);
    assert.ok(previewArtifact?.bytes?.length, 'Composite preview must contain bytes');
    await writeFile(path.join(output, `${label}-interactive-preview.png`), previewArtifact.bytes);
    const exported = await driver.execute(documentId, 'file.exportPng', {}, { requireCompleted: false });
    const task = await driver.waitForTask(documentId, exported.taskId);
    assert.ok(task.artifact?.id, JSON.stringify(task));
    const artifact = await driver.readArtifact(task.artifact.id);
    assert.ok(artifact?.bytes?.length, 'Final PNG must contain bytes');
    await writeFile(path.join(output, `${label}.png`), artifact.bytes);
    await writeFile(path.join(output, `${label}.json`), JSON.stringify({ state, layers: await driver.queryLayers(documentId) }, null, 2));
    const raw = await sharp(artifact.bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    assert.equal(raw.info.width, 256); assert.equal(raw.info.height, 192);
    const previewPixels = await sharp(previewArtifact.bytes).ensureAlpha().raw().toBuffer();
    previewDiagnostics.push({ stage: label, interactivePreviewVsFinalPngRmse: rmse(previewPixels, raw.data) });
    return raw.data;
  };
  const rmse = (left, right) => {
    assert.equal(left.length, right.length); let squared = 0;
    for (let i = 0; i < left.length; i++) squared += (left[i] - right[i]) ** 2;
    return Math.sqrt(squared / left.length);
  };
  let operationIndex = 0;
  const finalize = async (name, parameters, outputField = 'outputLayerId', uiAction) => {
    const evidence = `${operationIndex++}-${name}`;
    const before = await tree(); const beforeDepth = await depth(); const beforePixels = await pixels(`${evidence}-before`);
    const started = performance.now();
    let result;
    if (uiEntry) {
      if (name === 'document.flattenImage') {
        await page.getByRole('menuitem', { name: 'Layer', exact: true }).click();
        await page.getByRole('menuitem', { name: 'Flatten Image...', exact: true }).click();
      } else {
        const ids = parameters.layerIds ?? [parameters.layerId ?? parameters.groupId];
        for (let index = uiAction === 'merge-down' ? ids.length - 1 : 0; index < ids.length; index++) {
          await page.locator(`[data-layer-id="${ids[index]}"] .lighttable-layer__name`)
            .click({ modifiers: index && uiAction !== 'merge-down' ? ['Control'] : [] });
        }
        if (uiAction === 'merge-down') await page.keyboard.press('Control+e');
        else {
        await page.locator(`[data-layer-id="${ids.at(-1)}"] .lighttable-layer__name`).click({ button: 'right' });
        const label = name === 'layer.merge' ? /^Merge Selected/
          : name === 'layer.flattenGroup' ? 'Flatten Group...' : 'Rasterize Layer';
        await page.getByRole('menuitem', { name: label, exact: typeof label === 'string' }).click();
        }
      }
      await page.waitForFunction(({ id, depth }) => window.__lightTableAutomation.queryDocument(id).history.undoDepth === depth,
        { id: documentId, depth: beforeDepth + 1 });
      const destinations = (await tree()).filter(layer => !before.some(source => source.id === layer.id));
      assert.equal(destinations.length, 1, 'UI finalization must publish one fresh destination');
      // UI has no public return payload. Observe the actual tree delta, never use
      // a later activeLayer as an alleged semantic command result.
      result = { value: { [outputField]: destinations[0].id } };
    } else result = await command(name, parameters);
    const durationMs = performance.now() - started;
    const id = result.value?.[outputField];
    assert.equal(typeof id, 'string', `${name} must return ${outputField}, without active-layer inference`);
    const after = await tree();
    assert.equal(after.find(layer => layer.id === id)?.type, 'raster');
    assert.ok(!before.some(layer => layer.id === id), `${name} must allocate a fresh destination`);
    assert.equal(await depth(), beforeDepth + 1, `${name} must publish exactly one history entry`);
    const afterPixels = await pixels(`${evidence}-after`); const error = rmse(beforePixels, afterPixels);
    assert.ok(error <= 1, `${name} changed appearance: RMSE ${error}`);
    await command('history.undo');
    assert.deepEqual(await tree(), before); assert.equal(await depth(), beforeDepth);
    const undoPixels = await pixels(`${evidence}-undo`);
    assert.equal(rmse(beforePixels, undoPixels), 0, `${name} undo changed original pixels`);
    await command('history.redo');
    assert.deepEqual(await tree(), after); assert.equal(await depth(), beforeDepth + 1);
    assert.equal(rmse(afterPixels, await pixels(`${evidence}-redo`)), 0, `${name} redo changed committed pixels`);
    observations.push({ command: name, entry: uiEntry ? uiAction === 'merge-down' ? 'real Ctrl+E' : 'real UI menu' : 'semantic command', parameters,
      ...(uiEntry ? { observedFreshDestination: id } : { result: result.value }), durationMs,
      appearanceRmse: error, historyDelta: 1, undoRedo: 'exact tree/IDs and pixels' });
    return id;
  };

  const gradient = await command('layer.createGradientFill');
  assert.equal(typeof gradient.value?.layerId, 'string');
  const rasterGradient = await finalize('layer.rasterize', { layerId: gradient.value.layerId });
  const text = await command('text.create', {
    mode: 'paragraph', name: 'Finalization text', text: 'O06d pixels',
    origin: { x: 20, y: 68 }, frame: { width: 220, height: 100 }, writingMode: 'horizontal-tb',
    style: { font: { family: 'Inter', style: 'Regular' }, fontSize: 32,
      fill: { enabled: true, color: '#ff0088' } },
    paragraph: { alignment: 'start', direction: 'auto', leading: { value: 40 } }
  });
  assert.equal(typeof text.value?.layerId, 'string');
  const rasterText = await finalize('text.rasterize', { layerId: text.value.layerId }, 'layerId');
  const merged = await finalize('layer.merge', { layerIds: [rasterGradient, rasterText] }, 'outputLayerId', 'merge-down');
  if (uiEntry) {
    const extra = await command('layer.createGradientFill');
    await finalize('layer.merge', { layerIds: [merged, extra.value.layerId] });
  }
  // Group every root sibling: there is no external backdrop for this pass-through group.
  const rootLayers = (await tree()).filter(layer => !layer.parentId).map(layer => layer.id);
  const group = await command('layer.group', { layerIds: rootLayers });
  assert.equal(typeof group.value?.groupId, 'string');
  await finalize('layer.flattenGroup', { groupId: group.value.groupId });
  await command('layer.createGradientFill');
  await finalize('document.flattenImage', {});
  assert.deepEqual(pageErrors, []);
  await page.screenshot({ path: path.join(output, 'final.png') });
  await writeFile(path.join(output, 'report.json'), JSON.stringify({ passed: true, observations, previewDiagnostics, pageErrors,
    evidenceScope: uiEntry
      ? 'Real UI finalization entry, fresh destination tree delta, history and same-representation final PNG parity; no UI command-return-ID claim.'
      : 'Explicit command IDs, history and same-representation final PNG parity; interactive preview diagnostics separate, not viewport-frame or cold-font latency proof.' }, null, 2));
  console.log(uiEntry
    ? `Layer finalization UI entry, fresh destinations, one-entry history and pixel undo/redo passed: ${output}`
    : `Layer finalization exact output IDs, one-entry history and pixel undo/redo passed: ${output}`);
} catch (error) {
  await writeFile(path.join(output, 'report.json'), JSON.stringify({ passed: false, observations, previewDiagnostics, pageErrors,
    error: error.stack ?? String(error) }, null, 2));
  if (page) await page.screenshot({ path: path.join(output, 'failure.png') });
  throw error;
} finally {
  await app?.close();
}
