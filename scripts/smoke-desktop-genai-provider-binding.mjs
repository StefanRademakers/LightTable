import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { _electron as electron } from 'playwright-core';
import { resolveDesktopTestLaunch, waitForDesktopLauncher } from './desktop-test-startup.mjs';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';

const root = path.resolve(import.meta.dirname, '..');
const directory = path.join(root, 'tmp/genai-provider-binding-smoke');
await mkdir(directory, { recursive: true });
const output = await mkdtemp(path.join(directory, 'run-'));
const report = { passed: false, pageErrors: [], observations: [], limitations: [
  'Provider status/connect/disconnect/catalog use local host IPC fixtures, never OAuth or paid generation.',
  'Actual packaged panel/menu and canonical document/history are exercised; delayed service retirement remains focused-test proof.'
] };
let app, page;
try {
  const launch = await resolveDesktopTestLaunch(root, { requirePackaged: true });
  report.executablePath = launch.executablePath;
  const environment = { ...process.env }; delete environment.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ executablePath: launch.executablePath, args: launch.args, cwd: root,
    env: { ...environment, LIGHTTABLE_AUTOMATION_USER_DATA: path.join(output, 'profile') } });
  page = await app.firstWindow(); page.on('pageerror', error => report.pageErrors.push(error.stack || error.message || String(error)));
  await waitForDesktopLauncher({ app, page, outputDirectory: output, sourceFile: null,
    pageErrors: report.pageErrors, label: 'genai-provider-binding' });
  await app.evaluate(({ ipcMain }) => {
    const state = globalThis.__providerBindingFixture = { status: 'disconnected', connect: 0, disconnect: 0, submit: 0, reject: false };
    const snapshot = () => ({ id: 'openart', label: 'OpenArt fixture', status: state.status });
    const replace = (name, handler) => { ipcMain.removeHandler(name); ipcMain.handle(name, handler); };
    replace('lighttable:genai-provider-snapshots', () => [snapshot()]);
    replace('lighttable:genai-provider-connect', () => {
      state.connect++; if (state.reject) throw new Error('Provider fixture connection rejected');
      state.status = 'connected'; return snapshot();
    });
    replace('lighttable:genai-provider-disconnect', () => { state.disconnect++; state.status = 'disconnected'; return snapshot(); });
    replace('lighttable:genai-model-list', () => []);
    replace('lighttable:genai-generation-submit', () => { state.submit++; throw new Error('Generation blocked by test'); });
  });
  await page.reload();
  const driver = await attachLightTableAutomation(page, 'genai-provider-binding');
  const created = await driver.executeWorkspace('document.create', { name: 'Provider boundary', width: 320, height: 240,
    resolutionPpi: 72, bitDepth: 8, profile: 'srgb', background: { kind: 'solid', color: '#c04020' } });
  const id = created.value?.documentId; assert.ok(id); await driver.waitForReadyDocument(id, 60000);
  const before = await driver.queryDocument(id);
  await page.getByRole('radio', { name: 'Switch to Gen AI workspace' }).click();
  const panel = page.getByRole('complementary', { name: 'Generative AI' });
  const connect = panel.getByRole('button', { name: 'Connect', exact: true });
  await connect.click(); await connect.waitFor({ state: 'detached' });
  const providerMenu = async () => {
    await page.getByRole('menuitem', { name: 'AI', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Providers', exact: true }).hover();
    await page.getByRole('menuitem', { name: /OpenArt/ }).click();
  };
  await providerMenu(); await connect.waitFor({ state: 'visible' });
  await providerMenu(); await connect.waitFor({ state: 'detached' });
  await providerMenu(); await connect.waitFor({ state: 'visible' });
  report.observations.push('Panel connect and AI menu disconnect/connect/disconnect synchronize the same provider presentation.');
  if (process.argv.includes('--reject')) {
    await app.evaluate(() => { globalThis.__providerBindingFixture.reject = true; });
    await connect.click();
    await panel.getByRole('alert').filter({ hasText: 'Provider fixture connection rejected' }).waitFor({ timeout: 5000 });
    assert.equal(await connect.isEnabled(), true);
    report.observations.push('Rejected connect is visible in provider panel, remains retryable, and produces no unhandled page error.');
    await app.evaluate(() => { globalThis.__providerBindingFixture.reject = false; });
    await connect.click(); await connect.waitFor({ state: 'detached' });
    await providerMenu(); await connect.waitFor({ state: 'visible' });
    assert.equal(await panel.getByRole('alert').count(), 0);
    report.observations.push('Explicit retry succeeds and disconnect clears the previous failure.');
  }
  const after = await driver.queryDocument(id);
  assert.deepEqual(after, before);
  report.calls = await app.evaluate(() => globalThis.__providerBindingFixture);
  assert.equal(report.calls.connect, process.argv.includes('--reject') ? 4 : 2);
  assert.equal(report.calls.disconnect, process.argv.includes('--reject') ? 3 : 2); assert.equal(report.calls.submit, 0);
  assert.deepEqual(report.pageErrors, []);
  report.passed = true;
  await page.screenshot({ path: path.join(output, 'final.png') });
  console.log(`GenAI provider binding passed: ${output}`);
} catch (error) {
  report.error = error.stack ?? String(error);
  if (page) { await page.screenshot({ path: path.join(output, 'failure.png') }); report.body = await page.locator('body').innerText(); }
  throw error;
} finally {
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  if (app) await app.close();
}
