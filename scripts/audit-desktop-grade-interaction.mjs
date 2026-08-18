import { _electron as electron } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import sharp from 'sharp';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';
import { resolveDesktopTestLaunch } from './desktop-test-startup.mjs';

const workspace = path.resolve(import.meta.dirname, '..');
const output = path.join(workspace, 'tmp', 'grade-interaction-audit');
const userData = path.join(output, `user-data-${process.pid}`);
const reportPath = path.join(output, 'report.json');
const launch = await resolveDesktopTestLaunch(workspace);
await mkdir(userData, { recursive: true });

const width = 3840;
const height = 2160;
const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <defs>
    <linearGradient id="l" x1="0" x2="1"><stop stop-color="#030810"/><stop offset=".5" stop-color="#778ba8"/><stop offset="1" stop-color="#fff5dc"/></linearGradient>
    <linearGradient id="c" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#f24b60"/><stop offset=".33" stop-color="#47d67d"/><stop offset=".66" stop-color="#487be8"/><stop offset="1" stop-color="#f0c847"/></linearGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#l)"/>
  <rect x="240" y="260" width="3360" height="420" fill="url(#c)"/>
  <g fill="none" stroke="#f8f8f8" stroke-width="4" opacity=".75">
    <circle cx="960" cy="1440" r="520"/><circle cx="1920" cy="1440" r="360"/><circle cx="2880" cy="1440" r="180"/>
  </g>
</svg>`);
const sourceBytes = await sharp(svg).png().toBuffer();

const report = {
  schema: 1,
  generatedAt: new Date().toISOString(),
  fixture: { width, height, bitDepth: 16, blendProfile: 'sRGB' },
  requestedInputHz: 60,
  controls: [],
  pageErrors: [],
  consoleErrors: []
};

const environment = {
  ...process.env,
  LIGHTTABLE_AUTOMATION_USER_DATA: userData
};
delete environment.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath: launch.executablePath,
  args: launch.args,
  cwd: workspace,
  env: environment,
  timeout: 30_000
});

const closeApp = async () => {
  let timer;
  await Promise.race([
    app.close().catch(() => {}),
    new Promise((resolve) => {
      timer = setTimeout(() => {
        app.process().kill();
        resolve();
      }, 5_000);
      timer.unref?.();
    })
  ]);
  if (timer) clearTimeout(timer);
};

try {
  const page = await app.firstWindow({ timeout: 30_000 });
  page.on('pageerror', (error) => report.pageErrors.push(error.stack ?? error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') report.consoleErrors.push(message.text());
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  report.adapter = await page.evaluate(async () => {
    const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' });
    return adapter ? { ...adapter.info } : null;
  });
  const driver = await attachLightTableAutomation(page, 'grade-interaction-audit');
  const source = await driver.registerInputArtifact(sourceBytes, 'grade-4k-diagnostic.png', 'image/png');
  const opened = await driver.executeWorkspace('file.openArtifact', { artifactId: source.id });
  const documentId = opened.value?.documentId;
  if (!documentId) throw new Error('Opening the 4K Grade fixture returned no document ID.');
  await driver.waitForDocument(documentId, 120_000);
  await driver.waitForLayers(documentId, 120_000);

  await page.getByRole('button', { name: 'New fill or processing layer' }).click();
  await page.getByRole('menu', { name: 'New fill or processing layer' })
    .getByRole('menuitem', { name: 'New Grade layer', exact: true }).click();
  const gradePanel = page.getByLabel('Grade Layer properties', { exact: true });
  await gradePanel.waitFor({ state: 'visible', timeout: 30_000 });

  await page.evaluate(() => {
    globalThis.__lightTableGradeInteractionAudit = { longTasks: [], pointerMoves: 0 };
    document.addEventListener('pointermove', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement) || target.type !== 'range') return;
      globalThis.__lightTableGradeInteractionAudit.pointerMoves += 1;
    }, true);
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        globalThis.__lightTableGradeInteractionAudit.longTasks.push({
          startTime: entry.startTime,
          duration: entry.duration
        });
      }
    }).observe({ type: 'longtask' });
  });

  const exercise = async ({ groupLabel, sliderLabel, expectedStage }) => {
    const group = gradePanel.locator('.lighttable-group').filter({
      has: page.getByRole('button', { name: groupLabel, exact: true })
    });
    const groupToggle = group.getByRole('button', { name: groupLabel, exact: true });
    if (await groupToggle.getAttribute('aria-expanded') === 'false') await groupToggle.click();
    const visibilitySwitch = group.getByRole('switch');
    if (await visibilitySwitch.getAttribute('aria-checked') === 'false') await visibilitySwitch.click();
    const slider = group.getByRole('slider', { name: sliderLabel, exact: true }).first();
    await slider.scrollIntoViewIfNeeded();
    await slider.waitFor({ state: 'visible' });
    const bounds = await slider.boundingBox();
    if (!bounds) throw new Error(`${groupLabel} / ${sliderLabel} has no interactive bounds.`);

    const limits = await slider.evaluate((node) => ({
      min: Number(node.min),
      max: Number(node.max),
      value: Number(node.value)
    }));
    const initialRatio = (limits.value - limits.min) / (limits.max - limits.min);
    await page.evaluate(() => {
      globalThis.__lightTableGradeInteractionAudit.longTasks = [];
      globalThis.__lightTableGradeInteractionAudit.pointerMoves = 0;
    });
    await driver.resetRenderTelemetry(documentId);

    const samples = [];
    const startedAt = performance.now();
    await page.mouse.move(
      bounds.x + bounds.width * (0.02 + 0.96 * initialRatio),
      bounds.y + bounds.height / 2
    );
    await page.mouse.down();
    for (let step = 0; step <= 48; step += 1) {
      await page.mouse.move(
        bounds.x + bounds.width * (0.02 + 0.90 * step / 48),
        bounds.y + bounds.height / 2
      );
      if (step === 16 || step === 32 || step === 48) {
        samples.push({
          value: Number(await slider.inputValue()),
          submittedFrames: (await driver.queryRenderTelemetry(documentId))?.submittedFrames ?? 0
        });
      }
      await page.waitForTimeout(1000 / 60);
    }
    await page.mouse.up();
    const gestureMs = performance.now() - startedAt;
    await page.waitForTimeout(500);
    const telemetry = await driver.queryRenderTelemetry(documentId);
    const pointerMoves = await page.evaluate(() => (
      globalThis.__lightTableGradeInteractionAudit.pointerMoves
    ));
    const longTasks = await page.evaluate(() => globalThis.__lightTableGradeInteractionAudit.longTasks);
    const result = {
      groupLabel,
      sliderLabel,
      expectedStage,
      gestureMs,
      pointerMoves,
      samples,
      longTasks,
      telemetry,
      publishHz: (telemetry?.submittedFrames ?? 0) / (gestureMs / 1000)
    };
    report.controls.push(result);

    if (pointerMoves < 36) throw new Error(`${sliderLabel} received only ${pointerMoves} live pointer moves.`);
    if (!(samples[0].value < samples[1].value && samples[1].value < samples[2].value)) {
      throw new Error(`${sliderLabel} values did not progress during drag: ${samples.map(({ value }) => value).join(', ')}.`);
    }
    if (!(samples[0].submittedFrames < samples[1].submittedFrames
      && samples[1].submittedFrames < samples[2].submittedFrames)) {
      throw new Error(`${sliderLabel} did not publish continuous GPU frames: ${samples.map(({ submittedFrames }) => submittedFrames).join(', ')}.`);
    }
    if ((telemetry?.stages?.[expectedStage]?.executions ?? 0) < 3) {
      throw new Error(`${sliderLabel} did not execute the expected ${expectedStage} stage.`);
    }
    if (longTasks.some(({ duration }) => duration > 250)) {
      throw new Error(`${sliderLabel} produced a main-thread task above 250 ms.`);
    }
    if (result.publishHz < 12) {
      throw new Error(`${sliderLabel} rendered only ${result.publishHz.toFixed(1)} Hz during a 4K drag.`);
    }
    if (result.publishHz > 45) {
      throw new Error(`${sliderLabel} exceeded the bounded interaction cadence at ${result.publishHz.toFixed(1)} Hz.`);
    }

    const reset = group.getByRole('button', { name: `Reset ${groupLabel} adjustments`, exact: true });
    await reset.click();
    await page.waitForTimeout(250);
  };

  await exercise({ groupLabel: 'Light', sliderLabel: 'Exposure', expectedStage: 'output' });
  await exercise({ groupLabel: 'Detail', sliderLabel: 'Luminance', expectedStage: 'linear-spatial' });

  if (report.pageErrors.length || report.consoleErrors.length) {
    throw new Error(`Grade interaction emitted runtime errors: ${JSON.stringify({
      pageErrors: report.pageErrors,
      consoleErrors: report.consoleErrors
    })}`);
  }
} catch (error) {
  report.failure = error instanceof Error ? error.stack ?? error.message : String(error);
  throw error;
} finally {
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`).catch(() => {});
  await closeApp();
}

process.stdout.write(`Grade 4K interaction audit passed. Report: ${reportPath}\n`);
