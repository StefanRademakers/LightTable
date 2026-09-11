import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { _electron as electron } from 'playwright-core';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';
import { resolveDesktopTestLaunch, waitForDesktopLauncher } from './desktop-test-startup.mjs';

const root = path.resolve(import.meta.dirname, '..');
const sourceFile = path.resolve(process.argv[2]);
const output = path.join(root, 'tmp', 'pasted-paint-smoke');
await mkdir(output, { recursive: true });
const userData = await mkdtemp(path.join(output, 'profile-'));
const launch = await resolveDesktopTestLaunch(root, { requirePackaged: true });
const env = { ...process.env, LIGHTTABLE_AUTOMATION_USER_DATA: userData,
  LIGHTTABLE_AUTOMATION_OPEN_FILE: sourceFile };
delete env.ELECTRON_RUN_AS_NODE;
const ordering = process.env.LIGHTTABLE_PAINT_ORDERING ?? 'paint-first';
const report = { ordering, errors: [], consoleErrors: [], steps: [] };
let app;
try {
  app = await electron.launch({ executablePath: launch.executablePath, args: launch.args,
    cwd: root, env });
  const page = await app.firstWindow();
  page.on('pageerror', (error) => report.errors.push(String(error.stack ?? error)));
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning' || message.text().startsWith('[Recovery]')) report.consoleErrors.push(message.text());
  });
  const open = await waitForDesktopLauncher({ app, page, outputDirectory: output,
    sourceFile, pageErrors: report.errors, label: 'pasted-paint' });
  await open.click();
  const driver = await attachLightTableAutomation(page, 'pasted-paint');
  await page.locator('.lighttable-toolbar__meta').filter({ hasText: /ready/i }).waitFor();
  const id = (await driver.queryWorkspace()).activeDocumentId;
  report.documentId = id;
  await driver.waitForRenderedDocument(id, 60_000);
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const metrics = window.__paintMetrics = { snapshotBytes: 0, peakSnapshotBytes: 0, captureMs: [], frameMs: [] };
    const originalCreateTexture = GPUDevice.prototype.createTexture;
    const originalDestroy = GPUTexture.prototype.destroy;
    const snapshots = new Map();
    GPUDevice.prototype.createTexture = function (descriptor) {
      const texture = originalCreateTexture.call(this, descriptor);
      if (descriptor.label?.startsWith('LightTable export snapshot:')) {
        const bytes = texture.width * texture.height * (texture.format === 'r16float' ? 2 : 8);
        snapshots.set(texture, bytes);
        metrics.snapshotBytes += bytes;
        metrics.peakSnapshotBytes = Math.max(metrics.peakSnapshotBytes, metrics.snapshotBytes);
      }
      return texture;
    };
    GPUTexture.prototype.destroy = function () {
      if (snapshots.has(this)) {
        metrics.snapshotBytes -= snapshots.get(this);
        snapshots.delete(this);
      }
      return originalDestroy.call(this);
    };
    const createEncoder = GPUDevice.prototype.createCommandEncoder;
    GPUDevice.prototype.createCommandEncoder = function (descriptor) {
      const start = performance.now();
      const encoder = createEncoder.call(this, descriptor);
      if (descriptor?.label === 'LightTable immutable export capture') {
        const finish = encoder.finish.bind(encoder);
        encoder.finish = (...args) => {
          metrics.captureMs.push(performance.now() - start);
          return finish(...args);
        };
      }
      return encoder;
    };
    let last = performance.now();
    const frame = (now) => { metrics.frameMs.push(now - last); last = now; requestAnimationFrame(frame); };
    requestAnimationFrame(frame);
    const info = console.info;
    console.info = (...args) => {
      if (String(args[0]).startsWith('[Recovery] Preparing')) window.__recoveryStarted = true;
      return info(...args);
    };
    const mapAsync = GPUBuffer.prototype.mapAsync;
    GPUBuffer.prototype.mapAsync = async function (...args) {
      await mapAsync.apply(this, args);
      if (window.__delayRecovery && window.__recoveryStarted) {
        window.__readbackWaiting = true;
        await new Promise((resolve) => (window.__releaseReadbacks ??= []).push(resolve));
      }
    };
  });
  const visiblePixels = async (layerId) => {
    const copied = await driver.execute(id, 'selection.copyPixels', { source: 'active-layer' });
    const artifact = await driver.readArtifact(copied.value.artifact.id);
    const pixels = await sharp(artifact.bytes).ensureAlpha().raw().toBuffer();
    let count = 0;
    for (let index = 3; index < pixels.length; index += 4) if (pixels[index] > 0) count++;
    return { count, pixels };
  };
  if (process.env.LIGHTTABLE_PAINT_TRACE === '1') await page.evaluate(() => {
    const destroy = GPUTexture.prototype.destroy;
    GPUTexture.prototype.destroy = function () {
      console.warn(`[Texture destroy] ${this.label} ${this.width}x${this.height}\n${new Error().stack}`);
      return destroy.call(this);
    };
  });
  for (let iteration = 0; iteration < 3; iteration++) {
    await driver.execute(id, 'selection.applyShape', { mode: 'replace',
      shape: { kind: 'rectangle', points: [{ x: 800, y: 400 }, { x: 1500, y: 1000 }] },
      featherRadius: 0, antiAlias: false });
    const copied = await driver.execute(id, 'selection.copyPixels', { source: 'merged' });
    const pasted = await driver.execute(id, 'selection.pastePixels', {
      artifactId: copied.value.artifact.id, bounds: copied.value.bounds,
      name: `Pasted paint ${iteration}` });
    report.steps.push({ pasted: pasted.value });
    const pastedPixels = await visiblePixels(pasted.value.layerId);
    const pastedVisiblePixels = pastedPixels.count;
    assert.ok(pastedVisiblePixels > 100, 'Paste must contain visible pixels');
    if (process.env.LIGHTTABLE_PAINT_TRANSFORM === '1') {
      await page.keyboard.press('Control+t');
      const body = page.locator('.lighttable-transform__body');
      await body.waitFor();
      const bounds = await body.boundingBox();
      await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      await page.mouse.down();
      await page.mouse.move(bounds.x + bounds.width / 2 + 60, bounds.y + bounds.height / 2 + 30, { steps: 8 });
      await page.mouse.up();
      const slider = page.getByRole('slider', { name: 'Exposure' }).first();
      const sliderBounds = await slider.boundingBox();
      await page.mouse.move(sliderBounds.x + sliderBounds.width / 2, sliderBounds.y + sliderBounds.height / 2);
      await page.mouse.down();
      await page.mouse.move(sliderBounds.x + sliderBounds.width * 0.7, sliderBounds.y + sliderBounds.height / 2, { steps: 8 });
      await page.mouse.up();
      await page.waitForTimeout(200);
    }
    await page.keyboard.press('b');
    const viewport = await page.locator('.lighttable-viewport').boundingBox();
    const x = viewport.x + viewport.width / 2;
    const y = viewport.y + viewport.height / 2;
    const before = await driver.queryDocument(id);
    if (ordering === 'recovery-first') {
      await page.evaluate(() => {
        window.__recoveryStarted = false;
        window.__readbackWaiting = false;
        window.__delayRecovery = true;
      });
      await page.waitForFunction(() => window.__readbackWaiting === true, undefined, { timeout: 20000 });
    }
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 70, y + 30, { steps: 20 });
    await page.waitForTimeout(Number(process.env.LIGHTTABLE_PAINT_HOLD_MS ?? (ordering === 'paint-first' ? 8000 : 300)));
    await page.mouse.move(x + 90, y + 45, { steps: 12 });
    await page.mouse.up();
    if (ordering === 'recovery-first') await page.evaluate(() => {
      window.__delayRecovery = false;
      for (const resolve of window.__releaseReadbacks ?? []) resolve();
      window.__releaseReadbacks = [];
    });
    await page.waitForTimeout(800);
    report.steps.push({ afterPaint: await driver.queryDocument(id), layers: await driver.queryLayers(id) });
    await page.screenshot({ path: path.join(output, `paint-${iteration}.png`) });
    assert.equal(await page.getByText('Loading image and WebGPU pipeline...').isVisible(), false);
    assert.equal((await driver.queryDocument(id)).history.undoDepth, before.history.undoDepth + 1);
    const paintedPixels = await visiblePixels(pasted.value.layerId);
    const paintedVisiblePixels = paintedPixels.count;
    report.steps.push({ pastedVisiblePixels, paintedVisiblePixels });
    assert.ok(paintedVisiblePixels >= pastedVisiblePixels * 0.99,
      `Painting lost pasted content: ${pastedVisiblePixels} -> ${paintedVisiblePixels}`);
    assert.equal(paintedPixels.pixels.equals(pastedPixels.pixels), false, 'Brush must actually change pixels');
    const committed = report.consoleErrors.filter((line) => line.startsWith('[Recovery] Checkpoint committed')).length;
    await page.waitForTimeout(6000);
    assert.ok(report.consoleErrors.filter((line) => line.startsWith('[Recovery] Checkpoint committed')).length > committed,
      'The new painted revision must produce a real recovery checkpoint');
    await driver.execute(id, 'history.undo', {});
    assert.deepEqual((await visiblePixels(pasted.value.layerId)).pixels, pastedPixels.pixels,
      'Undo must restore the exact pasted pixels after recovery');
    await driver.execute(id, 'history.redo', {});
    assert.deepEqual((await visiblePixels(pasted.value.layerId)).pixels, paintedPixels.pixels,
      'Redo must restore the exact painted pixels after recovery');
  }
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.consoleErrors.filter((line) => line.startsWith('[Recovery]')
    && !/^\[Recovery\] (Preparing|Revision|Checkpoint committed)/.test(line)), [],
  'Superseded recovery is normal scheduling, not a reported failure');
  report.metrics = await page.evaluate(() => window.__paintMetrics);
  assert.equal(report.metrics.snapshotBytes, 0, 'Export snapshots must be released');
  console.log('Pasted paint smoke passed');
} finally {
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  await app?.close();
}
