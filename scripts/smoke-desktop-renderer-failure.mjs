import { _electron as electron } from 'playwright-core';
import { mkdtemp, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { resolveDesktopTestLaunch, waitForDesktopLauncher } from './desktop-test-startup.mjs';
const root = path.resolve(import.meta.dirname, '..');
const outputDirectory = path.join(root, 'tmp', 'recovery-feedback');
await mkdir(outputDirectory, { recursive: true });
const userData = await mkdtemp(path.join(outputDirectory, 'profile-'));
const sourceFile = path.resolve(process.argv[2]);
const launch = await resolveDesktopTestLaunch(root, { requirePackaged: true });
const env = { ...process.env, LIGHTTABLE_AUTOMATION_USER_DATA: userData, LIGHTTABLE_AUTOMATION_OPEN_FILE: sourceFile };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: launch.executablePath, args: launch.args, cwd: root, env });
try {
  const page = await app.firstWindow();
  await page.evaluate(() => {
    const request = GPUAdapter.prototype.requestDevice;
    GPUAdapter.prototype.requestDevice = async function (...args) {
      const device = await request.apply(this, args);
      window.__failureProofDevice = device;
      return device;
    };
  });
  await (await waitForDesktopLauncher({ app, page, outputDirectory, sourceFile, pageErrors: [], label: 'feedback' })).click();
  await page.locator('.lighttable-toolbar__meta').filter({ hasText: /ready/i }).waitFor();
    await page.evaluate(() => window.__failureProofDevice.dispatchEvent(new GPUUncapturedErrorEvent('uncapturederror', {
      error: new GPUValidationError('Test diagnostic: <texture> is unavailable.\nEncoding cannot continue.')
    })));
    await page.locator('.lighttable-viewport__message--error').waitFor();
    const message = await page.locator('.lighttable-viewport__message--error').innerText();
    if (!message.includes('<texture>') || await page.getByText('Loading image and WebGPU pipeline...').isVisible()) {
      throw new Error('Renderer failure was not preserved as escaped visible text.');
    }
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(outputDirectory, 'failure.png') });
    console.log('Persistent renderer failure presentation passed');
} finally { await app.close(); }
