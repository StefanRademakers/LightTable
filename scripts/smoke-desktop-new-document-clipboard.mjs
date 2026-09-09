import { _electron as electron } from 'playwright-core';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { resolveDesktopTestLaunch, waitForDesktopLauncher } from './desktop-test-startup.mjs';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';

const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, 'tmp', 'new-document-clipboard');
const sourceFile = path.join(root, 'architecture', 'ui', '1.png');
await mkdir(output, { recursive: true });
const userData = await mkdtemp(path.join(output, 'profile-'));
const launch = await resolveDesktopTestLaunch(root, { requirePackaged: true });
const environment = { ...process.env, LIGHTTABLE_AUTOMATION_USER_DATA: userData };
delete environment.ELECTRON_RUN_AS_NODE;
const pageErrors = [];
let app;

try {
  app = await electron.launch({ executablePath: launch.executablePath, args: launch.args,
    cwd: root, env: environment, timeout: 30_000 });
  const page = await app.firstWindow({ timeout: 30_000 });
  page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
  await waitForDesktopLauncher({ app, page, outputDirectory: output,
    sourceFile: null, pageErrors, label: 'new-document-clipboard' });
  const driver = await attachLightTableAutomation(page, 'new-document-clipboard');
  const seed = await driver.executeWorkspace('document.create', {
    name: 'Clipboard dimension seed', width: 64, height: 64, resolutionPpi: 72,
    bitDepth: 8, profile: 'srgb', background: { kind: 'transparent' }
  });
  assert.ok(seed.value?.documentId, 'Seed document was not created.');
  await driver.waitForRenderedDocument(seed.value.documentId, 30_000);

  const expected = await app.evaluate(({ clipboard, nativeImage }, imagePath) => {
    const image = nativeImage.createFromPath(imagePath);
    if (image.isEmpty()) throw new Error('Clipboard smoke fixture could not be decoded.');
    clipboard.writeImage(image);
    return image.getSize();
  }, sourceFile);

  const started = performance.now();
  await page.keyboard.press('Control+n');
  const dialog = page.getByRole('heading', { name: 'New document' }).locator('..').locator('..');
  await dialog.waitFor({ state: 'visible', timeout: 5_000 });
  const width = dialog.getByLabel('Width');
  const height = dialog.getByLabel('Height');
  await width.waitFor({ state: 'visible' });
  await page.waitForFunction(({ expectedWidth, expectedHeight }) => {
    const labels = Array.from(document.querySelectorAll('label'));
    const valueFor = (name) => labels.find((label) => label.textContent?.includes(name))
      ?.querySelector('input')?.value;
    return valueFor('Width') === String(expectedWidth)
      && valueFor('Height') === String(expectedHeight);
  }, { expectedWidth: expected.width, expectedHeight: expected.height }, { timeout: 2_000 });
  const readyMilliseconds = performance.now() - started;
  assert.ok(readyMilliseconds < 1_000,
    `Clipboard dimensions took ${readyMilliseconds.toFixed(1)} ms to appear.`);
  assert.equal(await width.inputValue(), String(expected.width));
  assert.equal(await height.inputValue(), String(expected.height));

  await dialog.getByRole('button', { name: 'Create' }).click();
  await dialog.waitFor({ state: 'hidden', timeout: 30_000 });
  await page.waitForFunction((seedDocumentId) => {
    const active = globalThis.__lightTableAutomation?.queryWorkspace()?.activeDocumentId;
    return Boolean(active && active !== seedDocumentId);
  }, seed.value.documentId, { timeout: 30_000 });
  const workspace = await driver.queryWorkspace();
  assert.ok(workspace?.activeDocumentId, 'New document did not become active.');
  await driver.waitForRenderedDocument(workspace.activeDocumentId, 30_000);
  const document = await driver.queryDocument(workspace.activeDocumentId);
  assert.equal(document?.canvas?.width, expected.width);
  assert.equal(document?.canvas?.height, expected.height);
  assert.deepEqual(pageErrors, []);

  const report = { expected, readyMilliseconds, documentId: workspace.activeDocumentId };
  await writeFile(path.join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`Packaged new-document clipboard smoke passed in ${readyMilliseconds.toFixed(1)} ms: ${output}\n`);
} finally {
  await app?.close().catch(() => {});
}
