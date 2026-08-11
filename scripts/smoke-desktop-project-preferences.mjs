import { _electron as electron } from 'playwright-core';
import { access, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(import.meta.dirname, '..');
const desktop = path.join(root, 'apps', 'desktop');
const executable = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const temporaryRoot = path.join(root, 'tmp', 'smoke-project-preferences');
const userData = path.join(temporaryRoot, 'user-data');
const projects = path.join(temporaryRoot, 'projects');
const source = path.join(root, 'packages', 'lighttable-app', 'src', 'assets', 'icons', 'image.png');
const screenshot = path.join(temporaryRoot, 'project-preferences.png');

await rm(temporaryRoot, { recursive: true, force: true });
await Promise.all([mkdir(userData, { recursive: true }), mkdir(projects, { recursive: true })]);
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
      LIGHTTABLE_AUTOMATION_PROJECT_PARENT: projects,
      LIGHTTABLE_AUTOMATION_OPEN_FILE: source
    },
    timeout: 30_000
  });
  const window = await app.firstWindow({ timeout: 30_000 });
  await window.waitForLoadState('domcontentloaded');
  const sourceTab = window.getByRole('tab', { name: /image\.png/i });
  await window.waitForTimeout(1_500);
  if (!await sourceTab.isVisible().catch(() => false)) {
    const open = window.getByRole('button', { name: 'Open file' });
    if (!await open.isVisible().catch(() => false)) {
      throw new Error(`Launcher did not become available: ${await window.locator('body').innerText()}`);
    }
    await open.click();
  }
  await sourceTab.waitFor({ timeout: 30_000 });

  await window.locator('.shots-app-menu__button:visible').filter({ hasText: /^Edit$/ }).click();
  await window.locator('.context-menu:visible').getByRole('menuitem', { name: 'Preferences...' }).click();
  const dialog = window.getByRole('dialog', { name: 'Preferences' });
  await dialog.getByRole('button', { name: 'Projects' }).click();
  await dialog.getByText('Folder name', { exact: true }).waitFor();
  await dialog.getByText('Relative path', { exact: true }).waitFor();

  await dialog.getByLabel('New project folder name').fill('References');
  await dialog.getByLabel('New project folder relative path').fill('References/Style');
  await dialog.getByRole('button', { name: 'Add folder' }).click();
  await dialog.getByLabel('Additional folder 1 name').waitFor();
  await dialog.screenshot({ path: screenshot });
  await dialog.getByRole('button', { name: 'Save' }).click();

  await window.locator('.shots-app-menu__button:visible').filter({ hasText: /^Edit$/ }).click();
  await window.locator('.context-menu:visible').getByRole('menuitem', { name: 'Preferences...' }).click();
  const reopened = window.getByRole('dialog', { name: 'Preferences' });
  await reopened.getByRole('button', { name: 'Projects' }).click();
  if (await reopened.getByLabel('Additional folder 1 name').inputValue() !== 'References') {
    throw new Error('The custom project folder was not persisted by Preferences.');
  }
  await reopened.getByRole('button', { name: 'Cancel' }).click();

  await window.locator('.shots-app-menu__button:visible').filter({ hasText: /^File$/ }).click();
  await window.locator('.context-menu:visible').getByRole('menuitem', { name: 'New Project...' }).click();
  const projectDialog = window.getByRole('dialog', { name: 'New project' });
  await projectDialog.getByRole('button', { name: 'Choose...' }).click();
  await projectDialog.getByLabel('Name').fill('Preferences Folder Project');
  await projectDialog.getByRole('button', { name: 'Create' }).click();
  await access(path.join(projects, 'Preferences Folder Project', 'References', 'Style'));
  process.stdout.write(`Desktop project Preferences smoke passed. Screenshot: ${screenshot}\n`);
} finally {
  await app?.close().catch(() => undefined);
}
