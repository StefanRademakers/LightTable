import { _electron as electron } from 'playwright-core';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';

const workspace = path.resolve(import.meta.dirname, '..');
const sourceArgument = process.argv.find((value) => value.startsWith('--source='));
const rootArgument = process.argv.find((value) => value.startsWith('--root='));
const casesArgument = process.argv.find((value) => value.startsWith('--cases='));
const resumePartial = process.argv.includes('--resume-partial');
const refreshControlArgument = process.argv.find((value) => value.startsWith('--refresh-control='));
const refreshControl = refreshControlArgument?.slice('--refresh-control='.length) ?? null;
const source = path.resolve(sourceArgument?.slice('--source='.length) ?? 'D:\\people.jpg');
const root = path.resolve(rootArgument?.slice('--root='.length)
  ?? 'D:\\mediavibe\\LightTableTests\\GradeLightParity');
const outputDirectory = path.join(root, 'lighttable');
const casePath = path.resolve(casesArgument?.slice('--cases='.length)
  ?? path.join(import.meta.dirname, 'grade-light-parity-cases.json'));
const executable = path.join(workspace, 'node_modules', 'electron', 'dist', 'electron.exe');
const userData = path.join(root, 'runtime', `lighttable-${process.pid}`);
await Promise.all([
  access(source), access(executable), access(casePath),
  mkdir(outputDirectory, { recursive: true }), mkdir(userData, { recursive: true })
]);

const suite = JSON.parse(await readFile(casePath, 'utf8'));
const caseId = (key, value) => `${key}-${value < 0 ? 'minus' : 'plus'}-${Math.abs(value)}`
  .replaceAll('.', '_');
const settingForControl = (control, value) => ({
  groupLabel: control.groupLabel ?? suite.groupLabel ?? suite.section,
  subgroupLabel: control.subgroupLabel ?? null,
  label: control.label,
  value,
  defaultValue: control.defaultValue ?? 0
});
const cases = [{
  id: 'neutral', key: null, label: 'Neutral', value: 0,
  baselineId: 'neutral', isBaseline: true, settings: []
}];
for (const control of suite.controls) {
  const prerequisites = (control.lightTablePrerequisites ?? []).map((entry) => ({
    groupLabel: entry.groupLabel ?? control.groupLabel ?? suite.groupLabel ?? suite.section,
    subgroupLabel: entry.subgroupLabel ?? null,
    label: entry.label,
    value: entry.value,
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

const setGradeControl = async (page, setting, target = setting.value) => {
  const { groupLabel, subgroupLabel, label } = setting;
  const group = page.locator('.lighttable-group').filter({
    has: page.getByRole('button', { name: groupLabel, exact: true })
  });
  let container = group;
  if (subgroupLabel) {
    const subgroup = group.locator('.lighttable-detail-controls__subgroup').filter({
      has: page.getByRole('button', { name: subgroupLabel, exact: true })
    });
    const toggle = subgroup.getByRole('button', { name: subgroupLabel, exact: true });
    if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
    container = subgroup;
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

const environment = { ...process.env, LIGHTTABLE_AUTOMATION_USER_DATA: userData };
delete environment.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath: executable,
  args: [path.join(workspace, 'apps', 'desktop')],
  cwd: workspace,
  env: environment,
  timeout: 30_000
});

const results = [];
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
      await setGradeControl(page, setting, setting.defaultValue);
    }
    previousSettings = [];
    const output = path.join(outputDirectory, `${entry.id}.png`);
    if (resumePartial && entry.key !== refreshControl
      && await access(output).then(() => true, () => false)) {
      results.push({ ...entry, output });
      process.stdout.write(`LightTable ${entry.id}: reused partial capture\n`);
      continue;
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
    results.push({ ...entry, output });
    process.stdout.write(`LightTable ${entry.id}: ${output}\n`);
    previousSettings = entry.settings;
  }
  if (pageErrors.length) throw new Error(`LightTable runtime errors: ${pageErrors.join('\n')}`);
} finally {
  await app.close().catch(() => {});
}

await writeFile(path.join(outputDirectory, 'capture-report.json'), `${JSON.stringify({
  schema: 1,
  generatedAt: new Date().toISOString(),
  section: suite.section,
  source,
  isolation: 'One decoded source and one topmost Grade Layer are reused; the prior control is verified at neutral before exactly one Light control is authored.',
  cases: results
}, null, 2)}\n`);
