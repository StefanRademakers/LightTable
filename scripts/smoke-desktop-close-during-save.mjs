import { _electron as electron } from 'playwright-core';
import { mkdir, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';
import { resolveDesktopTestLaunch, waitForDesktopLauncher } from './desktop-test-startup.mjs';

const root = path.resolve(import.meta.dirname, '..');
const applicationDiscard = process.argv.includes('--native-application-discard');
const applicationCancel = process.argv.includes('--native-application-cancel');
const nativeApplicationClose = process.argv.includes('--native-application');
const nativeDiscard = process.argv.includes('--native-discard') || applicationDiscard || applicationCancel;
const nativeWindowClose = nativeDiscard || nativeApplicationClose || process.argv.includes('--native-window');
const outputDirectory = path.join(root, 'tmp', 'close-during-save-smoke');
const sourceFile = path.join(outputDirectory, 'large-source.png');
const userData = path.join(outputDirectory, `user-data-${process.pid}`);
await mkdir(userData, { recursive: true });
await rm(sourceFile, { force: true });
await sharp(randomBytes(3000 * 2250 * 4), {
  raw: { width: 3000, height: 2250, channels: 4 }
}).png().toFile(sourceFile);

const dimensions = (bytes) => ({
  width: bytes.readUInt32BE(16),
  height: bytes.readUInt32BE(20)
});
const waitFor = async (predicate, message, timeout = 60_000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(message);
};

const launch = await resolveDesktopTestLaunch(root);
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
let page = null;
const pageErrors = [];
const app = await electron.launch({
  executablePath: launch.executablePath,
  args: launch.args,
  cwd: root,
  env: {
    ...environment,
    LIGHTTABLE_AUTOMATION_OPEN_FILE: sourceFile,
    LIGHTTABLE_AUTOMATION_USER_DATA: userData,
    ...(nativeWindowClose ? { LIGHTTABLE_AUTOMATION_NATIVE_CLOSE_GUARD: '1' } : {})
  },
  timeout: 30_000
});

try {
  page = await app.firstWindow({ timeout: 30_000 });
  page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
  const open = await waitForDesktopLauncher({
    app, page, outputDirectory, sourceFile, pageErrors, label: 'close-during-save'
  });
  await open.click();
  await page.locator('.lighttable-toolbar__meta').filter({ hasText: /ready/i })
    .waitFor({ state: 'visible', timeout: 60_000 });
  const driver = await attachLightTableAutomation(page, 'close-during-save-smoke');
  const documentId = (await driver.queryWorkspace())?.activeDocumentId;
  if (!documentId) throw new Error('The opened document is unavailable.');

  await driver.execute(documentId, 'document.resizeImage', {
    width: 2999,
    height: 2249,
    resolutionPpi: 72,
    resample: true,
    method: 'automatic',
    preserveDetailsNoiseReduction: 0,
    scaleStyles: true
  });
  if (nativeDiscard) {
    const recoveryDirectory = path.join(userData, 'recovery-v1');
    await waitFor(async () => (await readdir(recoveryDirectory).catch(() => []))
      .some((name) => name.endsWith('.ltrecovery')),
    'The dirty document did not create a recovery record before discard.');
    await app.evaluate(({ dialog }, response) => {
      dialog.showMessageBox = async () => ({ response, checkboxChecked: false });
    }, applicationCancel ? 0 : 1);
    if (applicationDiscard || applicationCancel) {
      await app.evaluate(({ app }) => app.quit());
    } else {
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());
    }
    if (applicationCancel) {
      await page.waitForTimeout(1_000);
      if (page.isClosed()) throw new Error('Cancel allowed the native application quit to close LightTable.');
      const records = await readdir(recoveryDirectory).catch(() => []);
      if (!records.some((name) => name.endsWith('.ltrecovery'))) {
        throw new Error('Canceled application quit removed the dirty document recovery record.');
      }
      console.log(JSON.stringify({ passed: true, closeKind: 'native-application-cancel',
        windowRemainedOpen: true, recoveryPreserved: true }, null, 2));
    } else {
      await waitFor(() => page.isClosed(), 'The native close did not finish after discard approval.');
      await waitFor(async () => !(await readdir(recoveryDirectory).catch(() => []))
        .some((name) => name.endsWith('.ltrecovery')),
      'Native application discard left a stale recovery record.');
      if (pageErrors.length) throw new Error(pageErrors.join('\n'));
      console.log(JSON.stringify({ passed: true,
        closeKind: applicationDiscard ? 'native-application-discard' : 'native-window-discard',
        recoveryRemoved: true }, null, 2));
    }
    process.exitCode = 0;
  } else {
  await page.getByRole('menuitem', { name: 'File', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Save', exact: true }).click();
  await waitFor(async () => (
    (await driver.queryDocument(documentId))?.tasks.activeCount === 1
  ), 'The source save task did not become active.');

  if (nativeWindowClose) {
    if (nativeApplicationClose) {
      await app.evaluate(({ app }) => app.quit());
    } else {
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());
    }
    await waitFor(() => page.isClosed(),
      'The native close did not finish after its source save committed.');
  } else {
    await page.getByRole('button', { name: 'Close large-source.png', exact: true }).click();
    await waitFor(async () => (await driver.queryWorkspace())?.documents.length === 0,
      'The document tab did not close after its source save committed.');
  }
  await waitFor(async () => {
    try {
      const saved = await readFile(sourceFile);
      return dimensions(saved).width === 2999 && dimensions(saved).height === 2249;
    } catch {
      return false;
    }
  }, 'The document tab closed before the source save committed.');
  if (pageErrors.length) throw new Error(pageErrors.join('\n'));
  console.log(JSON.stringify({
    passed: true,
    source: sourceFile,
    dimensions: dimensions(await readFile(sourceFile)),
    closeKind: nativeApplicationClose ? 'native-application'
      : nativeWindowClose ? 'native-window' : 'document-tab',
    closeWaitedForSave: true
  }, null, 2));
  }
} finally {
  if (page && !page.isClosed()) {
    await page.evaluate(() => window.lightTableDesktop.closeApplication()).catch(() => {});
  }
  await app.close().catch(() => {});
}
