import { _electron as electron } from 'playwright-core';
import { createHash } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import sharp from 'sharp';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';
import { resolveDesktopTestLaunch } from './desktop-test-startup.mjs';

const workspace = path.resolve(import.meta.dirname, '..');
const sourceArgument = process.argv.find((value) => value.startsWith('--source='));
const rootArgument = process.argv.find((value) => value.startsWith('--root='));
const casesArgument = process.argv.find((value) => value.startsWith('--cases='));
const resumePartial = process.argv.includes('--resume-partial');
const maxNewCapturesArgument = process.argv.find((value) => value.startsWith('--max-new-captures='));
const maxNewCaptures = Math.max(0, Number(maxNewCapturesArgument?.slice('--max-new-captures='.length) ?? 0));
const refreshControlArgument = process.argv.find((value) => value.startsWith('--refresh-control='));
const refreshControl = refreshControlArgument?.slice('--refresh-control='.length) ?? null;
const source = path.resolve(sourceArgument?.slice('--source='.length) ?? 'D:\\people.jpg');
const root = path.resolve(rootArgument?.slice('--root='.length)
  ?? 'D:\\mediavibe\\LightTableTests\\GradeLightParity');
const outputDirectory = path.join(root, 'lighttable');
const casePath = path.resolve(casesArgument?.slice('--cases='.length)
  ?? path.join(import.meta.dirname, 'grade-light-parity-cases.json'));
const launch = await resolveDesktopTestLaunch(workspace);
const userData = path.join(root, 'runtime', `lighttable-${process.pid}`);
await Promise.all([
  access(source), access(launch.executablePath), access(casePath),
  mkdir(outputDirectory, { recursive: true }), mkdir(userData, { recursive: true })
]);

const caseManifestBytes = await readFile(casePath);
const caseManifestSha256 = createHash('sha256').update(caseManifestBytes).digest('hex');
const suite = JSON.parse(caseManifestBytes.toString('utf8'));
const sourceBytes = await readFile(source);
const sourceMetadata = await sharp(sourceBytes).metadata();
const sourceEvidence = {
  sha256: createHash('sha256').update(sourceBytes).digest('hex'),
  byteLength: sourceBytes.byteLength,
  format: sourceMetadata.format ?? null,
  width: sourceMetadata.width ?? null,
  height: sourceMetadata.height ?? null,
  depth: sourceMetadata.depth ?? null,
  channels: sourceMetadata.channels ?? null,
  hasProfile: Boolean(sourceMetadata.hasProfile),
  iccSha256: sourceMetadata.icc
    ? createHash('sha256').update(sourceMetadata.icc).digest('hex')
    : null
};
const caseId = (key, value) => `${key}-${value < 0 ? 'minus' : 'plus'}-${Math.abs(value)}`
  .replaceAll('.', '_');
const settingForControl = (control, value) => ({
  groupLabel: control.groupLabel ?? suite.groupLabel ?? suite.section,
  subgroupLabel: control.subgroupLabel ?? null,
  rangeIndex: control.rangeIndex ?? null,
  blackWhiteRangeIndex: control.blackWhiteRangeIndex ?? null,
  treatment: control.lightTable?.treatment ?? null,
  defaultTreatment: control.lightTable?.defaultTreatment ?? null,
  gradingMode: control.lightTable?.gradingMode ?? null,
  wheelHue: control.lightTable?.wheelHue === 'value'
    ? value : (control.lightTable?.wheelHue ?? null),
  wheelSaturation: control.lightTable?.wheelSaturation === 'value'
    ? value : (control.lightTable?.wheelSaturation ?? null),
  label: control.sliderLabel ?? control.label,
  value,
  defaultValue: control.defaultValue ?? 0
});
const cases = [{
  id: 'neutral', key: null, label: 'Neutral', value: 0,
  baselineId: 'neutral', isBaseline: true, settings: []
}];
for (const control of suite.controls) {
  const prerequisites = [
    ...(suite.lightTablePrerequisites ?? []),
    ...(control.lightTablePrerequisites ?? [])
  ].map((entry) => ({
    ...entry,
    groupLabel: entry.groupLabel ?? control.groupLabel ?? suite.groupLabel ?? suite.section,
    subgroupLabel: entry.subgroupLabel ?? null,
    defaultValue: entry.defaultValue ?? 0
  }));
  const baselineId = prerequisites.length ? `${control.key}-baseline` : 'neutral';
  if (prerequisites.length) cases.push({
    id: baselineId, key: control.key, label: `${control.label} baseline`, value: null,
    baselineId, isBaseline: true, settings: prerequisites
  });
  for (const value of control.values) cases.push({
    id: caseId(control.key, value), key: control.key, label: control.label, value,
    baselineId, isBaseline: false,
    settings: [...prerequisites, settingForControl(control, value)]
  });
}
const mimeByExtension = new Map([
  ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'], ['.png', 'image/png'],
  ['.tif', 'image/tiff'], ['.tiff', 'image/tiff']
]);

const setGradeControl = async (page, setting, target = setting.value, resetting = false) => {
  const {
    groupLabel, subgroupLabel, rangeIndex, blackWhiteRangeIndex, treatment, defaultTreatment, gradingMode,
    wheelHue, wheelSaturation, label
  } = setting;
  const group = page.locator('.lighttable-group').filter({
    has: page.getByRole('button', { name: groupLabel, exact: true })
  });
  const groupToggle = group.getByRole('button', { name: groupLabel, exact: true });
  if (await groupToggle.getAttribute('aria-expanded') === 'false') await groupToggle.click();
  let container = group;
  if (subgroupLabel) {
    const subgroup = group.locator('.lighttable-detail-controls__subgroup').filter({
      has: page.getByRole('button', { name: subgroupLabel, exact: true })
    });
    const toggle = subgroup.getByRole('button', { name: subgroupLabel, exact: true });
    if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
    container = subgroup;
  }
  if (treatment) {
    const desired = resetting ? (defaultTreatment ?? 'color') : treatment;
    const label = desired === 'black-white' ? 'B&W' : 'Color';
    const button = group.getByRole('radio', { name: label, exact: true });
    await button.click();
    if (await button.getAttribute('aria-checked') !== 'true') {
      throw new Error(`Image treatment did not settle at ${label}.`);
    }
    return;
  }
  if (rangeIndex !== null && rangeIndex !== undefined) {
    const range = group.getByRole('slider', { name: 'Color Mixer hue range', exact: true });
    await range.focus();
    await range.press('Home');
    for (let index = 0; index < rangeIndex; index += 1) await range.press('ArrowRight');
    const actualRange = Number(await range.getAttribute('aria-valuenow'));
    if (actualRange !== rangeIndex) {
      throw new Error(`Color Mixer range settled at ${actualRange}, expected ${rangeIndex}.`);
    }
  }
  if (blackWhiteRangeIndex !== null && blackWhiteRangeIndex !== undefined) {
    const range = group.getByLabel('Black and White color range', { exact: true })
      .getByRole('button').nth(blackWhiteRangeIndex);
    await range.click();
    if (!String(await range.getAttribute('class')).includes('square-icon-button--active')) {
      throw new Error(`Black & White range did not settle at ${blackWhiteRangeIndex}.`);
    }
  }
  if (gradingMode) {
    const modeLabel = gradingMode[0].toUpperCase() + gradingMode.slice(1);
    const mode = group.getByRole('radio', { name: modeLabel, exact: true });
    await mode.click();
    if (wheelHue !== null && wheelHue !== undefined) {
      const wheel = group.getByRole('slider', { name: `${modeLabel} color tint`, exact: true });
      await wheel.scrollIntoViewIfNeeded();
      const bounds = await wheel.boundingBox();
      if (!bounds) throw new Error(`${modeLabel} color wheel has no bounds.`);
      const effectiveHue = resetting ? (setting.defaultWheelHue ?? 0) : wheelHue;
      const effectiveSaturation = resetting ? (setting.defaultWheelSaturation ?? 0) : wheelSaturation;
      const hue = ((effectiveHue % 360) + 360) % 360;
      const saturation = Math.min(100, Math.max(0, effectiveSaturation ?? 0));
      const angle = hue * Math.PI / 180;
      // The component normalizes against exactly half the rendered disc. Stay
      // a fraction inside the edge so 100% remains a valid hit target.
      const radius = Math.min(bounds.width, bounds.height) * 0.497 * saturation / 100;
      await page.mouse.click(
        bounds.x + bounds.width / 2 + Math.cos(angle) * radius,
        bounds.y + bounds.height / 2 - Math.sin(angle) * radius
      );
      await wheel.waitFor({ state: 'visible' });
      const text = await wheel.getAttribute('aria-valuetext') ?? '';
      const match = text.match(/(-?\d+) degrees, (-?\d+) percent/);
      const actualSaturation = Number(match?.[2]);
      const hueMatches = saturation <= 1 || Math.abs(Number(match?.[1]) - hue) <= 2;
      if (!match || !hueMatches || Math.abs(actualSaturation - saturation) > 2) {
        throw new Error(`${modeLabel} wheel settled at ${text}, expected ${hue} degrees, ${saturation} percent.`);
      }
      return;
    }
  }
  const slider = container.locator(`input[type="range"][aria-label="${label}"]`);
  await slider.waitFor({ state: 'attached', timeout: 30_000 });
  await slider.scrollIntoViewIfNeeded();
  await slider.evaluate((input, value) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, String(value));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, target);
  const actual = Number(await slider.inputValue());
  if (actual !== target) throw new Error(`${label} settled at ${actual}, expected ${target}.`);
};

const environment = {
  ...process.env,
  LIGHTTABLE_AUTOMATION_USER_DATA: userData,
  LIGHTTABLE_AUTOMATION_HEADLESS: '1'
};
delete environment.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath: launch.executablePath,
  args: launch.args,
  cwd: workspace,
  env: environment,
  timeout: 30_000
});

const results = [];
let captureComplete = true;
let newCaptureCount = 0;
try {
  const page = await app.firstWindow({ timeout: 30_000 });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
  const driver = await attachLightTableAutomation(page, 'grade-light-parity', 30_000);
  const sourceBytes = await readFile(source);
  const sourceMime = mimeByExtension.get(path.extname(source).toLowerCase())
    ?? 'application/octet-stream';
  const sourceArtifact = await driver.registerInputArtifact(
    sourceBytes, path.basename(source), sourceMime
  );
  if (!sourceArtifact?.id) throw new Error('Grade Light source registration failed.');
  const opened = await driver.executeWorkspace('file.openArtifact', {
    artifactId: sourceArtifact.id
  });
  const documentId = opened.value?.documentId;
  if (!documentId) throw new Error('Grade Light source open did not return a document ID.');
  await driver.waitForDocument(documentId, 120_000);
  let gradePanel = page.getByLabel('Grade Layer properties', { exact: true }).last();
  if (!await gradePanel.isVisible().catch(() => false)) {
    const trigger = page.getByRole('button', { name: 'New fill or processing layer' });
    await trigger.click();
    await page.getByRole('menu', { name: 'New fill or processing layer' })
      .getByRole('menuitem', { name: 'New Grade layer', exact: true }).click();
    gradePanel = page.getByLabel('Grade Layer properties', { exact: true }).last();
  }
  await gradePanel.waitFor({ state: 'visible', timeout: 30_000 });

  let previousSettings = [];
  for (const entry of cases) {
    // Keep a single decoded document alive for speed and deterministically
    // restore the previous slider before authoring the next isolated case.
    for (const setting of [...previousSettings].reverse()) {
      await setGradeControl(page, setting, setting.defaultValue, true);
    }
    previousSettings = [];
    const output = path.join(outputDirectory, `${entry.id}.png`);
    if (resumePartial && entry.key !== refreshControl
      && await access(output).then(() => true, () => false)) {
      results.push({ ...entry, output });
      process.stdout.write(`LightTable ${entry.id}: reused partial capture\n`);
      continue;
    }
    if (maxNewCaptures > 0 && newCaptureCount >= maxNewCaptures) {
      captureComplete = false;
      break;
    }
    for (const setting of entry.settings) await setGradeControl(page, setting);
    const exported = await driver.execute(documentId, 'file.exportPng', {}, {
      requireCompleted: false
    });
    const task = await driver.waitForTask(documentId, exported.taskId, 120_000);
    if (!task.artifact) throw new Error('Grade Light PNG export did not publish an artifact.');
    const png = await driver.readArtifact(task.artifact.id);
    if (!png) throw new Error('Grade Light PNG export artifact cannot be read.');
    await writeFile(output, png.bytes);
    newCaptureCount += 1;
    results.push({ ...entry, output });
    process.stdout.write(`LightTable ${entry.id}: ${output}\n`);
    previousSettings = entry.settings;
  }
  if (pageErrors.length) throw new Error(`LightTable runtime errors: ${pageErrors.join('\n')}`);
} finally {
  let closeTimer;
  const gracefulClose = app.close().catch(() => {});
  await Promise.race([
    gracefulClose,
    new Promise((resolve) => {
      closeTimer = setTimeout(() => {
        app.process().kill();
        resolve();
      }, 5_000);
      closeTimer.unref?.();
    })
  ]);
  if (closeTimer) clearTimeout(closeTimer);
}

if (captureComplete) {
  await writeFile(path.join(outputDirectory, 'capture-report.json'), `${JSON.stringify({
    schema: 2,
    generatedAt: new Date().toISOString(),
    section: suite.section,
    source,
    sourceEvidence,
    caseManifestSha256,
    isolation: 'One decoded source and one topmost Grade Layer are reused; the prior control is verified at neutral before exactly one Grade control is authored. Long corpora relaunch the renderer between bounded batches.',
    cases: results
  }, null, 2)}\n`);
} else {
  process.stdout.write(`LightTable partial checkpoint: ${newCaptureCount} new capture(s); relaunch required.\n`);
}
