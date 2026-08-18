import { _electron as electron } from 'playwright-core';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';
import { resolveDesktopTestLaunch, waitForDesktopLauncher } from './desktop-test-startup.mjs';

const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, 'tmp', 'document-geometry-smoke');
const userData = path.join(output, 'user-data');
const source = process.env.LIGHTTABLE_GEOMETRY_SMOKE_SOURCE
  ?? path.join(root, 'packages', 'lighttable-app', 'src', 'assets', 'icons', 'image.png');
await rm(output, { recursive: true, force: true }); await mkdir(userData, { recursive: true });
const launch = await resolveDesktopTestLaunch(root);
const environment = { ...process.env }; delete environment.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: launch.executablePath, args: launch.args, cwd: root,
  env: { ...environment, LIGHTTABLE_AUTOMATION_USER_DATA: userData, LIGHTTABLE_AUTOMATION_OPEN_FILE: source }, timeout: 30_000 });

try {
  const page = await app.firstWindow({ timeout: 30_000 });
  const errors = []; page.on('pageerror', (error) => errors.push(error.stack ?? error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  const openFile = await waitForDesktopLauncher({ app, page, outputDirectory: output, sourceFile: source, pageErrors: errors,
    label: 'document-geometry' });
  await openFile.click();
  await page.locator('.lighttable-toolbar__meta').filter({ hasText: /ready/i }).waitFor({ state: 'visible', timeout: 60_000 });
  const driver = await attachLightTableAutomation(page, 'document-geometry-smoke');
  const documentId = (await driver.queryWorkspace())?.activeDocumentId;
  const before = documentId ? await driver.queryDocument(documentId) : null;
  if (!documentId || !before?.canvas) throw new Error('Geometry source document is unavailable.');

  await driver.execute(documentId, 'document.applyGeometry', {
    operation: 'canvas-size', width: before.canvas.width + 17, height: before.canvas.height + 9,
    anchorX: 0.5, anchorY: 1
  });
  const expanded = await driver.queryDocument(documentId);
  if (expanded?.canvas?.width !== before.canvas.width + 17 || expanded.canvas.height !== before.canvas.height + 9
    || expanded.history.undoDepth !== before.history.undoDepth + 1) {
    throw new Error(`Canvas Size did not commit atomically: ${JSON.stringify({ before, expanded })}`);
  }
  await driver.execute(documentId, 'document.applyGeometry', { operation: 'rotate', rotation: 'clockwise-90' });
  const rotated = await driver.queryDocument(documentId);
  if (rotated?.canvas?.width !== expanded.canvas.height || rotated.canvas.height !== expanded.canvas.width
    || rotated.history.undoDepth !== expanded.history.undoDepth + 1) {
    throw new Error(`Orthogonal rotation did not swap dimensions: ${JSON.stringify({ expanded, rotated })}`);
  }
  await driver.execute(documentId, 'history.undo', {});
  await driver.execute(documentId, 'history.undo', {});
  const restored = await driver.queryDocument(documentId);
  if (restored?.canvas?.width !== before.canvas.width || restored.canvas.height !== before.canvas.height) {
    throw new Error(`Geometry undo did not restore source dimensions: ${JSON.stringify({ before, restored })}`);
  }
  const imageMenu = page.locator('.shots-app-menu__button').filter({ hasText: /^Image$/ });
  await imageMenu.click();
  await page.getByRole('menuitem', { name: 'Crop', exact: true }).click();
  const cropFrame = page.locator('.crop-interaction-overlay__frame');
  await cropFrame.waitFor({ state: 'visible' });
  const northWest = page.getByRole('button', { name: 'Crop nw handle' });
  const handleBox = await northWest.boundingBox();
  if (!handleBox) throw new Error('Crop north-west handle is unavailable.');
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(handleBox.x + handleBox.width / 2 + 12, handleBox.y + handleBox.height / 2 + 8, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.press('Enter');
  await cropFrame.waitFor({ state: 'detached' });
  const cropped = await driver.queryDocument(documentId);
  if (!cropped?.canvas || (cropped.canvas.width >= before.canvas.width && cropped.canvas.height >= before.canvas.height)
    || cropped.history.undoDepth !== before.history.undoDepth + 1) {
    throw new Error(`Interactive Crop did not create one smaller document state: ${JSON.stringify({ before, cropped })}`);
  }
  await driver.execute(documentId, 'history.undo', {});
  const cropUndone = await driver.queryDocument(documentId);
  if (cropUndone?.canvas?.width !== before.canvas.width || cropUndone.canvas.height !== before.canvas.height) {
    throw new Error(`Crop undo did not restore source bounds: ${JSON.stringify({ before, cropUndone })}`);
  }
  await page.keyboard.press('Escape');
  const layersBeforeFixed = await driver.queryLayers(documentId);
  await page.locator('.shots-app-menu__button').filter({ hasText: /^Edit$/ }).click();
  await page.getByRole('menuitem', { name: 'Transform', exact: true }).hover();
  await page.getByRole('menuitem', { name: 'Flip Horizontal', exact: true }).click();
  let fixed = await driver.queryDocument(documentId);
  for (let attempt = 0; attempt < 80 && fixed?.history.undoDepth !== 1; attempt += 1) {
    await page.waitForTimeout(25); fixed = await driver.queryDocument(documentId);
  }
  const layersAfterFixed = await driver.queryLayers(documentId);
  if (fixed?.canvas?.width !== before.canvas.width || fixed.canvas.height !== before.canvas.height
    || fixed.history.undoDepth !== 1
    || JSON.stringify(layersAfterFixed?.[0]?.transform) === JSON.stringify(layersBeforeFixed?.[0]?.transform)) {
    throw new Error(`Fixed layer transform changed the wrong scope: ${JSON.stringify({ fixed, layersBeforeFixed, layersAfterFixed })}`);
  }
  await driver.execute(documentId, 'history.undo', {});
  const layersFixedUndone = await driver.queryLayers(documentId);
  if (JSON.stringify(layersFixedUndone?.[0]?.transform) !== JSON.stringify(layersBeforeFixed?.[0]?.transform)) {
    throw new Error('Fixed layer transform undo did not restore the canonical layer transform.');
  }
  await driver.execute(documentId, 'document.applyGeometry', {
    operation: 'rotate', rotation: { degrees: 33 }
  });
  const arbitrary = await driver.queryDocument(documentId);
  if (!arbitrary?.canvas || arbitrary.canvas.width <= before.canvas.width || arbitrary.canvas.height <= before.canvas.height
    || arbitrary.history.undoDepth !== 1) {
    throw new Error(`Arbitrary rotation did not use deterministic expanded bounds: ${JSON.stringify({ before, arbitrary })}`);
  }
  await driver.execute(documentId, 'history.undo', {});
  const arbitraryUndone = await driver.queryDocument(documentId);
  if (arbitraryUndone?.canvas?.width !== before.canvas.width || arbitraryUndone.canvas.height !== before.canvas.height) {
    throw new Error(`Arbitrary rotation undo did not restore source bounds: ${JSON.stringify({ before, arbitraryUndone })}`);
  }
  if (errors.length) throw new Error(`Renderer errors: ${JSON.stringify(errors)}`);
  await page.screenshot({ path: path.join(output, 'document-geometry.png') });
  await writeFile(path.join(output, 'report.json'), `${JSON.stringify({ before, expanded, rotated, restored, cropped, cropUndone,
    fixed, layersBeforeFixed, layersAfterFixed, layersFixedUndone, arbitrary, arbitraryUndone, errors }, null, 2)}\n`);
  process.stdout.write(`Desktop document geometry smoke passed. Report: ${path.join(output, 'report.json')}\n`);
} finally { await app.close().catch(() => {}); }
