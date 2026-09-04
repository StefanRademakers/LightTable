import { _electron as electron } from 'playwright-core';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(import.meta.dirname, '..');
const desktop = path.join(root, 'apps', 'desktop');
const executable = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const temporaryRoot = path.join(root, 'tmp', 'smoke-project-lifecycle');
const userData = path.join(temporaryRoot, 'user-data');
const projects = path.join(temporaryRoot, 'projects');
const source = path.join(root, 'packages', 'lighttable-app', 'src', 'assets', 'icons', 'image.png');
const projectName = 'Lifecycle Smoke Project';
const projectLocation = path.join(projects, projectName);
const screenshot = path.join(temporaryRoot, 'project-lifecycle.png');

await rm(temporaryRoot, { recursive: true, force: true });
await Promise.all([mkdir(userData, { recursive: true }), mkdir(projectLocation, { recursive: true })]);
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;

let app;
try {
  app = await electron.launch({
    executablePath: executable,
    args: [desktop],
    cwd: root,
    env: {
      ...environment,
      LIGHTTABLE_AUTOMATION_USER_DATA: userData,
      LIGHTTABLE_AUTOMATION_PROJECT_LOCATION: projectLocation,
      LIGHTTABLE_AUTOMATION_OPEN_FILE: source
    },
    timeout: 30_000
  });
  const window = await app.firstWindow({ timeout: 30_000 });
  const pageErrors = [];
  const consoleErrors = [];
  window.on('console', (message) => {
    process.stderr.write(`[renderer:${message.type()}] ${message.text()}\n`);
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  window.on('requestfailed', (request) => process.stderr.write(
    `[request:failed] ${request.url()} ${request.failure()?.errorText ?? ''}\n`
  ));
  window.on('response', (response) => {
    if (response.status() >= 400) process.stderr.write(`[response:${response.status()}] ${response.url()}\n`);
  });
  window.on('pageerror', (error) => {
    pageErrors.push(error.stack ?? error.message);
    process.stderr.write(`[renderer:error] ${error.name}: ${error.message}\n${error.stack ?? ''}\n`);
  });
  const sourceTab = window.getByRole('tab', { name: /image\.png/i });
  await window.waitForLoadState('domcontentloaded');
  await window.waitForTimeout(1_500);
  if (!await sourceTab.isVisible().catch(() => false)) {
    const open = window.getByRole('button', { name: 'Open', exact: true });
    if (!await open.isVisible().catch(() => false)) {
      throw new Error(`Launcher did not become available: ${await window.locator('body').innerText()}`);
    }
    await open.click();
  }
  await sourceTab.waitFor({ timeout: 30_000 });

  await window.keyboard.press('Control+N');
  const documentDialog = window.getByRole('dialog', { name: 'New document' });
  await documentDialog.waitFor({ state: 'visible' });
  await documentDialog.getByRole('button', { name: 'Create' }).click();
  await documentDialog.waitFor({ state: 'detached', timeout: 30_000 });
  await window.waitForFunction(() => document.querySelectorAll('[role="tab"]').length >= 2);
  const visibleEditor = () => window.locator('.lighttable-backdrop:not(.lighttable-backdrop--inactive)');
  const documentCount = await visibleEditor().locator('.ui-document-tabs__tab').count();

  const openFileMenu = async () => {
    await visibleEditor().getByRole('menuitem', { name: 'File', exact: true }).click();
    return window.locator('.ui-menu:visible').first();
  };
  await (await openFileMenu()).getByRole('menuitem', { name: 'New Project...' }).click();
  const projectDialog = window.getByRole('dialog', { name: 'Create project' });
  await projectDialog.getByRole('button', { name: /^Choose/u }).click();
  await projectDialog.getByRole('button', { name: 'Create' }).click();
  await window.getByRole('button', { name: `Open project folder for ${projectName}` }).waitFor();

  await (await openFileMenu()).getByRole('menuitem', { name: new RegExp(`Close Project \\(${projectName}\\)`) }).click();
  await window.getByRole('button', { name: `Open project folder for ${projectName}` }).waitFor({ state: 'detached' });
  if (await visibleEditor().locator('.ui-document-tabs__tab').count() !== documentCount) {
    throw new Error('Closing a project changed the set of open documents.');
  }

  const fileMenu = await openFileMenu();
  const recent = fileMenu.getByRole('menuitem', { name: 'Recent Projects' });
  await recent.hover();
  await window.getByRole('menuitem', { name: projectName }).click();
  await window.getByRole('button', { name: `Open project folder for ${projectName}` }).waitFor();
  if (await visibleEditor().locator('.ui-document-tabs__tab').count() !== documentCount) {
    throw new Error('Reopening a project changed the set of open documents.');
  }
  await window.reload({ waitUntil: 'domcontentloaded' });
  await window.locator('.lighttable-project-home').getByRole('heading', { name: projectName })
    .waitFor({ timeout: 30_000 });
  if (pageErrors.length || consoleErrors.length) {
    throw new Error(`Runtime errors: ${JSON.stringify({ pageErrors, consoleErrors })}`);
  }
  await window.screenshot({ path: screenshot });
  process.stdout.write(`Desktop project lifecycle smoke passed with ${documentCount} open documents.\n`);
} finally {
  await app?.close().catch(() => undefined);
}
