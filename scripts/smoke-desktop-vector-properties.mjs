import { _electron as electron } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';
import { resolveDesktopTestLaunch, waitForDesktopLauncher } from './desktop-test-startup.mjs';
import { prepareRasterSmokeSource } from './desktop-smoke-fixtures.mjs';

const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, 'tmp', 'vector-properties');
const sourceFile = await prepareRasterSmokeSource(output);
const launch = await resolveDesktopTestLaunch(root, { requirePackaged: true });
await mkdir(output, { recursive: true });
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: launch.executablePath, args: launch.args,
  cwd: root, env: { ...env, LIGHTTABLE_AUTOMATION_OPEN_FILE: sourceFile,
    LIGHTTABLE_AUTOMATION_USER_DATA: path.join(output, 'profile-' + process.pid) } });
const errors = [];
try {
  const page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.stack ?? error.message));
  const open = await waitForDesktopLauncher({ app, page, outputDirectory: output,
    sourceFile, pageErrors: errors, label: 'vector-properties' });
  await open.click();
  await page.locator('.lighttable-toolbar__meta').filter({ hasText: /ready/i })
    .waitFor({ timeout: 60_000 });
  const driver = await attachLightTableAutomation(page, 'vector-properties');
  const id = (await driver.queryWorkspace()).activeDocumentId;
  const doc = () => driver.queryDocument(id);
  const choose = async (scope, label, option) => {
    await scope.getByLabel(label, { exact: true }).click();
    await page.getByRole('option', { name: option, exact: true }).click();
  };
  await page.keyboard.press('g');
  await page.getByRole('button', { name: 'Gradient (G)', exact: true }).waitFor();
  const viewport = page.locator('.lighttable-viewport');
  const bounds = await viewport.boundingBox();
  const before = await doc();
  await page.mouse.move(bounds.x + bounds.width * 0.2, bounds.y + bounds.height * 0.25);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.6, bounds.y + bounds.height * 0.6, { steps: 8 });
  await page.mouse.up();
  const created = await doc();
  if (created.history.undoDepth !== before.history.undoDepth + 1) throw new Error('Gradient creation was not one edit.');
  const layerId = created.activeLayerId;
  const openingVector = await driver.queryVector(id, layerId);
  await choose(page, 'Gradient type', 'Radial');
  const toolbar = await doc();
  const toolbarVector = await driver.queryVector(id, layerId);
  if (toolbar.history.undoDepth !== created.history.undoDepth + 1
    || JSON.stringify(toolbarVector) === JSON.stringify(openingVector)) throw new Error('Toolbar did not author gradient.');
  await page.keyboard.press('Control+z');
  // Right-click away from gradient handles opens the same tool settings in context.
  await page.mouse.click(bounds.x + bounds.width * 0.2, bounds.y + bounds.height * 0.8, { button: 'right' });
  const context = page.getByRole('dialog', { name: 'Tool settings', exact: true });
  await context.waitFor();
  // Defaults retain Radial after undo, so use another shape then undo before comparing.
  await choose(context, 'Gradient type', 'Linear');
  const noOp = await doc();
  if (noOp.history.undoDepth !== created.history.undoDepth) throw new Error('Same gradient shape created a false edit.');
  await choose(context, 'Gradient type', 'Radial');
  const contextual = await doc();
  const contextVector = await driver.queryVector(id, layerId);
  if (contextual.history.undoDepth !== toolbar.history.undoDepth
    || JSON.stringify(contextVector) !== JSON.stringify(toolbarVector)) {
    throw new Error('Toolbar/context gradient authoring differs: ' + JSON.stringify({ toolbarVector, contextVector }));
  }
  await page.keyboard.press('Escape');
  await page.screenshot({ path: path.join(output, 'gradient-context-parity.png') });
  await page.keyboard.press('Control+z');
  const undoneVector = await driver.queryVector(id, layerId);
  if (JSON.stringify(undoneVector) !== JSON.stringify(openingVector)) throw new Error('Gradient undo differs from opening vector.');
  await page.keyboard.press('Control+Shift+z');
  const redoneVector = await driver.queryVector(id, layerId);
  if (JSON.stringify(redoneVector) !== JSON.stringify(toolbarVector)) throw new Error('Gradient redo differs from authored vector.');
  if (errors.length) throw new Error(errors.join('\n'));
  await writeFile(path.join(output, 'report.json'), JSON.stringify({
    executablePath: launch.executablePath, before, created, toolbar, contextual,
    openingVector, toolbarVector, contextVector, errors
  }, null, 2));
  console.log('Packaged vector property toolbar/context parity and exact history passed.');
} catch (error) {
  const page = await app.firstWindow();
  await page.screenshot({ path: path.join(output, 'failure.png') });
  await writeFile(path.join(output, 'failure.json'), JSON.stringify({
    error: error.stack, errors, body: await page.locator('body').innerText()
  }, null, 2));
  throw error;
} finally { await app.close(); }
