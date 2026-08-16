import { _electron as electron } from 'playwright-core';
import { access, mkdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(import.meta.dirname, '..');
const sourceFile = path.resolve(process.argv[2] ?? 'D:\\adamus2__0002.png');
const output = path.join(root, 'tmp', 'selection-zoom-drag-smoke');
const executablePath = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
await Promise.all([access(sourceFile), access(executablePath), mkdir(output, { recursive: true })]);

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath,
  args: [path.join(root, 'apps', 'desktop')],
  cwd: root,
  env: {
    ...env,
    LIGHTTABLE_AUTOMATION_OPEN_FILE: sourceFile,
    LIGHTTABLE_AUTOMATION_USER_DATA: path.join(output, `user-data-${process.pid}`)
  },
  timeout: 30_000
});

try {
  const page = await app.firstWindow({ timeout: 30_000 });
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  await page.getByRole('button', { name: 'Open file' }).click();
  const ready = page.locator('.lighttable-toolbar__meta').filter({ hasText: /ready/i });
  await ready.waitFor({ state: 'visible', timeout: 60_000 });
  const viewport = page.locator('.lighttable-viewport');
  const bounds = await viewport.boundingBox();
  if (!bounds) throw new Error('Viewport bounds are unavailable.');
  const zoomPercent = async () => {
    const text = await ready.textContent() ?? '';
    const match = text.match(/(\d+(?:\.\d+)?)%/);
    if (!match) throw new Error(`Zoom percentage is unavailable: ${text}`);
    return Number(match[1]);
  };

  await page.keyboard.press('m');
  await page.locator('.lighttable-tool-options__identity')
    .filter({ hasText: 'Rectangular selection' }).waitFor({ state: 'visible' });
  // Stay clear of the floating Layers panel while keeping the marquee around
  // a stable point that can be projected through the centered zoom.
  const viewportCenter = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  const center = { x: bounds.x + bounds.width * 0.78, y: bounds.y + bounds.height * 0.34 };
  await page.mouse.move(center.x - 70, center.y - 55);
  await page.mouse.down();
  await page.mouse.move(center.x + 70, center.y + 55, { steps: 6 });
  await page.locator('.lighttable-selection__dimensions').waitFor({ state: 'visible' });
  await page.mouse.up();

  const beforeZoom = await zoomPercent();
  await page.keyboard.press('Control+=');
  await page.waitForFunction((before) => {
    const text = [...document.querySelectorAll('.lighttable-toolbar__meta')]
      .map((node) => node.textContent ?? '').find((value) => /ready/i.test(value)) ?? '';
    return Number(text.match(/(\d+(?:\.\d+)?)%/)?.[1] ?? before) > before;
  }, beforeZoom);
  const scaleRatio = (await zoomPercent()) / beforeZoom;
  const transformedCenter = {
    x: viewportCenter.x + (center.x - viewportCenter.x) * scaleRatio,
    y: viewportCenter.y + (center.y - viewportCenter.y) * scaleRatio
  };
  await page.mouse.move(transformedCenter.x, transformedCenter.y);
  await page.mouse.down();
  await page.mouse.move(transformedCenter.x + 45, transformedCenter.y + 24, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(250);

  const statusError = await page.locator('.lighttable-toolbar__status--error').textContent().catch(() => null);
  await page.screenshot({ path: path.join(output, 'selection-zoom-drag.png') });
  if (statusError) throw new Error(`Editor status error: ${statusError}`);
  const relevantConsoleErrors = consoleErrors.filter((message) =>
    /WebGPU|CommandBuffer|selection transform/i.test(message));
  if (pageErrors.length || relevantConsoleErrors.length) {
    throw new Error(`Runtime errors: ${JSON.stringify({ pageErrors, relevantConsoleErrors })}`);
  }
  process.stdout.write(`Selection zoom-drag smoke passed. Output: ${output}\n`);
} finally {
  await app.close().catch(() => {});
}
