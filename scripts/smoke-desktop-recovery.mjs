import { _electron as electron } from 'playwright-core';
import { access, mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { resolveDesktopTestLaunch } from './desktop-test-startup.mjs';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';

const workspaceRoot = path.resolve(import.meta.dirname, '..');
const sourceFile = path.resolve(process.argv[2]
  || path.join(workspaceRoot, 'architecture', 'ui', '1.png'));
const runId = new Date().toISOString().replaceAll(/[:.]/g, '-');
const outputDirectory = path.join(workspaceRoot, 'tmp', 'recovery-smoke', runId);
const userDataPath = path.join(outputDirectory, 'user-data');
const savedFile = path.join(outputDirectory, 'TextTest-recovered-lighttable.png');
const diagnostics = { sourceFile, outputDirectory, stages: [], pageErrors: [], console: [] };
const launchEnvironment = { ...process.env };
delete launchEnvironment.ELECTRON_RUN_AS_NODE;
const desktopLaunch = await resolveDesktopTestLaunch(workspaceRoot, { requirePackaged: true });

await Promise.all([
  access(sourceFile),
  access(desktopLaunch.executablePath),
  mkdir(userDataPath, { recursive: true })
]);

const launch = async (environment = {}) => {
  const app = await electron.launch({
    executablePath: desktopLaunch.executablePath,
    args: desktopLaunch.args,
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
  window.on('console', (message) => {
    const text = message.text();
    if (/recovery|checkpoint/i.test(text)) diagnostics.console.push(`${message.type()}: ${text}`);
  });
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
  await first.window.getByRole('button', { name: 'Open', exact: true }).click();
  await first.window.locator('.lighttable-toolbar__meta').filter({ hasText: /ready/i })
    .waitFor({ state: 'visible', timeout: 45_000 });
  const driver = await attachLightTableAutomation(first.window);
  const documentId = (await driver.queryWorkspace()).activeDocumentId;
  if (!documentId) throw new Error('Recovery smoke opened no active document.');
  await driver.execute(documentId, 'vector.create', {
    name: 'Recovery rectangle',
    primitive: { kind: 'rectangle', x: 64, y: 48, width: 160, height: 96,
      cornerRadii: [12, 12, 12, 12] },
    style: { fill: { type: 'solid', color: [0.2, 0.55, 0.95, 1] } }
  });
  diagnostics.stages.push({ name: 'dirty-command', document: await driver.queryDocument(documentId),
    layers: await driver.queryLayers(documentId) });
  const recoveryDirectory = path.join(userDataPath, 'recovery-v1');
  const checkpointDeadline = Date.now() + 45_000;
  while (Date.now() < checkpointDeadline) {
    const records = await readdir(recoveryDirectory).catch(() => []);
    if (records.some((name) => name.endsWith('.ltrecovery'))) break;
    await first.window.waitForTimeout(100);
  }
  const checkpointRecords = await readdir(recoveryDirectory).catch(() => []);
  if (!checkpointRecords.some((name) => name.endsWith('.ltrecovery'))) {
    throw new Error('The dirty document did not persist a recovery checkpoint.');
  }
  const editedLayers = await layerProjection(first.window);
  diagnostics.stages.push({ name: 'checkpoint', editedLayers });
  first.app.process().kill();
  await first.app.close().catch(() => {});
  first = null;

  second = await launch({ LIGHTTABLE_AUTOMATION_SAVE_FILE: savedFile });
  await second.window.getByRole('button', { name: /Recovery Records/ }).click();
  const recoveryHeading = second.window.getByRole('heading', { name: 'Recovery Records' });
  await recoveryHeading.waitFor({ state: 'visible', timeout: 30_000 });
  const openButton = second.window.locator('.lighttable-launcher-gallery__card')
    .getByRole('button').first();
  const discardButton = second.window.getByRole('button', { name: /Discard recovery for/ });
  for (const control of [openButton, discardButton]) {
    if (!(await control.isEnabled()) || !(await control.evaluate((node) => node.tabIndex >= 0))) {
      throw new Error('A recovery action is not keyboard focusable.');
    }
  }
  await second.window.screenshot({ path: path.join(outputDirectory, '01-recovery-startup.png') });
  await second.window.locator('.lighttable-launcher-gallery__preview img')
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
  await third.window.getByRole('button', { name: 'Open', exact: true }).click();
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
