import { _electron as electron } from 'playwright-core';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import sharp from 'sharp';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';
import { resolveDesktopTestLaunch } from './desktop-test-startup.mjs';

const workspace = path.resolve(import.meta.dirname, '..');
const suitePath = path.join(
  workspace, 'architecture', 'reference', 'implementation', 'grade-visual-suite.json'
);
const suite = JSON.parse(await readFile(suitePath, 'utf8'));
const accept = process.argv.includes('--accept');
const sourceArgument = process.argv.find((value) => value.startsWith('--source='));
const rootArgument = process.argv.find((value) => value.startsWith('--root='));
const source = path.resolve(sourceArgument?.slice('--source='.length) ?? 'D:\\people.jpg');
const root = path.resolve(rootArgument?.slice('--root='.length)
  ?? 'D:\\mediavibe\\LightTableTests\\AdjustmentParity\\grade-native');
const outputDirectory = path.join(root, accept ? 'baseline' : 'current');
const launch = await resolveDesktopTestLaunch(workspace, {
  requirePackaged: process.argv.includes('--packaged')
});
const userData = path.join(root, 'runtime', `lighttable-${process.pid}`);
await Promise.all([
  access(source), access(launch.executablePath), mkdir(outputDirectory, { recursive: true }),
  mkdir(userData, { recursive: true })
]);

const sourceMetadata = await sharp(source).metadata();

const captureEvidence = async (bytes) => {
  const [metadata, stats] = await Promise.all([
    sharp(bytes).metadata(),
    sharp(bytes).ensureAlpha().stats()
  ]);
  if (metadata.width !== sourceMetadata.width || metadata.height !== sourceMetadata.height) {
    throw new Error(
      `Grade PNG dimensions ${metadata.width}x${metadata.height} do not match source `
      + `${sourceMetadata.width}x${sourceMetadata.height}.`
    );
  }
  const alpha = metadata.hasAlpha ? stats.channels.at(-1) : { min: 255, max: 255 };
  if ((alpha?.max ?? 0) === 0) {
    throw new Error('Grade PNG export is fully transparent.');
  }
  return {
    width: metadata.width,
    height: metadata.height,
    alphaMin: alpha?.min ?? null,
    alphaMax: alpha?.max ?? null
  };
};

const setSlider = async (page, label, target) => {
  const slider = page.locator(
    `aside.lighttable-grade-panel input[type="range"][aria-label="${label}"]`
  ).first();
  await slider.waitFor({ state: 'attached', timeout: 30_000 });
  await slider.scrollIntoViewIfNeeded();
  const limits = await slider.evaluate((input) => ({
    min: Number(input.min), max: Number(input.max), step: Number(input.step || 1)
  }));
  const bounded = Math.max(limits.min, Math.min(limits.max, target));
  const fromMinimum = Math.round((bounded - limits.min) / limits.step);
  const fromMaximum = Math.round((limits.max - bounded) / limits.step);
  await slider.focus();
  const key = fromMinimum <= fromMaximum ? 'ArrowRight' : 'ArrowLeft';
  const count = Math.min(fromMinimum, fromMaximum);
  await slider.press(fromMinimum <= fromMaximum ? 'Home' : 'End');
  for (let index = 0; index < count; index += 1) await slider.press(key);
  const actual = Number(await slider.inputValue());
  if (Math.abs(actual - bounded) > limits.step / 2) {
    throw new Error(`${label} settled at ${actual}, expected ${bounded}.`);
  }
};

const comparePng = async (baselinePath, currentPath) => {
  const [baseline, current] = await Promise.all([
    sharp(baselinePath).removeAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(currentPath).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  ]);
  if (baseline.info.width !== current.info.width || baseline.info.height !== current.info.height) {
    throw new Error(`Grade output dimensions differ for ${path.basename(currentPath)}.`);
  }
  let squaredError = 0;
  let maximumError = 0;
  for (let index = 0; index < baseline.data.length; index += 1) {
    const difference = Math.abs(baseline.data[index] - current.data[index]);
    squaredError += difference * difference;
    maximumError = Math.max(maximumError, difference);
  }
  const rmse = Math.sqrt(squaredError / baseline.data.length) / 255;
  return { rmse, parityPercent: 100 * (1 - rmse), maximumError: maximumError / 255 };
};

const environment = { ...process.env, LIGHTTABLE_AUTOMATION_USER_DATA: userData };
delete environment.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath: launch.executablePath,
  args: launch.args,
  cwd: workspace,
  env: environment,
  timeout: 30_000
});
const results = [];
try {
  const page = await app.firstWindow({ timeout: 30_000 });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
  const driver = await attachLightTableAutomation(page, 'grade-visual');
  const sourceArtifact = await driver.registerInputArtifact(
    await readFile(source), path.basename(source), 'image/jpeg'
  );
  if (!sourceArtifact?.id) throw new Error('Grade source registration failed.');

  for (const [index, entry] of suite.cases.entries()) {
    const opened = await driver.executeWorkspace('file.openArtifact', {
      artifactId: sourceArtifact.id
    });
    const documentId = opened.value?.documentId;
    if (!documentId) throw new Error('Grade source open did not return a document ID.');
    let readiness = await driver.waitForRenderedDocument(documentId, 120_000);
    let gradePanel = page.getByLabel('Grade Layer properties', { exact: true }).last();
    if (!await gradePanel.isVisible().catch(() => false)) {
      const trigger = page.getByRole('button', { name: 'New fill or processing layer' });
      await trigger.click();
      await page.getByRole('menu', { name: 'New fill or processing layer' })
        .getByRole('menuitem', { name: 'New Grade layer', exact: true }).click();
      gradePanel = page.getByLabel('Grade Layer properties', { exact: true }).last();
    }
    await gradePanel.waitFor({ state: 'visible', timeout: 30_000 });
    const settings = Object.entries(entry.settings);
    if (settings.length > 0) {
      if (!await driver.resetRenderTelemetry(documentId)) {
        throw new Error('Grade render telemetry could not be reset before mutation.');
      }
      for (const [label, value] of settings) {
        await setSlider(page, label, value);
      }
      readiness = await driver.waitForRenderedDocument(documentId, 120_000);
    }
    const exported = await driver.execute(documentId, 'file.exportPng', {}, {
      requireCompleted: false
    });
    const task = await driver.waitForTask(documentId, exported.taskId, 120_000);
    if (!task.artifact) throw new Error('Grade PNG export did not publish an artifact.');
    const png = await driver.readArtifact(task.artifact.id);
    if (!png) throw new Error('Grade PNG export artifact cannot be read.');
    const output = path.join(outputDirectory, `${entry.id}.png`);
    await writeFile(output, png.bytes);
    const result = {
      id: entry.id,
      settings: entry.settings,
      output,
      lightTableLaunchMode: launch.mode,
      renderedDocumentRevision: readiness.telemetry.presentedDocumentRevision,
      captureEvidence: await captureEvidence(png.bytes)
    };
    if (!accept) {
      Object.assign(result, await comparePng(path.join(root, 'baseline', `${entry.id}.png`), output));
      result.passed = result.parityPercent >= suite.minimumParityPercent;
    }
    results.push(result);
    process.stdout.write(`[${index + 1}/${suite.cases.length}] ${entry.id}: `
      + `${accept ? 'accepted' : `${result.parityPercent.toFixed(3)}%`}\n`);
  }
  if (pageErrors.length) throw new Error(`Grade runtime errors: ${pageErrors.join('\n')}`);
} finally {
  await app.close().catch(() => {});
}

const report = {
  schema: 1,
  generatedAt: new Date().toISOString(),
  source,
  accepted: accept,
  lightTableLaunchMode: launch.mode,
  minimumParityPercent: suite.minimumParityPercent,
  passed: accept || results.every(({ passed }) => passed),
  cases: results
};
await writeFile(path.join(root, accept ? 'baseline-report.json' : 'report.json'),
  `${JSON.stringify(report, null, 2)}\n`);
if (!report.passed) process.exitCode = 1;
