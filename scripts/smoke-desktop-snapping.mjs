import { _electron as electron } from 'playwright-core';
import { access, mkdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';
import { resolveDesktopTestLaunch, waitForDesktopLauncher } from './desktop-test-startup.mjs';

const workspaceRoot = path.resolve(import.meta.dirname, '..');
const sourceFile = path.resolve(process.argv[2] ?? 'D:\\shapes.psd');
const launch = await resolveDesktopTestLaunch(workspaceRoot);
const outputDirectory = path.join(workspaceRoot, 'tmp', 'snapping-smoke');
const userDataPath = path.join(outputDirectory, `user-data-${process.pid}`);
const screenshotPath = path.join(outputDirectory, 'multi-layer-transform.png');

await Promise.all([access(sourceFile), mkdir(userDataPath, { recursive: true })]);
const launchEnvironment = { ...process.env };
delete launchEnvironment.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath: launch.executablePath,
  args: launch.args,
  cwd: workspaceRoot,
  env: {
    ...launchEnvironment,
    LIGHTTABLE_AUTOMATION_OPEN_FILE: sourceFile,
    LIGHTTABLE_AUTOMATION_USER_DATA: userDataPath
  },
  timeout: 30_000
});

try {
  const page = await app.firstWindow({ timeout: 30_000 });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
  const openFile = await waitForDesktopLauncher({
    app, page, outputDirectory, sourceFile, pageErrors, label: 'snapping'
  });
  await openFile.click();
  await page.locator('.lighttable-toolbar__meta').filter({ hasText: /ready/i })
    .waitFor({ state: 'visible', timeout: 60_000 });

  const driver = await attachLightTableAutomation(page, 'snapping-smoke');
  const documentId = (await driver.queryWorkspace())?.activeDocumentId;
  if (!documentId) throw new Error('No active document was published.');
  const before = await driver.waitForLayers(documentId);
  const candidates = before.filter((layer) => (
    layer.parentId === null && layer.visible && !/background/i.test(layer.name)
  )).slice(0, 2);
  if (candidates.length !== 2) throw new Error('The fixture has fewer than two visible root layers.');

  await page.locator(`[data-layer-id="${candidates[0].id}"]`).click();
  await page.locator(`[data-layer-id="${candidates[1].id}"]`).click({ modifiers: ['Control'] });
  await page.keyboard.press('v');
  const overlay = page.locator('svg[aria-label="Transform controls"]');
  await overlay.waitFor({ state: 'visible', timeout: 10_000 });
  const body = overlay.locator('.lighttable-transform__body');
  const bounds = await body.boundingBox();
  if (!bounds) throw new Error('The group transform body has no measurable bounds.');
  const start = await page.evaluate(({ x, y, width, height }) => {
    for (const fy of [0.2, 0.35, 0.5, 0.65, 0.8]) {
      for (const fx of [0.2, 0.35, 0.5, 0.65, 0.8]) {
        const point = { x: x + width * fx, y: y + height * fy };
        if (document.elementFromPoint(point.x, point.y)?.classList.contains('lighttable-transform__body')) {
          return point;
        }
      }
    }
    return null;
  }, bounds);
  if (!start) throw new Error('Floating panel chrome covers the complete transform body.');
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 37, start.y + 23, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(100);

  const after = await driver.queryLayers(documentId);
  const deltas = candidates.map((candidate) => {
    const changed = after?.find((layer) => layer.id === candidate.id);
    if (!changed) throw new Error(`Layer ${candidate.id} disappeared during transform.`);
    return {
      x: changed.transform.tx - candidate.transform.tx,
      y: changed.transform.ty - candidate.transform.ty
    };
  });
  const close = (left, right) => Math.abs(left - right) < 1e-4;
  if ((Math.abs(deltas[0].x) + Math.abs(deltas[0].y)) < 1e-4
    || !close(deltas[0].x, deltas[1].x)
    || !close(deltas[0].y, deltas[1].y)) {
    throw new Error(`Selected layers did not share one document delta: ${JSON.stringify(deltas)}`);
  }
  await page.screenshot({ path: screenshotPath });
  const fatalStatus = await page.locator('.lighttable-status--error').allTextContents().catch(() => []);
  if (pageErrors.length || fatalStatus.length) {
    throw new Error(`Runtime errors: ${JSON.stringify({ pageErrors, fatalStatus })}`);
  }
  process.stdout.write(`Snapping smoke passed. Delta: ${JSON.stringify(deltas[0])}. Screenshot: ${screenshotPath}\n`);
} finally {
  await app.close().catch(() => {});
}
