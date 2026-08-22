import { _electron as electron } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import process from 'node:process';
import sharp from 'sharp';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';
import { resolveDesktopTestLaunch } from './desktop-test-startup.mjs';

const root = path.resolve(import.meta.dirname, '..');
const outputDirectory = path.join(root, 'tmp', 'os-open-smoke');
const userData = path.join(outputDirectory, `user-data-${process.pid}`);
await mkdir(userData, { recursive: true });

const fixtures = [
  ['cold.png', (image) => image.png()],
  ['cold.jpg', (image) => image.jpeg()],
  ['cold.webp', (image) => image.webp({ lossless: true })],
  ['cold.tif', (image) => image.tiff({ compression: 'deflate' })],
  ['warm.png', (image) => image.png()]
];
for (const [name, encode] of fixtures) {
  await encode(sharp({
    create: { width: 24, height: 18, channels: 4, background: '#4070b0ff' }
  })).toFile(path.join(outputDirectory, name));
}

const launch = await resolveDesktopTestLaunch(root, { requirePackaged: true });
const environment = { ...process.env, LIGHTTABLE_AUTOMATION_USER_DATA: userData };
delete environment.ELECTRON_RUN_AS_NODE;
const coldFiles = fixtures.slice(0, 4).map(([name]) => path.join(outputDirectory, name));
const app = await electron.launch({
  executablePath: launch.executablePath,
  args: coldFiles,
  cwd: root,
  env: environment,
  timeout: 30_000
});

const waitFor = async (predicate, message, timeout = 90_000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(message);
};

try {
  const page = await app.firstWindow({ timeout: 30_000 });
  const runtimeErrors = [];
  page.on('pageerror', (error) => runtimeErrors.push(error.stack ?? error.message));
  page.on('crash', () => runtimeErrors.push('Renderer process crashed.'));
  page.on('console', (message) => {
    if (message.type() === 'error') runtimeErrors.push(`[console:error] ${message.text()}`);
  });
  const driver = await attachLightTableAutomation(page, 'os-open-smoke');
  const coldWorkspace = await waitFor(async () => {
    const workspace = await driver.queryWorkspace().catch(() => null);
    return workspace?.documents?.length === 4 ? workspace : null;
  }, 'Cold OS launch did not open all four native bitmap formats.');

  const warmFile = path.join(outputDirectory, 'warm.png');
  const second = spawn(launch.executablePath, [warmFile], {
    cwd: root,
    env: environment,
    windowsHide: true,
    stdio: 'ignore'
  });
  // Subscribe immediately: a correctly single-instanced process can exit
  // before the existing window has finished publishing its new document.
  const secondExit = new Promise((resolve) => second.once('exit', (code, signal) => {
    resolve({ code, signal });
  }));
  const warmWorkspace = await waitFor(async () => {
    const workspace = await driver.queryWorkspace().catch(() => null);
    return workspace?.documents?.length === 5 ? workspace : null;
  }, 'Warm second-instance launch did not open its bitmap in the existing app.');
  const exit = await Promise.race([
    secondExit,
    delay(10_000).then(() => null)
  ]);
  if (!exit) {
    second.kill();
    throw new Error('Warm second-instance process did not exit within 10 seconds.');
  }
  if (exit.code !== 0) {
    throw new Error(`Warm second-instance process exited with ${JSON.stringify(exit)}.`);
  }
  if (runtimeErrors.length > 0) {
    throw new Error(`OS-open runtime errors: ${runtimeErrors.join(' | ')}`);
  }
  console.log(JSON.stringify({
    passed: true,
    coldDocuments: coldWorkspace.documents.map(({ title }) => title),
    warmDocuments: warmWorkspace.documents.map(({ title }) => title)
  }, null, 2));
} finally {
  await app.close().catch(() => {});
}
