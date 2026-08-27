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
    await window.getByRole('button', { name: 'Open', exact: true }).click();
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
    const treeColumns = await window.locator('.lighttable-layers__list').evaluate((list) => {
      const bounds = (element) => {
        if (!(element instanceof HTMLElement)) return null;
        const rect = element.getBoundingClientRect();
        return { left: rect.left, width: rect.width, centerY: rect.top + rect.height / 2 };
      };
      const rows = Array.from(list.querySelectorAll('.lighttable-layer')).map((row) => ({
        level: Number(row.getAttribute('aria-level') ?? 1),
        paddingLeft: Number.parseFloat(getComputedStyle(row).paddingLeft),
        visibility: bounds(row.querySelector('.lighttable-layer__visibility')),
        depthSpacer: bounds(row.querySelector('.lighttable-layer__depth-spacer')),
        hierarchy: bounds(row.querySelector('.lighttable-layer__hierarchy-slot')),
        clipping: bounds(row.querySelector('.lighttable-layer__clipping-mark')),
        thumbnail: bounds(row.querySelector('.lighttable-layer__thumbnail-slot')),
        row: bounds(row)
      }));
      const projectedChildren = Array.from(list.querySelectorAll('.lighttable-layer-effects')).map((group) => {
        const owner = group.previousElementSibling;
        const first = group.querySelector('.lighttable-layer-effect');
        return {
          ownerContentStart: bounds(
            owner?.querySelector('.lighttable-layer__hierarchy-slot')
              ?? owner?.querySelector('.lighttable-layer__thumbnail-slot')
          ),
          visibility: bounds(first?.querySelector('.lighttable-layer-effect__visibility'))
        };
      });
      return { rows, projectedChildren };
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
    const close = (left, right) => Math.abs(left - right) <= 0.5;
    const visibilityLeft = treeColumns.rows[0]?.visibility?.left;
    for (let index = 0; index < treeColumns.rows.length; index += 1) {
      const row = treeColumns.rows[index];
      const depth = row.level - 1;
      const contentStart = row.visibility ? row.visibility.left + 22 + depth * 22 : 0;
      if (!row.row || !row.visibility || !row.thumbnail
        || !close(row.visibility.width, 18)
        || visibilityLeft === undefined || !close(row.visibility.left, visibilityLeft)
        || !close(row.paddingLeft, 2)
        || !close(row.visibility.centerY, row.thumbnail.centerY)) {
        throw new Error(`Layer prefix columns drift: ${JSON.stringify(row)}`);
      }
      if ((depth === 0 && row.depthSpacer)
        || (depth > 0 && (!row.depthSpacer
          || !close(row.depthSpacer.left - row.visibility.left, 22)
          || !close(row.depthSpacer.width, depth * 22 - 4)))) {
        throw new Error(`Layer depth spacer drifts: ${JSON.stringify(row)}`);
      }
      if (row.hierarchy && (!close(row.hierarchy.width, 18)
        || !close(row.hierarchy.left, contentStart)
        || !close(row.visibility.centerY, row.hierarchy.centerY))) {
        throw new Error(`Layer hierarchy column drifts: ${JSON.stringify(row)}`);
      }
      const clippingLeft = contentStart + (row.hierarchy ? 22 : 0);
      const thumbnailLeft = clippingLeft + (row.clipping ? 22 : 0);
      if (!close(row.thumbnail.left, thumbnailLeft)
        || (row.clipping && (!close(row.clipping.width, 18)
          || !close(row.clipping.left, clippingLeft)))) {
        throw new Error(`Layer clipping columns drift: ${JSON.stringify(row)}`);
      }
      if (row.level > 1) {
        const parent = treeColumns.rows.slice(0, index).reverse()
          .find((candidate) => candidate.level === row.level - 1);
        if (!parent?.hierarchy || !parent.thumbnail || !close(contentStart, parent.thumbnail.left)) {
          throw new Error(`Nested layer content does not align below its parent thumbnail: ${JSON.stringify(row)}`);
        }
      }
    }
    for (const child of treeColumns.projectedChildren) {
      if (!child.ownerContentStart || !child.visibility
        || !close(child.ownerContentStart.left, child.visibility.left)) {
        throw new Error(`Projected layer child columns drift: ${JSON.stringify(child)}`);
      }
    }

    const focusedRow = rows.first();
    if (await focusedRow.getAttribute('tabindex') !== '0') {
      throw new Error('Layer tree rows are not keyboard reachable.');
    }
    await window.keyboard.press('Tab');
    await focusedRow.focus();
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
    report.cases.push({ ...variant, rowCount, geometry,
      columnRows: treeColumns.rows.length,
      projectedChildren: treeColumns.projectedChildren.length,
      focus, scroll, screenshot: name });
  } finally {
    await app?.close().catch(() => {});
    await rm(userData, { recursive: true, force: true }).catch(() => {});
  }
}

report.passed = true;
await writeFile(path.join(evidenceDirectory, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
