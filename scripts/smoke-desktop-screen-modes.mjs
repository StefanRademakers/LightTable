import { _electron as electron } from 'playwright-core';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import {
  captureDesktopTestState,
  waitForDesktopLauncher
} from './desktop-test-startup.mjs';

const root = path.resolve(import.meta.dirname, '..');
const sourceFile = 'generated-screen-mode-document';
const output = path.join(root, 'tmp', 'screen-mode-smoke');
const executablePath = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const reportPath = path.join(output, 'report.json');

await Promise.all([access(executablePath), mkdir(output, { recursive: true })]);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath,
  args: [path.join(root, 'apps', 'desktop')],
  cwd: root,
  env: {
    ...env,
    LIGHTTABLE_AUTOMATION_USER_DATA: path.join(output, `user-data-${process.pid}`)
  },
  timeout: 30_000
});

try {
  const page = await app.firstWindow({ timeout: 30_000 });
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      consoleErrors.push(`[${message.type()}] ${message.text()}`);
    }
  });
  await waitForDesktopLauncher({
    app,
    page,
    outputDirectory: output,
    sourceFile,
    pageErrors,
    label: 'screen-modes'
  });
  await page.getByRole('button', { name: 'New document' }).click();
  const dialog = page.getByRole('heading', { name: 'New document' }).locator('..').locator('..');
  await dialog.getByLabel('Width').fill('640');
  await dialog.getByLabel('Height').fill('480');
  await dialog.getByRole('button', { name: 'Create' }).click();
  try {
    await page.locator('.lighttable-toolbar__meta').filter({ hasText: /ready/i })
      .waitFor({ state: 'visible', timeout: 60_000 });
  } catch (error) {
    const diagnosticPath = await captureDesktopTestState({
      app,
      page,
      outputDirectory: output,
      sourceFile,
      pageErrors,
      label: 'screen-modes-open',
      timeout: 60_000
    });
    throw new Error(`The generated screen-mode document did not become ready. Diagnostic: ${diagnosticPath}. Console: ${JSON.stringify(consoleErrors)}`, {
      cause: error
    });
  }

  await page.screenshot({ path: path.join(output, '01-normal.png') });
  const normalViewport = page.viewportSize();
  await page.keyboard.press('f');
  await page.waitForTimeout(350);
  await page.screenshot({ path: path.join(output, '02-fullscreen.png') });
  const fullscreenViewport = page.viewportSize();

  await page.keyboard.press('f');
  await page.locator('.lighttable--canvas-only').waitFor({ state: 'visible' });
  await page.waitForTimeout(500);
  const canvasOnlyGeometry = await page.evaluate(() => {
    const workspace = document.querySelector('.lighttable-dock-workspace').getBoundingClientRect();
    const documentHost = document.querySelector('.lighttable-document-host');
    const documentGroupElement = documentHost?.closest('.dv-groupview') ?? documentHost;
    if (!documentGroupElement) throw new Error('Canvas-only document host is unavailable.');
    const documentGroup = documentGroupElement.getBoundingClientRect();
    const visibleAccessoryGroups = [...document.querySelectorAll('.dv-groupview')]
      .filter((group) => !group.querySelector('.lighttable-document-host'))
      .filter((group) => {
        const style = getComputedStyle(group);
        const bounds = group.getBoundingClientRect();
        return style.visibility !== 'hidden' && bounds.width > 0 && bounds.height > 0;
      }).length;
    return {
      workspace: { left: workspace.left, top: workspace.top, right: workspace.right, bottom: workspace.bottom },
      documentGroup: {
        left: documentGroup.left,
        top: documentGroup.top,
        right: documentGroup.right,
        bottom: documentGroup.bottom
      },
      visibleAccessoryGroups
    };
  });
  const { workspace, documentGroup } = canvasOnlyGeometry;
  if (Math.abs(documentGroup.left - workspace.left) > 1
    || Math.abs(documentGroup.top - workspace.top) > 1
    || Math.abs(documentGroup.right - workspace.right) > 1
    || Math.abs(documentGroup.bottom - workspace.bottom) > 1) {
    throw new Error(`Canvas-only document does not fill the workspace: ${JSON.stringify(canvasOnlyGeometry)}`);
  }
  await page.screenshot({ path: path.join(output, '03-canvas-only.png') });

  await page.keyboard.press('f');
  await page.locator('.lighttable--canvas-only').waitFor({ state: 'detached' });
  await page.waitForFunction(() => [...document.querySelectorAll('.dv-groupview')]
    .some((group) => !group.querySelector('.lighttable-document-host')
      && group.getBoundingClientRect().width > 0
      && getComputedStyle(group).visibility !== 'hidden'));
  await page.screenshot({ path: path.join(output, '04-restored.png') });

  const photoWorkspace = page.getByRole('radio', { name: 'Switch to Photo edit workspace' });
  const gradingWorkspace = page.getByRole('radio', { name: 'Switch to Grading workspace' });
  const genAiWorkspace = page.getByRole('radio', { name: 'Switch to Gen AI workspace' });
  if (await photoWorkspace.getAttribute('aria-checked') !== 'true') {
    throw new Error('The fresh workspace is not presented as Photo edit.');
  }

  await gradingWorkspace.click();
  await page.waitForFunction(() => document.querySelector(
    '[aria-label="Switch to Grading workspace"][aria-checked="true"]'
  ));
  await page.locator('.dv-active-tab').filter({ hasText: /^Scopes$/ }).waitFor({ state: 'visible' });
  await page.locator('.lighttable-document-host').waitFor({ state: 'visible' });
  const gradingGeometry = await page.evaluate(() => {
    const groupForActiveTab = (label) => [...document.querySelectorAll('.dv-groupview')]
      .find((group) => [...group.querySelectorAll('.dv-active-tab')]
        .some((tab) => tab.textContent?.trim() === label))?.getBoundingClientRect();
    const documentGroup = groupForActiveTab('Documents');
    const scopes = groupForActiveTab('Scopes');
    const properties = groupForActiveTab('Properties');
    if (!documentGroup || !scopes || !properties) {
      return {
        error: true,
        activeTabs: [...document.querySelectorAll('.dv-active-tab')]
          .map((tab) => tab.textContent?.trim()),
        groups: [...document.querySelectorAll('.dv-groupview')].map((group) => ({
          tabs: [...group.querySelectorAll('.dv-tab')].map((tab) => tab.textContent?.trim()),
          hasDocument: Boolean(group.querySelector('.lighttable-document-host'))
        }))
      };
    }
    return {
      error: false,
      scopesRight: scopes.right,
      documentLeft: documentGroup.left,
      documentRight: documentGroup.right,
      propertiesLeft: properties.left
    };
  });
  if (gradingGeometry.error) {
    throw new Error(`Grading panels are unavailable: ${JSON.stringify(gradingGeometry)}`);
  }
  if (gradingGeometry.scopesRight > gradingGeometry.documentLeft + 1
    || gradingGeometry.propertiesLeft < gradingGeometry.documentRight - 1) {
    throw new Error(`Grading columns are misplaced: ${JSON.stringify(gradingGeometry)}`);
  }
  await page.screenshot({ path: path.join(output, '05-grading-workspace.png') });

  await genAiWorkspace.click();
  await page.waitForFunction(() => document.querySelector(
    '[aria-label="Switch to Gen AI workspace"][aria-checked="true"]'
  ));
  await page.locator('.dv-active-tab').filter({ hasText: /^GenAI$/ }).waitFor({ state: 'visible' });
  await page.screenshot({ path: path.join(output, '06-genai-workspace.png') });

  await photoWorkspace.click();
  await page.waitForFunction(() => document.querySelector(
    '[aria-label="Switch to Photo edit workspace"][aria-checked="true"]'
  ));
  await page.locator('.dv-active-tab').filter({ hasText: /^Properties$/ }).waitFor({ state: 'visible' });
  await page.screenshot({ path: path.join(output, '07-photo-edit-workspace.png') });
  if (pageErrors.length) throw new Error(`Renderer errors: ${JSON.stringify(pageErrors)}`);

  await writeFile(reportPath, `${JSON.stringify({
    sourceFile,
    normalViewport,
    fullscreenViewport,
    canvasOnlyGeometry,
    gradingGeometry,
    pageErrors,
    consoleErrors
  }, null, 2)}\n`);
  console.log(`Screen-mode smoke passed. Report: ${reportPath}`);
} finally {
  await app.close();
}
