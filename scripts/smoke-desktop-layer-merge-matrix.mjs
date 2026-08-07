import { _electron as electron } from 'playwright-core';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import sharp from 'sharp';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';
import { resolveDesktopTestLaunch, waitForDesktopLauncher } from './desktop-test-startup.mjs';

const workspaceRoot = path.resolve(import.meta.dirname, '..');
const sourceFiles = process.argv.slice(2).length
  ? process.argv.slice(2).map((file) => path.resolve(file))
  : ['D:\\shapes.psd', 'D:\\TextTest.psd'];
const outputDirectory = path.join(workspaceRoot, 'tmp', 'layer-merge-matrix');
const MAX_RMSE = 2;

const comparePng = async (before, after) => {
  const left = await sharp(before).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const right = await sharp(after).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (left.info.width !== right.info.width || left.info.height !== right.info.height) {
    throw new Error(`Canvas dimensions changed from ${left.info.width}x${left.info.height} to ${right.info.width}x${right.info.height}.`);
  }
  let squaredError = 0;
  for (let index = 0; index < left.data.length; index += 1) {
    const delta = left.data[index] - right.data[index];
    squaredError += delta * delta;
  }
  return Math.sqrt(squaredError / left.data.length);
};

const animationFrames = (page, count = 3) => page.evaluate(async (frames) => {
  for (let index = 0; index < frames; index += 1) {
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
}, count);

const screenshotCanvas = async (page, canvas) => {
  await page.evaluate(() => {
    document.querySelectorAll('.dv-floating-overlay-host').forEach((element) => {
      element.dataset.mergeSmokeVisibility = element.style.visibility;
      element.style.visibility = 'hidden';
    });
  });
  await animationFrames(page, 1);
  const screenshot = await canvas.screenshot();
  await page.evaluate(() => {
    document.querySelectorAll('.dv-floating-overlay-host').forEach((element) => {
      element.style.visibility = element.dataset.mergeSmokeVisibility ?? '';
      delete element.dataset.mergeSmokeVisibility;
    });
  });
  return screenshot;
};

const siblingRuns = (layers) => {
  const byParent = new Map();
  for (const layer of layers) {
    const key = layer.parentId ?? 'root';
    const siblings = byParent.get(key) ?? [];
    siblings.push(layer);
    byParent.set(key, siblings);
  }
  return [...byParent.values()].filter((siblings) => siblings.length >= 2);
};

const safeName = (value) => value.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();

const runFile = async (sourceFile, fileIndex) => {
  await access(sourceFile);
  const launch = await resolveDesktopTestLaunch(workspaceRoot);
  const userDataPath = path.join(outputDirectory, `user-data-${process.pid}-${fileIndex}`);
  await mkdir(userDataPath, { recursive: true });
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
      app, page, outputDirectory, sourceFile, pageErrors,
      label: `layer-merge-${fileIndex}`
    });
    await openFile.click();
    await page.locator('.lighttable-toolbar__meta').filter({ hasText: /ready/i })
      .waitFor({ state: 'visible', timeout: 60_000 });
    const driver = await attachLightTableAutomation(page, `layer-merge-${fileIndex}`);
    const workspace = await driver.queryWorkspace();
    const documentId = workspace?.activeDocumentId;
    if (!documentId) throw new Error('No active document was published.');
    const initialLayers = await driver.waitForLayers(documentId);
    const canvas = page.locator('.lighttable-viewport__canvas');
    await canvas.waitFor({ state: 'visible' });
    const results = [];

    for (const siblings of siblingRuns(initialLayers)) {
      for (let index = 1; index < siblings.length; index += 1) {
        const bottom = siblings[index - 1];
        const top = siblings[index];
        if (await page.locator(`[data-layer-id="${top.id}"]`).count() === 0) continue;
        process.stdout.write(`Merge-down ${bottom.type}:${bottom.name} -> ${top.type}:${top.name}\n`);
        const before = await screenshotCanvas(page, canvas);
        await page.locator(`[data-layer-id="${top.id}"]`).click();
        await page.keyboard.press('Control+e');
        try {
          await page.waitForFunction(({ documentId, bottomId, topId }) => {
            const layers = window.__lightTableAutomation?.queryLayers(documentId) ?? [];
            return !layers.some(({ id }) => id === bottomId || id === topId);
          }, { documentId, bottomId: bottom.id, topId: top.id }, { timeout: 15_000 });
        } catch (reason) {
          const body = (await page.locator('body').innerText()).slice(-2_000);
          throw new Error(
            `Merge-down did not complete for ${bottom.type}:${bottom.name} -> ${top.type}:${top.name}. UI: ${body}`,
            { cause: reason }
          );
        }
        await animationFrames(page);
        const after = await screenshotCanvas(page, canvas);
        const rmse = await comparePng(before, after);
        const evidenceStem = `${fileIndex}-${safeName(bottom.name)}-${safeName(top.name)}`;
        const beforePath = path.join(outputDirectory, `${evidenceStem}-before.png`);
        const afterPath = path.join(outputDirectory, `${evidenceStem}-after.png`);
        await Promise.all([writeFile(beforePath, before), writeFile(afterPath, after)]);
        results.push({ operation: 'merge-down', bottom, top, rmse, beforePath, afterPath });
        if (rmse > MAX_RMSE) {
          throw new Error(`${bottom.type} -> ${top.type} merge RMSE ${rmse.toFixed(3)} exceeds ${MAX_RMSE}.`);
        }
        await driver.execute(documentId, 'history.undo', {});
        await page.waitForFunction(({ documentId, bottomId, topId }) => {
          const layers = window.__lightTableAutomation?.queryLayers(documentId) ?? [];
          return layers.some(({ id }) => id === bottomId) && layers.some(({ id }) => id === topId);
        }, { documentId, bottomId: bottom.id, topId: top.id }, { timeout: 15_000 });
        await animationFrames(page);
      }

      if (siblings.length >= 3) {
        const selected = siblings.slice(0, 3);
        if (await Promise.all(selected.map(
          ({ id }) => page.locator(`[data-layer-id="${id}"]`).count()
        )).then((counts) => counts.some((count) => count === 0))) continue;
        const before = await screenshotCanvas(page, canvas);
        await page.locator(`[data-layer-id="${selected[0].id}"]`).click();
        for (const layer of selected.slice(1)) {
          await page.locator(`[data-layer-id="${layer.id}"]`).click({ modifiers: ['Control'] });
        }
        await page.locator(`[data-layer-id="${selected.at(-1).id}"]`).click({ button: 'right' });
        await page.getByText(/^Merge Selected \(3\)$/).click();
        await page.waitForFunction(({ documentId, selectedIds }) => {
          const layers = window.__lightTableAutomation?.queryLayers(documentId) ?? [];
          return selectedIds.every((id) => !layers.some((layer) => layer.id === id));
        }, { documentId, selectedIds: selected.map(({ id }) => id) }, { timeout: 15_000 });
        await animationFrames(page);
        const after = await screenshotCanvas(page, canvas);
        const rmse = await comparePng(before, after);
        results.push({ operation: 'merge-selected', layers: selected, rmse });
        if (rmse > MAX_RMSE) {
          throw new Error(`Three-layer merge RMSE ${rmse.toFixed(3)} exceeds ${MAX_RMSE}.`);
        }
        await driver.execute(documentId, 'history.undo', {});
      }
    }

    if (pageErrors.length) throw new Error(`Page errors: ${JSON.stringify(pageErrors)}`);
    return { sourceFile, results, pageErrors };
  } finally {
    await app.close().catch(() => {});
  }
};

await mkdir(outputDirectory, { recursive: true });
const reports = [];
for (const [index, sourceFile] of sourceFiles.entries()) {
  reports.push(await runFile(sourceFile, index));
}
const reportPath = path.join(outputDirectory, 'report.json');
await writeFile(reportPath, `${JSON.stringify({ maxRmse: MAX_RMSE, reports }, null, 2)}\n`);
process.stdout.write(`Layer merge matrix smoke passed. Report: ${reportPath}\n`);
