import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { _electron as electron } from 'playwright-core';
import { resolveDesktopTestLaunch, waitForDesktopLauncher } from './desktop-test-startup.mjs';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';

const workspace = path.resolve(import.meta.dirname, '..');
const source = path.resolve(process.argv[2]
  ?? 'D:\\mediavibe\\LightTableTestFiles\\psd\\layer-effects-roundtrip\\photoshop-canonical\\drop-shadow-size-30.psd');
const label = process.argv[3] ?? 'layer-style-interaction';
const output = path.join(workspace, 'tmp', 'layer-style-interaction-audit');
const reportPath = path.join(output, `${label}.json`);
const userData = path.join(output, `user-data-${process.pid}`);
const launch = await resolveDesktopTestLaunch(workspace);
await Promise.all([access(source), mkdir(userData, { recursive: true })]);

const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
const report = {
  schema: 1,
  generatedAt: new Date().toISOString(),
  source,
  control: 'Blur',
  requestedInputHz: 120,
  pageErrors: [],
  consoleErrors: []
};
const parseInteger = (text, label) => Number(
  text.match(new RegExp(`${label}: (\\d+)`, 'i'))?.[1] ?? 0
);

const app = await electron.launch({
  executablePath: launch.executablePath,
  args: launch.args,
  cwd: workspace,
  env: {
    ...environment,
    LIGHTTABLE_AUTOMATION_OPEN_FILE: source,
    LIGHTTABLE_AUTOMATION_USER_DATA: userData
  },
  timeout: 30_000
});

try {
  const page = await app.firstWindow({ timeout: 30_000 });
  page.on('pageerror', (error) => report.pageErrors.push(error.stack ?? error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') report.consoleErrors.push(message.text());
  });
  const openFileButton = await waitForDesktopLauncher({
    app, page, outputDirectory: output, sourceFile: source,
    pageErrors: report.pageErrors, label: 'layer-style'
  });
  await openFileButton.click();
  await page.locator('.lighttable-toolbar__meta').filter({ hasText: /ready/i })
    .waitFor({ state: 'visible', timeout: 60_000 });
  const driver = await attachLightTableAutomation(page, 'layer-style-interaction');
  const documentId = (await driver.queryWorkspace())?.activeDocumentId;
  if (!documentId) throw new Error('No active document.');
  const layers = await driver.queryLayers(documentId) ?? [];
  let target = null;
  for (const layer of layers) {
    const styles = await driver.queryLayerEffects(documentId, layer.id);
    if (styles?.effects.some(({ enabled }) => enabled)) { target = layer; break; }
  }
  if (!target) throw new Error('No layer with an enabled Layer Style was found.');
  report.target = { id: target.id, name: target.name, type: target.type };
  const escapedId = target.id.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
  const targetRow = page.locator(`[data-layer-id="${escapedId}"]`);
  await targetRow.click();
  const effectSummary = targetRow.locator(
    'xpath=following-sibling::*[contains(concat(" ", normalize-space(@class), " "), " lighttable-layer-effects ")][1]'
  ).locator('.lighttable-layer-effect--summary');
  await effectSummary.getByRole('button', { name: 'Effects', exact: true }).click();
  const effectToggle = page.locator('.lighttable-group__toggle[title="Drop Shadow"]');
  await effectToggle.waitFor({ state: 'visible' });
  if (await effectToggle.getAttribute('aria-expanded') !== 'true') await effectToggle.click();
  const slider = page.getByRole('slider', { name: report.control, exact: true });
  await slider.waitFor({ state: 'visible' });
  const initialEffects = await driver.queryLayerEffects(documentId, target.id);
  const initialShadow = initialEffects?.effects.find(({ kind }) => kind === 'drop-shadow');
  if (!initialShadow) throw new Error('The target has no queryable Drop Shadow.');

  await page.getByRole('menuitem', { name: 'View' }).click();
  await page.getByRole('menuitem', { name: 'Actions panel' }).click();
  const actions = page.getByRole('complementary', { name: 'Actions' });
  const recorder = actions.locator('.lighttable-action-recorder');
  await recorder.getByRole('button', { name: 'Record' }).click();
  await recorder.getByText('recording', { exact: true }).waitFor();
  await page.getByRole('tab', { name: 'Properties', exact: true }).click();
  await slider.waitFor({ state: 'visible' });

  await page.evaluate(() => {
    globalThis.__lightTableStyleInteractionAudit = { inputEvents: 0, longTasks: [] };
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        globalThis.__lightTableStyleInteractionAudit.longTasks.push({
          startTime: entry.startTime,
          duration: entry.duration
        });
      }
    // This gate measures the authored gesture. Do not import startup/decode
    // long tasks from the performance buffer after the document is ready.
    }).observe({ type: 'longtask' });
  });
  await slider.evaluate((node) => node.addEventListener('input', () => {
    globalThis.__lightTableStyleInteractionAudit.inputEvents += 1;
  }));

  await page.getByRole('tab', { name: 'Debug', exact: true }).click();
  await page.getByRole('button', { name: 'Reset render stats' }).click();
  await page.getByRole('tab', { name: 'Properties', exact: true }).click();
  const range = await slider.evaluate((node) => ({
    minimum: Number(node.min), maximum: Number(node.max), initialValue: Number(node.value)
  }));
  const inputEvents = 120;
  const startedAt = performance.now();
  await slider.focus();
  await page.keyboard.down('ArrowRight');
  await slider.evaluate(async (node, { count, minimum, maximum }) => {
    for (let index = 1; index <= count; index += 1) {
      node.value = String(minimum + (maximum - minimum) * index / count);
      node.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 8));
    }
  }, { count: inputEvents, minimum: range.minimum, maximum: range.maximum });
  await page.keyboard.up('ArrowRight');
  const gestureMs = performance.now() - startedAt;
  await page.waitForTimeout(350);
  const finalSliderValue = Number(await slider.inputValue());
  await page.getByRole('menuitem', { name: 'View' }).click();
  await page.getByRole('menuitem', { name: 'Actions panel' }).click();
  await recorder.getByRole('button', { name: 'Stop', exact: true }).click();
  await recorder.getByText('stopped', { exact: true }).waitFor();
  const recording = await driver.queryActionRecording();
  const replayable = recording?.steps.filter(({ replayable }) => replayable) ?? [];
  const recordedUpdate = replayable.find(({ command }) => command === 'layer.effect.update');
  const finalEffects = await driver.queryLayerEffects(documentId, target.id);
  const finalShadow = finalEffects?.effects.find(({ id }) => id === initialShadow.id);
  report.actions = {
    stepCount: replayable.length,
    commands: replayable.map(({ command }) => command),
    byteLength: recording?.byteLength ?? null,
    initialSize: initialShadow.settings?.size,
    finalSize: finalShadow?.settings?.size,
    recordedParameters: recordedUpdate?.parameters ?? null
  };
  report.gesture = {
    requestedInputEvents: inputEvents,
    durationMs: gestureMs,
    inputEvents: await page.evaluate(() => globalThis.__lightTableStyleInteractionAudit.inputEvents),
    initialValue: range.initialValue,
    finalValue: finalSliderValue
  };
  report.longTasks = await page.evaluate(() => globalThis.__lightTableStyleInteractionAudit.longTasks);

  await page.getByRole('tab', { name: 'Debug', exact: true }).click();
  await page.getByRole('button', { name: 'Capture render stats' }).click();
  const telemetry = page.locator('.lighttable-debug-message')
    .filter({ hasText: 'Render telemetry' }).last().locator('pre');
  await telemetry.waitFor({ state: 'visible' });
  const telemetryText = await telemetry.textContent() ?? '';
  report.render = {
    submittedFrames: parseInteger(telemetryText, 'Submitted frames'),
    renderCalls: parseInteger(telemetryText, 'Render calls'),
    correctionFrames: parseInteger(telemetryText, 'Correction frames'),
    noWorkSkips: parseInteger(telemetryText, 'No-work skips')
  };
  report.render.publishHz = report.render.submittedFrames / (gestureMs / 1000);
  report.runtimeStopped = /document runtime stopped unexpectedly/i.test(await page.locator('body').innerText());

  if (replayable.length !== 1 || recordedUpdate?.parameters?.effectId !== initialShadow.id
    || Object.keys(recordedUpdate.parameters.settings ?? {}).join(',') !== 'size'
    || report.actions.byteLength > 4096 || report.actions.finalSize === report.actions.initialSize) {
    throw new Error(`Layer Style UI checkpoint was not one bounded Action: ${JSON.stringify(report.actions)}`);
  }
  await driver.execute(documentId, 'history.undo', {});
  const undoneEffects = await driver.queryLayerEffects(documentId, target.id);
  const undoneShadow = undoneEffects?.effects.find(({ id }) => id === initialShadow.id);
  if (undoneShadow?.settings?.size !== initialShadow.settings?.size) {
    throw new Error('Undo did not restore the pre-gesture Layer Style value.');
  }
  await page.getByRole('menuitem', { name: 'View' }).click();
  await page.getByRole('menuitem', { name: 'Actions panel' }).click();
  await recorder.getByRole('button', { name: 'Play', exact: true }).click();
  await recorder.getByText(/Playback: completed/i).waitFor({ timeout: 15_000 });
  const replayedEffects = await driver.queryLayerEffects(documentId, target.id);
  const replayedShadow = replayedEffects?.effects.find(({ id }) => id === initialShadow.id);
  report.actions.replayedSize = replayedShadow?.settings?.size;
  if (replayedShadow?.settings?.size !== finalShadow?.settings?.size) {
    throw new Error(`Action playback did not restore the final Layer Style value: ${JSON.stringify(report.actions)}`);
  }

  if (report.pageErrors.length || report.consoleErrors.length || report.runtimeStopped) {
    throw new Error('Layer Style interaction caused a runtime error.');
  }
  if (report.gesture.inputEvents < inputEvents || report.gesture.finalValue === range.initialValue) {
    throw new Error('The Layer Style audit did not exercise a real changing slider gesture.');
  }
  if (report.render.publishHz > 38) {
    throw new Error(`FX rendering exceeded the 30 Hz interaction budget: ${report.render.publishHz.toFixed(1)} Hz.`);
  }
  if (report.longTasks.some(({ duration }) => duration > 250)) {
    throw new Error('FX interaction produced a long task above 250 ms.');
  }
} catch (error) {
  report.failure = error instanceof Error ? error.stack ?? error.message : String(error);
  throw error;
} finally {
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`).catch(() => {});
  await app.close().catch(() => {});
}

process.stdout.write(`Layer Style interaction audit passed. Report: ${reportPath}\n`);
