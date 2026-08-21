import { access, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { _electron as electron } from 'playwright-core';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';
import { resolveDesktopTestLaunch, waitForDesktopLauncher } from './desktop-test-startup.mjs';

const root = path.resolve(import.meta.dirname, '..');
const sourceFile = path.resolve(process.argv[2]
  ?? 'D:\\mediavibe\\LightTableTestFiles\\RandomFiles\\face.jpg');
const output = path.join(root, 'tmp', 'face-warp-rejection', path.parse(sourceFile).name);
const userData = path.join(output, `user-data-${process.pid}`);
const launch = await resolveDesktopTestLaunch(root);
await Promise.all([
  access(sourceFile), mkdir(output, { recursive: true }),
  rm(userData, { recursive: true, force: true }), mkdir(userData, { recursive: true })
]);
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath: launch.executablePath,
  args: launch.args,
  cwd: root,
  env: {
    ...environment,
    LIGHTTABLE_AUTOMATION_OPEN_FILE: sourceFile,
    LIGHTTABLE_AUTOMATION_USER_DATA: userData
  },
  timeout: 30_000
});

try {
  const page = await app.firstWindow({ timeout: 30_000 });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
  const open = await waitForDesktopLauncher({
    app, page, outputDirectory: output, sourceFile, pageErrors, label: 'face-warp-rejection'
  });
  await open.click();
  await page.locator('.lighttable-toolbar__meta').filter({ hasText: /ready/i })
    .waitFor({ state: 'visible', timeout: 60_000 });
  const driver = await attachLightTableAutomation(page, 'face-warp-rejection');
  const documentId = (await driver.queryWorkspace())?.activeDocumentId;
  if (!documentId) throw new Error('No active document for Face Warp rejection smoke.');
  const before = await driver.queryDocument(documentId);
  await page.getByRole('button', { name: /^Face Warp/ }).click();
  await page.getByRole('button', { name: 'Detect faces' }).click();
  await page.getByText(/Independent face observations disagree/i)
    .waitFor({ state: 'visible', timeout: 60_000 });
  const after = await driver.queryDocument(documentId);
  if (!before || !after || before.history.undoDepth !== after.history.undoDepth
    || before.canonicalRevision !== after.canonicalRevision) {
    throw new Error('Rejected Face Warp detection mutated document state or history.');
  }
  if (await page.getByRole('button', { name: 'Accept mesh' }).count()) {
    throw new Error('Rejected Face Warp detection exposed an Accept mesh action.');
  }
  await page.screenshot({ path: path.join(output, 'rejected-profile.png') });
  const report = {
    sourceFile,
    message: 'Independent face observations disagree with the editable mesh.',
    canonicalRevision: after.canonicalRevision,
    undoDepth: after.history.undoDepth,
    pageErrors
  };
  await writeFile(path.join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`Face Warp rejection smoke passed: ${path.join(output, 'report.json')}\n`);
} finally {
  await app.close().catch(() => {});
}
