import { _electron as electron } from 'playwright-core';
import { access, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { resolveDesktopTestLaunch } from './desktop-test-startup.mjs';

const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, 'tmp', 'project-home-smoke');
const userData = path.join(output, 'user-data');
const projects = path.join(output, 'projects');
const reportPath = path.join(output, 'report.json');
const projectName = 'Project Home Smoke';
const projectLocation = path.join(projects, projectName);
const source = path.join(root, 'packages', 'lighttable-app', 'src', 'assets', 'icons', 'image.png');

async function assertEditorFillsWindow(page) {
  const geometry = await page.locator('.lighttable-backdrop:not(.lighttable-backdrop--inactive) .lighttable').evaluate((editor) => {
    const rect = editor.getBoundingClientRect();
    return {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight
    };
  });
  const tolerance = 1;
  if (
    Math.abs(geometry.x) > tolerance
    || Math.abs(geometry.y) > tolerance
    || Math.abs(geometry.width - geometry.viewportWidth) > tolerance
    || Math.abs(geometry.height - geometry.viewportHeight) > tolerance
  ) {
    throw new Error(`Editor did not fill the window: ${JSON.stringify(geometry)}`);
  }
}

async function assertFirstDocumentHydrates(page) {
  await page.locator('.lighttable-layer[data-layer-id]').first().waitFor({
    state: 'visible',
    timeout: 15_000
  });
}

await rm(output, { recursive: true, force: true });
await Promise.all([mkdir(userData, { recursive: true }), mkdir(projectLocation, { recursive: true })]);
const launch = await resolveDesktopTestLaunch(root);
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;

const app = await electron.launch({
  executablePath: launch.executablePath,
  args: launch.args,
  cwd: root,
  env: {
    ...environment,
    LIGHTTABLE_AUTOMATION_USER_DATA: userData,
    LIGHTTABLE_AUTOMATION_PROJECT_LOCATION: projectLocation
  },
  timeout: 30_000
});

try {
  const page = await app.firstWindow({ timeout: 30_000 });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
  await page.getByRole('button', { name: 'New Project', exact: true }).waitFor();
  await page.getByRole('button', { name: 'New Project', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Create project' });
  await dialog.getByRole('button', { name: 'Choose...' }).click();
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();

  const home = page.locator('.lighttable-project-home');
  await home.waitFor({ state: 'visible' });
  await home.getByRole('heading', { name: projectName }).waitFor();
  if (await home.locator('canvas').count()) throw new Error('Project Home mounted an image canvas.');
  if (await page.locator('.lighttable-backdrop').count()) throw new Error('Project Home mounted a hidden image editor.');
  await access(path.join(projects, projectName, 'project.ltproject'));

  await home.getByRole('button', { name: 'New Document', exact: true }).click();
  const newDocument = page.getByRole('dialog', { name: 'New document' });
  await newDocument.getByRole('button', { name: 'Create', exact: true }).click();
  await page.locator('.lighttable-backdrop:not(.lighttable-backdrop--inactive)').waitFor();
  await assertEditorFillsWindow(page);
  await assertFirstDocumentHydrates(page);
  await page.getByRole('button', { name: 'Close editor', exact: true }).click();
  await home.waitFor({ state: 'visible' });

  await home.locator('input[type="file"][multiple]').setInputFiles(source);
  await home.getByText('References', { exact: true }).click();
  const importedAsset = home.getByText(/^image-.*\.png$/).first();
  await importedAsset.waitFor({ state: 'visible' });
  if (await page.locator('.lighttable-backdrop').count()) {
    throw new Error('Project import opened an implicit image editor.');
  }
  await importedAsset.dblclick();
  await page.locator('.lighttable-backdrop:not(.lighttable-backdrop--inactive)').waitFor();
  await assertEditorFillsWindow(page);
  await assertFirstDocumentHydrates(page);
  await page.getByRole('button', { name: 'Close editor', exact: true }).click();
  await home.waitFor({ state: 'visible' });
  if (pageErrors.length) throw new Error(`Renderer errors: ${JSON.stringify(pageErrors)}`);

  await page.screenshot({ path: path.join(output, 'project-home.png') });
  await writeFile(reportPath, `${JSON.stringify({
    projectName,
    durableManifest: true,
    imageCanvasCount: 0,
    importedAssetWithoutImplicitDocument: true,
    openedImportedAsset: true,
    returnedAfterClosingFinalDocument: true,
    pageErrors
  }, null, 2)}\n`);
  process.stdout.write(`Desktop Project Home smoke passed. Report: ${reportPath}\n`);
} finally {
  await app.close();
}
