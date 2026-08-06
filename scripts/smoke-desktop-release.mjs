import { _electron as electron } from 'playwright-core';
import { access, mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const executablePath = path.join(root, 'apps', 'desktop', 'out', 'LightTable-win32-x64', 'LightTable.exe');
const sourceFile = path.resolve(process.argv[2] || 'D:\\TextTest.psd');
const runId = new Date().toISOString().replaceAll(/[:.]/g, '-');
const output = path.join(root, 'tmp', 'release-smoke', runId);
const userData = path.join(output, 'user-data');
const savedFile = path.join(output, 'release-smoke-lighttable.png');
const report = { executablePath, sourceFile, pageErrors: [], assertions: {} };
await Promise.all([access(executablePath), access(sourceFile), mkdir(userData, { recursive: true })]);
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;

let application;
try {
  application = await electron.launch({
    executablePath,
    env: {
      ...environment,
      LIGHTTABLE_AUTOMATION_USER_DATA: userData,
      LIGHTTABLE_AUTOMATION_OPEN_FILE: sourceFile,
      LIGHTTABLE_AUTOMATION_SAVE_FILE: savedFile
    },
    timeout: 30_000
  });
  const window = await application.firstWindow({ timeout: 30_000 });
  window.on('pageerror', (error) => report.pageErrors.push(error.stack ?? error.message));
  await window.getByRole('button', { name: 'About LightTable' }).click();
  await window.getByRole('dialog', { name: 'About LightTable' }).waitFor({ state: 'visible' });
  await window.getByText('0.1.0-alpha.1').waitFor({ state: 'visible' });
  await window.getByRole('button', { name: 'Close', exact: true }).click();
  await window.getByRole('button', { name: 'Open file' }).click();
  await window.locator('.lighttable-toolbar__meta').filter({ hasText: /ready/i })
    .waitFor({ state: 'visible', timeout: 45_000 });
  const isolation = await window.evaluate(() => ({
    nodeUnavailable: typeof globalThis.process === 'undefined',
    isolated: globalThis.crossOriginIsolated,
    csp: document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content') ?? ''
  }));
  if (!isolation.nodeUnavailable || !isolation.isolated || !isolation.csp.includes("script-src 'self'")) {
    throw new Error(`Packaged renderer isolation is incomplete: ${JSON.stringify(isolation)}`);
  }
  await window.getByRole('button', { name: 'Help' }).click();
  await window.getByRole('button', { name: 'About LightTable…' }).click();
  await window.getByRole('dialog', { name: 'About LightTable' }).waitFor({ state: 'visible' });
  await window.getByText('0.1.0-alpha.1').waitFor({ state: 'visible' });
  await window.getByText('Unsigned local/test build').waitFor({ state: 'visible' });
  await window.getByRole('button', { name: 'Check for updates' }).click();
  await window.getByText('No signed update provider is configured for this build.')
    .waitFor({ state: 'visible', timeout: 15_000 });
  await window.screenshot({ path: path.join(output, 'about-update.png') });
  await window.getByRole('button', { name: 'Close', exact: true }).click();
  await window.keyboard.press('Control+S');
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await stat(savedFile).then(() => true).catch(() => false)) break;
    await window.waitForTimeout(100);
  }
  await access(savedFile);
  report.assertions = {
    isolation,
    savedBytes: (await stat(savedFile)).size,
    cleanUserData: userData
  };
} finally {
  await application?.close().catch(() => {});
  await writeFile(path.join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}
if (report.pageErrors.length) throw new Error(report.pageErrors.join('\n'));
console.log(`Desktop release smoke passed: ${output}`);
