import { _electron as electron } from 'playwright-core';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const executablePath = process.env.LIGHTTABLE_TEST_EXECUTABLE;
if (!executablePath) throw new Error('LIGHTTABLE_TEST_EXECUTABLE is required.');
const profile = await mkdtemp(path.join(os.tmpdir(), 'lighttable-local-mcp-'));
const environment = { ...process.env, LIGHTTABLE_AUTOMATION_USER_DATA: profile };
delete environment.ELECTRON_RUN_AS_NODE;
let app;
try {
  app = await electron.launch({ executablePath, env: environment });
  const page = await app.firstWindow({ timeout: 30_000 });
  await page.getByRole('button', { name: 'New Document', exact: true }).click();
  const create = page.locator('.lighttable-new-document-dialog--embedded');
  await create.getByLabel('Name').fill('Local MCP preferences smoke');
  await create.getByRole('button', { name: 'Create', exact: true }).click();
  await page.locator('.lighttable-toolbar__meta').filter({ hasText: /ready/i }).waitFor({ timeout: 30_000 });
  await page.getByRole('menuitem', { name: 'Edit' }).click();
  await page.getByRole('menuitem', { name: 'Preferences...' }).click();
  const preferences = page.getByRole('dialog', { name: 'Preferences' });
  await preferences.getByRole('button', { name: 'Agent Access' }).click();
  const local = preferences.locator('.lighttable-agent-settings__card').filter({ hasText: 'Local Codex' });
  const access = preferences.getByRole('switch', { name: 'Allow agent connections' });
  await preferences.getByLabel('Online MCP server').click();
  await preferences.getByLabel('Server URL').waitFor();
  if (!await access.isDisabled()) throw new Error('Unpaired online mode unexpectedly enabled agent access.');
  await preferences.getByLabel('Local test mode').click();
  await access.click();
  await local.getByText('running', { exact: true }).waitFor({ timeout: 30_000 });
  await access.click();
  await local.getByText('stopped', { exact: true }).waitFor({ timeout: 15_000 });
  await access.click();
  await local.getByText('running', { exact: true }).waitFor({ timeout: 30_000 });
  process.stdout.write('Local MCP Preferences smoke passed: one-switch start, auto-pair, stop and restart.\n');
} finally {
  await app?.close().catch(() => undefined);
  const resolved = path.resolve(profile);
  if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)) {
    await rm(resolved, { recursive: true, force: true });
  }
}
