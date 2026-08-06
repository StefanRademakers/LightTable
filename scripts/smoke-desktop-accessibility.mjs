import { _electron as electron } from 'playwright-core';
import { access, mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const fixture = 'D:\\TextTest.psd';
const appPath = path.join(root, 'apps', 'desktop');
const executablePath = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const evidenceDirectory = path.join(root, 'tmp', 'accessibility-smoke');
const saveTarget = path.join(evidenceDirectory, 'keyboard-save-export.bin');
const userData = await mkdtemp(path.join(os.tmpdir(), 'lighttable-accessibility-'));
await Promise.all([access(fixture), access(executablePath), mkdir(evidenceDirectory, { recursive: true })]);

const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
const report = { passed: false, journey: [], missingNames: [], pageErrors: [] };
let app;

const activeSnapshot = (window) => window.evaluate(() => {
  const active = document.activeElement;
  return active instanceof HTMLElement ? {
    tag: active.tagName,
    role: active.getAttribute('role'),
    name: active.getAttribute('aria-label') || active.textContent?.trim() || active.getAttribute('title') || '',
    className: active.className
  } : null;
});

const focusUntil = async (window, predicate, maximum = 160) => {
  for (let index = 0; index < maximum; index += 1) {
    await window.keyboard.press('Tab');
    const active = await activeSnapshot(window);
    if (active && predicate(active)) return active;
  }
  throw new Error(`Could not reach requested control after ${maximum} Tab presses.`);
};

const waitForFile = async (file, timeout = 15_000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { await access(file); return; } catch { await new Promise((resolve) => setTimeout(resolve, 50)); }
  }
  throw new Error(`Timed out waiting for ${file}.`);
};

try {
  app = await electron.launch({ executablePath, args: [appPath], cwd: root, env: {
    ...environment,
    LIGHTTABLE_AUTOMATION_OPEN_FILE: fixture,
    LIGHTTABLE_AUTOMATION_SAVE_FILE: saveTarget,
    LIGHTTABLE_AUTOMATION_USER_DATA: userData
  }, timeout: 30_000 });
  const window = await app.firstWindow({ timeout: 30_000 });
  window.on('pageerror', (error) => report.pageErrors.push(error.message));

  await window.getByRole('button', { name: 'Open file' }).waitFor({ state: 'visible', timeout: 30_000 });
  await window.locator('body').focus();
  const open = await focusUntil(window, ({ name }) => name.includes('Open file'), 12);
  report.journey.push({ id: 'launcher-open-focus', active: open });
  await window.keyboard.press('Enter');
  await window.getByRole('tab', { name: /TextTest\.psd/i }).waitFor({ state: 'visible', timeout: 45_000 });
  await window.locator('.lighttable-toolbar__meta').filter({ hasText: /ready/i }).waitFor({ state: 'visible', timeout: 45_000 });

  const fileMenu = await focusUntil(window, ({ role, name }) => role === 'menuitem' && name === 'File');
  report.journey.push({ id: 'menubar-focus', active: fileMenu });
  await window.keyboard.press('ArrowRight');
  if ((await activeSnapshot(window))?.name !== 'Edit') throw new Error('Menubar ArrowRight did not focus Edit.');
  await window.keyboard.press('ArrowDown');
  await window.waitForFunction(() => document.activeElement?.matches('.context-menu [role="menuitem"]'), undefined, { timeout: 5_000 });
  report.journey.push({ id: 'menu-open-and-focus', active: await activeSnapshot(window) });
  await window.keyboard.press('Escape');
  await window.waitForTimeout(100);
  const restoredMenuFocus = await activeSnapshot(window);
  if (restoredMenuFocus?.name !== 'Edit') throw new Error(`Escape did not restore menubar focus: ${JSON.stringify(restoredMenuFocus)}`);

  const tool = await focusUntil(window, ({ className }) => String(className).includes('lighttable-toolbox__button'), 220);
  report.journey.push({ id: 'toolbar-focus', active: tool });
  const activeToolHasPopup = await window.evaluate(() => document.activeElement?.getAttribute('aria-haspopup') === 'true');
  if (activeToolHasPopup) {
    await window.keyboard.press('ArrowDown');
    if (!(await activeSnapshot(window))?.className.includes('lighttable-toolbox__button')) {
      throw new Error('Tool family ArrowDown did not focus its flyout.');
    }
    await window.keyboard.press('Escape');
  }

  const layer = await focusUntil(window, ({ role }) => role === 'treeitem', 260);
  report.journey.push({ id: 'layer-tree-focus', active: layer });
  const originalName = await window.locator('.lighttable-layer:focus .lighttable-layer__name').inputValue();
  await window.keyboard.press('F2');
  await window.locator('.lighttable-layer__name:focus').waitFor({ state: 'visible', timeout: 5_000 });
  await window.keyboard.press('Control+A');
  await window.keyboard.type(`${originalName} accessibility`);
  await window.keyboard.press('Enter');
  // The packaged renderer can still be settling after a preceding stress run.
  // Do not enqueue undo until the committed rename is observable; otherwise
  // Ctrl+Z can race the rename transaction and make this gate flaky.
  await window.waitForFunction((name) => [...document.querySelectorAll('.lighttable-layer__name')]
    .some((input) => input instanceof HTMLInputElement && input.value === `${name} accessibility`), originalName,
  { timeout: 5_000 });
  await window.keyboard.press('Control+Z');
  await window.waitForFunction((name) => [...document.querySelectorAll('.lighttable-layer__name')]
    .some((input) => input instanceof HTMLInputElement && input.value === name), originalName,
  { timeout: 5_000 });
  report.journey.push({ id: 'layer-rename-undo', restored: originalName });

  await window.keyboard.press('Control+S');
  await waitForFile(saveTarget);
  const nativeStat = await stat(saveTarget);
  const nativeHeader = (await readFile(saveTarget)).subarray(0, 8).toString('hex');
  await window.waitForTimeout(30);
  await window.keyboard.press('Control+Shift+S');
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const bytes = await readFile(saveTarget);
    if (bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const exportHeader = (await readFile(saveTarget)).subarray(0, 8).toString('hex');
  if (exportHeader !== '89504e470d0a1a0a') throw new Error('Ctrl+Shift+S did not export PNG.');
  report.journey.push({ id: 'save-and-export', nativeBytes: nativeStat.size, nativeHeader, exportHeader });

  const missingNames = await window.locator('button, input, select, textarea, [role="tab"], [role="treeitem"]').evaluateAll((elements) =>
    elements.filter((element) => {
      if (!(element instanceof HTMLElement) || element.offsetParent === null) return false;
      const label = element.closest('label')?.textContent?.trim();
      return !(element.getAttribute('aria-label') || element.getAttribute('aria-labelledby')
        || element.getAttribute('title') || element.textContent?.trim() || label);
    }).map((element) => ({ tag: element.tagName, className: element.className, type: element.getAttribute('type') })));
  report.missingNames = missingNames;
  if (missingNames.length) throw new Error(`${missingNames.length} visible interactive controls lack an accessible name.`);

  await window.emulateMedia({ reducedMotion: 'reduce', forcedColors: 'active' });
  await window.screenshot({ path: path.join(evidenceDirectory, 'forced-colors-reduced-motion.png') });
  const reducedMotion = await window.locator('.lighttable').evaluate((element) =>
    getComputedStyle(element.querySelector('*') ?? element).transitionDuration);
  report.journey.push({ id: 'reduced-motion-forced-colors', transitionDuration: reducedMotion });
  if (report.pageErrors.length) throw new Error(report.pageErrors.join('; '));
  report.passed = true;
  console.log(JSON.stringify(report, null, 2));
} finally {
  await app?.close().catch(() => {});
  await rm(userData, { recursive: true, force: true }).catch(() => {});
}
