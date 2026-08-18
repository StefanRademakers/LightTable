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
  if (errors.length) throw new Error(`Renderer errors: ${JSON.stringify(errors)}`);
  await page.screenshot({ path: path.join(output, 'document-geometry.png') });
  await writeFile(path.join(output, 'report.json'), `${JSON.stringify({ before, expanded, rotated, restored, errors }, null, 2)}\n`);
  process.stdout.write(`Desktop document geometry smoke passed. Report: ${path.join(output, 'report.json')}\n`);
} finally { await app.close().catch(() => {}); }
