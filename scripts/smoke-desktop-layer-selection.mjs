import { _electron as electron } from 'playwright-core';
import { access, mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { resolveDesktopTestLaunch, waitForDesktopLauncher } from './desktop-test-startup.mjs';

const root = path.resolve(import.meta.dirname, '..');
const fixture = path.resolve(process.argv[2]
  ?? 'D:\\mediavibe\\LightTableTestFiles\\RandomFiles\\shapes.psd');
const outputDirectory = path.join(root, 'tmp', 'layer-selection-smoke');
await Promise.all([access(fixture), mkdir(outputDirectory, { recursive: true })]);
const userData = await mkdtemp(path.join(outputDirectory, 'profile-'));
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;

let app;
try {
  const launch = await resolveDesktopTestLaunch(root);
  app = await electron.launch({
    executablePath: launch.executablePath,
    args: launch.args,
    cwd: root,
    env: {
      ...environment,
      LIGHTTABLE_AUTOMATION_USER_DATA: userData,
      LIGHTTABLE_AUTOMATION_OPEN_FILE: fixture
    },
    timeout: 30_000
  });
  const window = await app.firstWindow({ timeout: 30_000 });
  const pageErrors = [];
  window.on('pageerror', (error) => pageErrors.push(error.message));
  const open = await waitForDesktopLauncher({
    app, page: window, outputDirectory, sourceFile: fixture,
    pageErrors, label: 'layer-selection'
  });
  await open.click();
  await window.locator('.lighttable-toolbar__meta').filter({ hasText: /ready/i })
    .waitFor({ timeout: 60_000 });

  const rows = window.locator('.lighttable-layer[data-layer-id]');
  for (let index = 0; index < 4; index += 1) {
    await window.getByRole('menuitem', { name: 'Layer' }).click();
    await window.getByRole('menuitem', { name: 'New Raster Layer' }).click();
  }
  await rows.nth(4).waitFor();

  const selectedIds = () => window.locator('.lighttable-layer--selected')
    .evaluateAll((elements) => elements.map((element) => element.dataset.layerId));
  await window.evaluate(() => {
    window.__layerSelectionTrace = [];
    const snapshot = (kind, event = null) => {
      window.__layerSelectionTrace.push({
        kind,
        detail: event?.detail ?? null,
        shiftKey: event?.shiftKey ?? null,
        target: event?.target?.closest?.('.lighttable-layer')?.dataset.layerId ?? null,
        selected: [...document.querySelectorAll('.lighttable-layer--selected')]
          .map((element) => element.dataset.layerId),
        active: document.querySelector('.lighttable-layer--active')?.dataset.layerId ?? null
      });
    };
    for (const kind of ['pointerdown', 'click', 'dblclick', 'dragstart']) {
      document.addEventListener(kind, (event) => snapshot(kind, event), true);
    }
    new MutationObserver(() => snapshot('mutation')).observe(
      document.querySelector('.lighttable-layers__list'),
      { attributes: true, attributeFilter: ['class'], subtree: true }
    );
  });
  const assertFullRange = async (label) => {
    await window.waitForTimeout(100);
    const selected = await selectedIds();
    if (selected.length !== 5) {
      const trace = await window.evaluate(() => window.__layerSelectionTrace);
      throw new Error(`${label} selected ${selected.length}/5 layers: ${JSON.stringify(selected)}\n${JSON.stringify(trace, null, 2)}`);
    }
  };
  const resetAnchor = async () => {
    await rows.first().click();
    await window.waitForTimeout(50);
  };

  await resetAnchor();
  await rows.nth(4).click({ modifiers: ['Shift'] });
  await assertFullRange('Layer row Shift-click');

  await resetAnchor();
  await rows.nth(4).locator('.lighttable-layer__name').click({ modifiers: ['Shift'] });
  await assertFullRange('Layer name Shift-click');

  await resetAnchor();
  await rows.nth(4).locator('.lighttable-layer__thumbnail').first().click({ modifiers: ['Shift'] });
  await assertFullRange('Layer thumbnail Shift-click');

  await resetAnchor();
  await rows.nth(2).click({ modifiers: ['Control'] });
  await window.waitForTimeout(100);
  const toggled = await selectedIds();
  if (toggled.length !== 2) {
    throw new Error(`Layer row Ctrl-click selected ${toggled.length}/2 layers: ${JSON.stringify(toggled)}`);
  }

  await resetAnchor();
  const activeLayerId = await rows.first().getAttribute('data-layer-id');
  if (!activeLayerId) throw new Error('The active layer has no stable layer id.');
  const activeName = window.locator(
    `.lighttable-layer[data-layer-id="${activeLayerId}"] .lighttable-layer__name`
  );
  const nameBounds = await activeName.boundingBox();
  if (!nameBounds) throw new Error('Could not measure the active layer name.');
  await window.mouse.move(nameBounds.x + nameBounds.width / 2, nameBounds.y + nameBounds.height / 2);
  await window.mouse.down();
  await window.mouse.move(nameBounds.x + nameBounds.width / 2, nameBounds.y + nameBounds.height + 8,
    { steps: 6 });
  await window.locator('.lighttable-layer--dragging').waitFor({ timeout: 2_000 });
  await window.mouse.up();

  // Two ordinary clicks outside a normal double-click interval must never be
  // accumulated into a rename gesture.
  await activeName.click();
  await window.waitForTimeout(700);
  await activeName.click();
  await window.waitForTimeout(100);
  if (await activeName.getAttribute('readonly') === null) {
    throw new Error('Separated layer-name clicks incorrectly accumulated into rename mode.');
  }
  await window.waitForTimeout(700);

  await activeName.dblclick();
  if (await activeName.getAttribute('readonly') !== null) {
    const trace = await window.evaluate(() => window.__layerSelectionTrace);
    throw new Error(`Double-clicking the already-active layer name did not begin rename.\n${JSON.stringify(trace.slice(-12), null, 2)}`);
  }
  await window.keyboard.press('Escape');

  const inactiveName = window.locator(
    `.lighttable-layer:not([data-layer-id="${activeLayerId}"]) .lighttable-layer__name`
  ).last();
  await inactiveName.dblclick();
  await window.waitForTimeout(100);
  if (await inactiveName.getAttribute('readonly') === null) {
    throw new Error('Double-clicking an initially inactive layer name incorrectly began rename.');
  }

  if (pageErrors.length) throw new Error(`Layer-selection page errors: ${pageErrors.join(' | ')}`);
  console.log('Desktop layer-selection smoke passed for range, toggle, name drag and rename gating.');
} finally {
  await app?.close();
}
