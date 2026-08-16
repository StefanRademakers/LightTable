import { _electron as electron } from 'playwright-core';
import { access, mkdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(import.meta.dirname, '..');
const sourceFile = path.resolve(process.argv[2] ?? 'D:\\adamus2__0002.png');
const output = path.join(root, 'tmp', 'base-ui-boundary-smoke');
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
  page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
  await page.getByRole('button', { name: 'Open file' }).click();
  await page.locator('.lighttable-toolbar__meta').filter({ hasText: /ready/i })
    .waitFor({ state: 'visible', timeout: 60_000 });
  await page.getByRole('menuitem', { name: 'View', exact: true }).click();
  if (await page.getByRole('menuitem', { name: 'UI Style Guide...', exact: true }).count()) {
    throw new Error('Base build exposes the optional UI Style Guide menu contribution.');
  }
  const menuBackdrop = page.locator('.context-menu-backdrop');
  await menuBackdrop.click({ position: { x: 2, y: 2 } });
  await menuBackdrop.waitFor({ state: 'detached' });
  await page.locator('[data-suite-control="button-base"]:visible').first()
    .click({ modifiers: ['Control', 'Shift', 'Alt'] });
  if (await page.getByRole('dialog', { name: 'UI Style Guide' }).count()) {
    throw new Error('Base build mounted the optional UI inspector shortcut listener.');
  }
  if (pageErrors.length) throw new Error(`Renderer errors: ${JSON.stringify(pageErrors)}`);
  process.stdout.write('Base UI boundary smoke passed: no UI devtools behavior is mounted.\n');
} finally {
  await app.close();
}
