import { _electron as electron } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { resolveDesktopTestLaunch, waitForDesktopLauncher } from './desktop-test-startup.mjs';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';

const workspace = path.resolve(import.meta.dirname, '..');
const output = path.join(workspace, 'tmp', 'layer-subtarget-smoke');
const reportPath = path.join(output, 'report.json');
const userData = path.join(output, `user-data-${process.pid}`);
const launch = await resolveDesktopTestLaunch(workspace);
await mkdir(userData, { recursive: true });

const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
const pageErrors = [];
const app = await electron.launch({
  executablePath: launch.executablePath,
  args: launch.args,
  cwd: workspace,
  env: {
    ...environment,
    LIGHTTABLE_AUTOMATION_USER_DATA: userData
  },
  timeout: 30_000
});

try {
  const page = await app.firstWindow({ timeout: 30_000 });
  page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
  await waitForDesktopLauncher({
    app,
    page,
    outputDirectory: output,
    sourceFile: 'generated-layer-subtarget-document',
    pageErrors,
    label: 'layer-subtargets'
  });

  await page.getByRole('button', { name: 'New document' }).click();
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.locator('.lighttable-toolbar__meta').filter({ hasText: /ready/i })
    .waitFor({ state: 'visible', timeout: 60_000 });

  const driver = await attachLightTableAutomation(page, 'layer-subtargets');
  const documentId = (await driver.queryWorkspace())?.activeDocumentId;
  if (!documentId) throw new Error('No active document was created.');
  const layer = (await driver.queryLayers(documentId))?.[0];
  if (!layer) throw new Error('The generated document has no raster layer.');

  const exposure = page.getByRole('slider', { name: 'Exposure', exact: true });
  await exposure.waitFor({ state: 'visible' });
  await exposure.focus();
  await page.keyboard.press('ArrowRight');
  const gradeRow = page.locator('.lighttable-layer-effect--local-processing').filter({ hasText: /^Grade$/ });
  await gradeRow.waitFor({ state: 'visible' });
  await gradeRow.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Remove Local Grade', exact: true }).click();
  await gradeRow.waitFor({ state: 'detached' });
  if (await page.locator(`[data-layer-id="${layer.id}"]`).count() !== 1) {
    throw new Error('Removing Local Grade deleted or duplicated its parent layer.');
  }

  await exposure.focus();
  await page.keyboard.press('ArrowRight');
  await gradeRow.waitFor({ state: 'visible' });
  const trash = page.getByRole('button', { name: 'Delete selected layer item', exact: true });
  await gradeRow.dragTo(trash);
  await gradeRow.waitFor({ state: 'detached' });
  if (await page.locator(`[data-layer-id="${layer.id}"]`).count() !== 1) {
    throw new Error('Dragging Local Grade to trash deleted its parent layer.');
  }

  await driver.execute(documentId, 'layer.effect.add', {
    layerId: layer.id,
    effectKind: 'drop-shadow'
  });
  const dropShadowRow = page.locator('.lighttable-layer-effect').filter({ hasText: /^Drop Shadow$/ });
  await dropShadowRow.waitFor({ state: 'visible' });
  await dropShadowRow.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Delete Drop Shadow', exact: true }).click();
  await dropShadowRow.waitFor({ state: 'detached' });
  if ((await driver.queryLayerEffects(documentId, layer.id))?.effects.length !== 0) {
    throw new Error('The Drop Shadow context menu did not remove the canonical effect.');
  }

  await driver.execute(documentId, 'layer.effect.add', {
    layerId: layer.id,
    effectKind: 'drop-shadow'
  });
  await dropShadowRow.waitFor({ state: 'visible' });
  await dropShadowRow.dragTo(trash);
  await dropShadowRow.waitFor({ state: 'detached' });
  if ((await driver.queryLayerEffects(documentId, layer.id))?.effects.length !== 0) {
    throw new Error('Dragging Drop Shadow to trash did not remove the canonical effect.');
  }
  if (pageErrors.length) throw new Error(`Renderer errors: ${JSON.stringify(pageErrors)}`);

  await writeFile(reportPath, `${JSON.stringify({
    documentId,
    layerId: layer.id,
    contextRemoval: ['grade', 'drop-shadow'],
    trashRemoval: ['grade', 'drop-shadow'],
    parentLayerPreserved: true,
    pageErrors
  }, null, 2)}\n`);
  process.stdout.write(`Layer subtarget smoke passed. Report: ${reportPath}\n`);
} finally {
  await app.close();
}
