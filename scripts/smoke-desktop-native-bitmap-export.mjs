import { _electron as electron } from 'playwright-core';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import sharp from 'sharp';
import { createRgba16Png } from './native-bitmap-fixtures.mjs';
import { resolveDesktopTestLaunch, waitForDesktopLauncher } from './desktop-test-startup.mjs';

const root = path.resolve(import.meta.dirname, '..');
const outputDirectory = path.join(root, 'tmp', 'native-bitmap-export-smoke');
const sourceFile = path.join(outputDirectory, 'source-16bit.png');
const saveTarget = path.join(outputDirectory, 'current-export.bin');
const userData = path.join(outputDirectory, `user-data-${process.pid}`);
await mkdir(outputDirectory, { recursive: true });
await writeFile(sourceFile, createRgba16Png(64, 48));

const launch = await resolveDesktopTestLaunch(root, { requirePackaged: true });
const environment = {
  ...process.env,
  LIGHTTABLE_AUTOMATION_OPEN_FILE: sourceFile,
  LIGHTTABLE_AUTOMATION_SAVE_FILE: saveTarget,
  LIGHTTABLE_AUTOMATION_USER_DATA: userData
};
delete environment.ELECTRON_RUN_AS_NODE;

const app = await electron.launch({
  executablePath: launch.executablePath,
  args: launch.args,
  cwd: root,
  env: environment,
  timeout: 30_000
});

const cases = [
  { label: 'PNG...', format: 'png', depth: 'ushort' },
  { label: 'JPG...', format: 'jpeg', depth: 'uchar' },
  { label: 'WebP...', format: 'webp', depth: 'uchar' },
  { label: 'TIFF...', format: 'tiff', depth: 'ushort' }
];

const waitForFile = async (filePath, timeout = 120_000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { return await readFile(filePath); } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Export did not create ${filePath}.`);
};

try {
  const page = await app.firstWindow({ timeout: 30_000 });
  const open = await waitForDesktopLauncher({
    app, page, outputDirectory, sourceFile, label: 'native-bitmap-export'
  });
  await open.click();
  await page.locator('.lighttable-toolbar__meta').filter({ hasText: /ready/i })
    .waitFor({ state: 'visible', timeout: 60_000 });
  const openedDocument = await page.evaluate(() => {
    const workspace = window.__lightTableAutomation?.queryWorkspace();
    return workspace?.activeDocumentId
      ? window.__lightTableAutomation?.queryDocument(workspace.activeDocumentId) ?? null
      : null;
  });
  if (openedDocument?.color?.bitDepth !== 16) {
    throw new Error(`The 16-bit fixture opened as ${JSON.stringify(openedDocument)}.`);
  }

  const results = [];
  for (const testCase of cases) {
    await rm(saveTarget, { force: true });
    await page.getByRole('menuitem', { name: 'File', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Export', exact: true }).hover();
    await page.getByRole('menuitem', { name: testCase.label, exact: true }).click();
    const bytes = await waitForFile(saveTarget);
    const metadata = await sharp(bytes).metadata();
    if (metadata.format !== testCase.format || metadata.depth !== testCase.depth
      || metadata.width !== 64 || metadata.height !== 48) {
      throw new Error(`${testCase.label} produced ${JSON.stringify(metadata)}.`);
    }
    results.push({ label: testCase.label, format: metadata.format, bitDepth: metadata.depth, bytes: bytes.length });
  }
  console.log(JSON.stringify({ passed: true, documentBitDepth: 16, formats: results }, null, 2));
} finally {
  await app.evaluate(({ app: electronApp }) => electronApp.quit()).catch(() => {});
  await app.close().catch(() => {});
}
