import { _electron as electron } from 'playwright-core';
import { access, mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const workspaceRoot = path.resolve(import.meta.dirname, '..');
const desktopAppPath = path.join(workspaceRoot, 'apps', 'desktop');
const executablePath = path.join(workspaceRoot, 'node_modules', 'electron', 'dist', 'electron.exe');
const sourceFile = path.resolve(process.argv[2] || 'D:\\TextTest.psd');
const runId = new Date().toISOString().replaceAll(/[:.]/g, '-');
const outputDirectory = path.join(workspaceRoot, 'tmp', 'recovery-smoke', runId);
const userDataPath = path.join(outputDirectory, 'user-data');
const savedFile = path.join(outputDirectory, 'TextTest-recovered-lighttable.png');
const diagnostics = { sourceFile, outputDirectory, stages: [], pageErrors: [] };
const launchEnvironment = { ...process.env };
delete launchEnvironment.ELECTRON_RUN_AS_NODE;

await Promise.all([
  access(sourceFile),
  access(executablePath),
  mkdir(userDataPath, { recursive: true })
]);

const launch = async (environment = {}) => {
  const app = await electron.launch({
    executablePath,
    args: [desktopAppPath],
    cwd: workspaceRoot,
    env: {
      ...launchEnvironment,
      LIGHTTABLE_AUTOMATION_USER_DATA: userDataPath,
      ...environment
    },
    timeout: 30_000
  });
  const window = await app.firstWindow({ timeout: 30_000 });
  window.on('pageerror', (error) => diagnostics.pageErrors.push(error.stack ?? error.message));
  return { app, window };
};

const layerProjection = async (window) => window.locator('.lighttable-layer').evaluateAll((rows) =>
  rows.map((row) => ({
    name: row.querySelector('.lighttable-layer__name')?.value ?? '',
    type: row.querySelector('.lighttable-layer__thumbnail')?.getAttribute('title') ?? ''
  }))
);

let first;
let second;
let third;
try {
  first = await launch({ LIGHTTABLE_AUTOMATION_OPEN_FILE: sourceFile });
  await first.window.getByRole('button', { name: 'Open file' }).click();
  await first.window.locator('.lighttable-toolbar__meta').filter({ hasText: /ready/i })
    .waitFor({ state: 'visible', timeout: 45_000 });
  await first.window.getByRole('button', { name: 'Rectangle (U)' }).click();
  const viewport = first.window.locator('.lighttable-viewport');
  const box = await viewport.boundingBox();
  if (!box) throw new Error('The source document has no interactive viewport.');
  await first.window.mouse.move(box.x + box.width * 0.67, box.y + box.height * 0.68);
  await first.window.mouse.down();
  await first.window.mouse.move(box.x + box.width * 0.77, box.y + box.height * 0.76, { steps: 12 });
  await first.window.mouse.up();
  await first.window.waitForFunction(() =>
    document.querySelector('.lighttable-toolbar__status')?.textContent?.includes('Recovery checkpoint available'),
  undefined, { timeout: 30_000 });
  const editedLayers = await layerProjection(first.window);
  diagnostics.stages.push({ name: 'checkpoint', editedLayers });
  first.app.process().kill();
  await first.app.close().catch(() => {});
  first = null;

  second = await launch({ LIGHTTABLE_AUTOMATION_SAVE_FILE: savedFile });
  const recoveryHeading = second.window.getByRole('heading', { name: 'Recoverable work' });
  await recoveryHeading.waitFor({ state: 'visible', timeout: 30_000 });
  const openButton = second.window.getByRole('button', { name: 'Open recovered copy' });
  const previewButton = second.window.getByRole('button', { name: 'Preview' });
  const discardButton = second.window.getByRole('button', { name: 'Discard' });
  for (const control of [openButton, previewButton, discardButton]) {
    if (!(await control.isEnabled()) || !(await control.evaluate((node) => node.tabIndex >= 0))) {
      throw new Error('A recovery action is not keyboard focusable.');
    }
  }
  await second.window.screenshot({ path: path.join(outputDirectory, '01-recovery-startup.png') });
  await previewButton.click();
  await second.window.locator('.lighttable-launcher__recovery-preview img')
    .waitFor({ state: 'visible', timeout: 15_000 });
  await second.window.screenshot({ path: path.join(outputDirectory, '02-recovery-preview.png') });
  await openButton.click();
  await second.window.getByText(/Recovered copy of .* Save creates a new file\./)
    .waitFor({ state: 'visible', timeout: 45_000 });
  await second.window.locator('.lighttable-toolbar__meta').filter({ hasText: /ready/i })
    .waitFor({ state: 'visible', timeout: 45_000 });
  const recoveredLayers = await layerProjection(second.window);
  if (JSON.stringify(recoveredLayers) !== JSON.stringify(editedLayers)) {
    throw new Error('Recovered canonical layer projection differs from the edited checkpoint.');
  }
  const recoveredTitle = await second.window.locator('.lighttable-document-tab--active').textContent();
  if (!recoveredTitle?.includes('(Recovered)') || !recoveredTitle.includes('*')) {
    throw new Error(`Recovered document is not visibly dirty: ${recoveredTitle}`);
  }
  await second.window.screenshot({ path: path.join(outputDirectory, '03-recovered-editor.png') });
  await second.window.keyboard.press('Control+S');
  await second.window.waitForFunction(() =>
    !document.querySelector('.lighttable-document-tab--active')?.textContent?.includes('*'),
  undefined, { timeout: 30_000 });
  await access(savedFile);
  const recoveryDirectory = path.join(userDataPath, 'recovery-v1');
  let remaining = await readdir(recoveryDirectory).catch(() => []);
  for (let attempt = 0; attempt < 40 && remaining.some((name) => name.endsWith('.ltrecovery')); attempt += 1) {
    await second.window.waitForTimeout(100);
    remaining = await readdir(recoveryDirectory).catch(() => []);
  }
  if (remaining.some((name) => name.endsWith('.ltrecovery'))) {
    throw new Error('A verified save did not remove the resolved recovery record.');
  }
  diagnostics.stages.push({ name: 'recovered-and-saved', recoveredLayers, recoveredTitle });
  await second.app.close();
  second = null;

  third = await launch({ LIGHTTABLE_AUTOMATION_OPEN_FILE: savedFile });
  await third.window.getByRole('button', { name: 'Open file' }).click();
  await third.window.locator('.lighttable-toolbar__meta').filter({ hasText: /ready/i })
    .waitFor({ state: 'visible', timeout: 45_000 });
  const reopenedLayers = await layerProjection(third.window);
  if (JSON.stringify(reopenedLayers) !== JSON.stringify(editedLayers)) {
    throw new Error('Saved recovery does not reopen with canonical layer equality.');
  }
  diagnostics.stages.push({
    name: 'reopened',
    reopenedLayers,
    savedBytes: (await stat(savedFile)).size
  });
  await third.window.screenshot({ path: path.join(outputDirectory, '04-reopened.png') });
} finally {
  await first?.app.close().catch(() => {});
  await second?.app.close().catch(() => {});
  await third?.app.close().catch(() => {});
  await writeFile(
    path.join(outputDirectory, 'report.json'),
    `${JSON.stringify(diagnostics, null, 2)}\n`,
    'utf8'
  );
}

if (diagnostics.pageErrors.length > 0) {
  throw new Error(`Recovery smoke reported page errors:\n${diagnostics.pageErrors.join('\n')}`);
}
console.log(`Recovery smoke passed: ${outputDirectory}`);
