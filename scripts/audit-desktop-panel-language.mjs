import { _electron as electron } from 'playwright-core';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const fixture = process.argv[2] ?? 'D:\\mediavibe\\LightTableTestFiles\\psd\\templates\\Save the Date Invitation PSD 6\\EHS-396\\EHS-396\\EHS-396.psd';
const executablePath = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const appPath = path.join(root, 'apps', 'desktop');
const evidenceDirectory = path.join(root, 'tmp', 'panel-language-audit');
const matrix = [
  { width: 1050, height: 760, scale: 1 },
  { width: 1600, height: 960, scale: 1 },
  { width: 1050, height: 760, scale: 2 },
  { width: 1600, height: 960, scale: 2 }
];

await Promise.all([access(fixture), access(executablePath), mkdir(evidenceDirectory, { recursive: true })]);
const report = { fixture, passed: false, cases: [] };

for (const variant of matrix) {
  const userData = await mkdtemp(path.join(os.tmpdir(), 'lighttable-panel-language-'));
  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  let app;
  try {
    app = await electron.launch({
      executablePath,
      args: [appPath, `--force-device-scale-factor=${variant.scale}`],
      cwd: root,
      env: {
        ...environment,
        LIGHTTABLE_AUTOMATION_OPEN_FILE: fixture,
        LIGHTTABLE_AUTOMATION_USER_DATA: userData
      },
      timeout: 30_000
    });
    const window = await app.firstWindow({ timeout: 30_000 });
    await window.setViewportSize({ width: variant.width, height: variant.height });
    const errors = [];
    window.on('pageerror', (error) => errors.push(error.message));
    await window.getByRole('button', { name: 'Open file' }).click();
    await window.locator('.lighttable-layer').first().waitFor({ state: 'visible', timeout: 60_000 });
    await window.locator('.lighttable-toolbar__meta').filter({ hasText: /ready/i })
      .waitFor({ state: 'visible', timeout: 60_000 });
    await window.waitForTimeout(500);

    const rows = window.locator('.lighttable-layer');
    const rowCount = await rows.count();
    const geometry = await window.locator('.lighttable-layers__list').evaluate((list) => {
      const row = list.querySelector('.lighttable-layer');
      const slot = list.querySelector('.lighttable-layer__thumbnail-slot');
      const preview = list.querySelector('.lighttable-layer__thumbnail-preview');
      const status = list.querySelector('.lighttable-layer__status');
      if (!(row instanceof HTMLElement) || !(slot instanceof HTMLElement)) {
        throw new Error('Layers geometry is unavailable.');
      }
      const listBounds = list.getBoundingClientRect();
      const rowBounds = row.getBoundingClientRect();
      const slotBounds = slot.getBoundingClientRect();
      const previewBounds = preview?.getBoundingClientRect();
      return {
        rowWidth: rowBounds.width,
        listWidth: listBounds.width,
        rowHeight: rowBounds.height,
        slotWidth: slotBounds.width,
        slotHeight: slotBounds.height,
        previewWidth: previewBounds?.width ?? 0,
        previewHeight: previewBounds?.height ?? 0,
        previewObjectFit: preview ? getComputedStyle(preview).objectFit : null,
        statusOverflow: status ? getComputedStyle(status).overflow : null,
        horizontalOverflow: list.scrollWidth - list.clientWidth
      };
    });
    if (Math.abs(geometry.slotWidth - geometry.slotHeight) > 0.5) throw new Error('Thumbnail slot is not square.');
    if (geometry.previewWidth > geometry.slotWidth || geometry.previewHeight > geometry.slotHeight) {
      throw new Error('Thumbnail preview escapes its bounded slot.');
    }
    if (geometry.previewObjectFit && geometry.previewObjectFit !== 'contain') {
      throw new Error(`Thumbnail object-fit is ${geometry.previewObjectFit}.`);
    }
    if (geometry.horizontalOverflow > 1 || geometry.rowWidth > geometry.listWidth + 1) {
      throw new Error('Layer content changes the tree width.');
    }
    if (geometry.statusOverflow !== 'hidden') throw new Error('Layer status can escape its fixed slot.');

    await window.locator('body').focus();
    let focusedRow = null;
    for (let index = 0; index < 320; index += 1) {
      await window.keyboard.press('Tab');
      if (await window.evaluate(() => document.activeElement?.matches('.lighttable-layer'))) {
        focusedRow = window.locator('.lighttable-layer:focus');
        break;
      }
    }
    if (!focusedRow) throw new Error('Layer tree is not keyboard reachable.');
    const focus = await focusedRow.evaluate((row) => {
      const style = getComputedStyle(row);
      return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth };
    });
    if (focus.outlineStyle === 'none' || focus.outlineWidth === '0px') {
      throw new Error('Focused layer row has no visible focus replacement.');
    }

    // Let deferred evaluated thumbnails settle before measuring tree-only work.
    await window.waitForTimeout(1_500);
    const scroll = await window.locator('.lighttable-layers__list').evaluate(async (list) => {
      const samples = [];
      for (let index = 0; index < 24; index += 1) {
        const started = performance.now();
        list.scrollTop = index % 2 ? 0 : list.scrollHeight;
        await new Promise(requestAnimationFrame);
        samples.push(performance.now() - started);
      }
      samples.sort((a, b) => a - b);
      return { p95Ms: samples[Math.floor(samples.length * 0.95)], maxMs: samples.at(-1) };
    });
    if (scroll.p95Ms > 100) throw new Error(`Layer-stack scroll p95 ${scroll.p95Ms.toFixed(1)} ms.`);
    if (errors.length) throw new Error(errors.join('; '));

    const name = `${variant.width}x${variant.height}@${variant.scale}x.png`;
    await window.screenshot({ path: path.join(evidenceDirectory, name), fullPage: false });
    report.cases.push({ ...variant, rowCount, geometry, focus, scroll, screenshot: name });
  } finally {
    await app?.close().catch(() => {});
    await rm(userData, { recursive: true, force: true }).catch(() => {});
  }
}

report.passed = true;
await writeFile(path.join(evidenceDirectory, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
