import { _electron as electron } from 'playwright-core';
import { mkdir, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { PDFDocument } from 'pdf-lib';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';
import { resolveDesktopTestLaunch, waitForDesktopLauncher } from './desktop-test-startup.mjs';

const root = path.resolve(import.meta.dirname, '..');
const outputDirectory = path.join(root, 'tmp', 'pdf-open-export-smoke');
const sourceFile = path.resolve(process.argv[2]
  ?? 'D:\\mediavibe\\LightTableTestFiles\\PDFJSGIT\\test\\pdfs\\two_pages.pdf');
const outputFile = path.join(outputDirectory, 'flattened.pdf');
const userData = path.join(outputDirectory, `user-data-${process.pid}`);
await mkdir(userData, { recursive: true });
await rm(outputFile, { force: true });

const launch = await resolveDesktopTestLaunch(root);
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath: launch.executablePath,
  args: launch.args,
  cwd: root,
  env: {
    ...environment,
    LIGHTTABLE_AUTOMATION_OPEN_FILE: sourceFile,
    LIGHTTABLE_AUTOMATION_SAVE_FILE: outputFile,
    LIGHTTABLE_AUTOMATION_USER_DATA: userData
  },
  timeout: 30_000
});

try {
  const page = await app.firstWindow({ timeout: 30_000 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.stack ?? error.message));
  const open = await waitForDesktopLauncher({
    app, page, outputDirectory, sourceFile, pageErrors: errors, label: 'pdf-open-export'
  });
  await open.click();
  await page.locator('.lighttable-toolbar__meta').filter({ hasText: /ready/i })
    .waitFor({ state: 'visible', timeout: 60_000 });
  const driver = await attachLightTableAutomation(page, 'pdf-open-export');
  const documentId = (await driver.queryWorkspace())?.activeDocumentId;
  const opened = documentId ? await driver.queryDocument(documentId) : null;
  if (!opened || opened.kind !== 'image' || opened.layerCount !== 1
    || opened.canvas.width < 1 || opened.canvas.height < 1) {
    throw new Error(`PDF did not open as one bounded raster document: ${JSON.stringify(opened)}`);
  }

  await page.getByRole('menuitem', { name: 'File', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Export', exact: true }).hover();
  await page.getByRole('menuitem', { name: 'PDF...', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'PDF export preflight' });
  await dialog.waitFor({ state: 'visible' });
  await dialog.getByText(/exactly one PDF page/i).waitFor();
  await dialog.getByRole('button', { name: /Export flattened PDF/i }).click();

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      if ((await stat(outputFile)).size > 8) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const bytes = await readFile(outputFile);
  const exported = await PDFDocument.load(bytes);
  if (exported.getPageCount() !== 1) {
    throw new Error(`Flattened PDF exported ${exported.getPageCount()} pages instead of one.`);
  }
  const pageSize = exported.getPage(0).getSize();
  if (pageSize.width <= 0 || pageSize.height <= 0 || errors.length) {
    throw new Error(errors.join('\n') || `Invalid PDF page size: ${JSON.stringify(pageSize)}`);
  }
  console.log(JSON.stringify({
    passed: true,
    sourcePages: 2,
    openedCanvas: opened.canvas,
    exportedPages: exported.getPageCount(),
    exportedBytes: bytes.length,
    pageSize
  }, null, 2));
} finally {
  await app.close().catch(() => {});
}
