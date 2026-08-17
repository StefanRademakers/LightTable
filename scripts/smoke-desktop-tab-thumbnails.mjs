import { _electron as electron } from 'playwright-core';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import sharp from 'sharp';
import { resolveDesktopTestLaunch, waitForDesktopLauncher } from './desktop-test-startup.mjs';

const workspaceRoot = path.resolve(import.meta.dirname, '..');
const outputDirectory = path.join(workspaceRoot, 'tmp', 'tab-thumbnail-smoke');
const userDataPath = path.join(outputDirectory, `user-data-${process.pid}`);
const landscapePath = path.join(outputDirectory, 'landscape.png');
const portraitPath = path.join(outputDirectory, 'portrait.png');
const screenshotPath = path.join(outputDirectory, 'inactive-tab-preview.png');
const reportPath = path.join(outputDirectory, 'report.json');

await mkdir(userDataPath, { recursive: true });
await sharp({
  create: { width: 320, height: 180, channels: 4, background: '#d13b32' }
}).png().toFile(landscapePath);
await sharp({
  create: { width: 180, height: 320, channels: 4, background: '#2878c7' }
}).png().toFile(portraitPath);

const launchEnvironment = { ...process.env };
delete launchEnvironment.ELECTRON_RUN_AS_NODE;
const launch = await resolveDesktopTestLaunch(workspaceRoot);
const app = await electron.launch({
  executablePath: launch.executablePath,
  args: launch.args,
  cwd: workspaceRoot,
  env: {
    ...launchEnvironment,
    LIGHTTABLE_AUTOMATION_USER_DATA: userDataPath
  },
  timeout: 30_000
});

let failure;
try {
  const page = await app.firstWindow({ timeout: 30_000 });
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  await waitForDesktopLauncher({
    app, page, outputDirectory, sourceFile: `${landscapePath};${portraitPath}`,
    pageErrors, label: 'tab-thumbnails'
  });

  const files = await Promise.all([landscapePath, portraitPath].map(async (filePath) => ({
    name: path.basename(filePath),
    bytes: (await readFile(filePath)).toString('base64')
  })));
  await page.evaluate((payloads) => {
    const transfer = new DataTransfer();
    for (const payload of payloads) {
      const binary = atob(payload.bytes);
      const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      transfer.items.add(new File([bytes], payload.name, { type: 'image/png' }));
    }
    window.dispatchEvent(new DragEvent('drop', {
      bubbles: true,
      cancelable: true,
      dataTransfer: transfer
    }));
  }, files);

  const tabs = page.locator('.lighttable-document-tabs:visible .lighttable-document-tab');
  await tabs.nth(1).waitFor({ state: 'visible', timeout: 60_000 });
  const inactiveTab = tabs.filter({ hasText: 'landscape.png' });
  await inactiveTab.waitFor({ state: 'visible' });
  if (await inactiveTab.getAttribute('aria-selected') !== 'false') {
    throw new Error('The target thumbnail tab was activated before the hover check.');
  }

  const previewImage = inactiveTab.locator('.lighttable-document-tab__preview img');
  await inactiveTab.hover();
  await previewImage.waitFor({ state: 'attached', timeout: 60_000 });
  await inactiveTab.locator('.lighttable-document-tab__preview').waitFor({ state: 'visible' });
  const dimensions = await previewImage.evaluate((image) => ({
    naturalWidth: image.naturalWidth,
    naturalHeight: image.naturalHeight,
    src: image.currentSrc
  }));
  if (!dimensions.naturalWidth || !dimensions.naturalHeight
    || Math.abs((dimensions.naturalWidth / dimensions.naturalHeight) - (16 / 9)) > 0.01) {
    throw new Error(`Inactive thumbnail has unexpected dimensions: ${JSON.stringify(dimensions)}`);
  }
  if (pageErrors.length || consoleErrors.length) {
    throw new Error(`Runtime errors: ${JSON.stringify({ pageErrors, consoleErrors })}`);
  }
  await page.screenshot({ path: screenshotPath });
  await writeFile(reportPath, `${JSON.stringify({
    passed: true,
    launchMode: launch.mode,
    inactiveTabNeverActivated: true,
    dimensions,
    screenshotPath
  }, null, 2)}\n`, 'utf8');
  console.log(`Desktop inactive-tab thumbnail smoke passed. Report: ${reportPath}`);
} catch (error) {
  failure = error;
} finally {
  await app.close().catch(() => {});
}

if (failure) throw failure;
