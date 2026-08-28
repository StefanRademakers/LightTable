import { _electron as electron } from 'playwright-core';
import { copyFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(import.meta.dirname, '..');
const desktop = path.join(root, 'apps', 'desktop');
const executable = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const temporaryRoot = path.join(root, 'tmp', 'smoke-genai-project-assets');
const userData = path.join(temporaryRoot, 'user-data');
const projects = path.join(temporaryRoot, 'projects');
const source = path.join(root, 'packages', 'lighttable-app', 'src', 'assets', 'icons', 'image.png');

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
    const open = window.getByRole('button', { name: 'Open', exact: true });
    if (!await open.isVisible().catch(() => false)) {
      throw new Error(`Launcher did not become available: ${await window.locator('body').innerText()}`);
    }
    await open.click();
  }
  await sourceTab.waitFor({ timeout: 30_000 });

  await window.locator('.shots-app-menu__button:visible').filter({ hasText: /^File$/ }).click();
  await window.locator('.context-menu:visible').getByRole('menuitem', { name: 'New Project...' }).click();
  const dialog = window.getByRole('dialog', { name: 'New project' });
  await dialog.getByRole('button', { name: 'Choose...' }).click();
  await dialog.getByLabel('Name').fill('GenAI Asset Project');
  await dialog.getByRole('button', { name: 'Create' }).click();

  const deadline = Date.now() + 10_000;
  let project = null;
  while (!project && Date.now() < deadline) {
    project = await window.evaluate(() => window.lightTableDesktop.currentProject());
    if (!project) await window.waitForTimeout(100);
  }
  if (!project) throw new Error('New project did not become active.');

  const assetEvent = window.evaluate((projectId) => new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      unsubscribe();
      reject(new Error('Timed out waiting for the project asset catalog event.'));
    }, 15_000);
    const unsubscribe = window.lightTableDesktop.onGenAiProjectAssetsChanged((changedProjectId) => {
      if (changedProjectId !== projectId) return;
      window.clearTimeout(timeout);
      unsubscribe();
      resolve(changedProjectId);
    });
  }), project.id);

  const indexedPath = path.join(project.rootPath, 'Characters', 'reference-lighttable.png');
  await copyFile(source, indexedPath);
  await assetEvent;

  const assets = await window.evaluate(
    async (projectId) => (await window.lightTableDesktop.loadGenAiProjectAssetCatalog(projectId)).assets,
    project.id
  );
  const reference = assets.find((asset) => asset.label === 'reference-lighttable.png');
  if (!reference) throw new Error(`Indexed project image was not exposed to GenAI: ${JSON.stringify(assets)}`);
  if ('path' in reference || 'rootPath' in reference) {
    throw new Error('The renderer-facing GenAI asset leaked a filesystem path.');
  }
  process.stdout.write('Desktop GenAI project asset refresh smoke passed.\n');
} finally {
  await app?.close().catch(() => undefined);
}
