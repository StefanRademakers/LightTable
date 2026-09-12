import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { build, loadConfigFromFile } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium } from 'playwright-core';

const root = path.resolve(import.meta.dirname, '..');
const directory = path.join(root, 'tmp', 'overlay-open-host'); await mkdir(directory, { recursive: true });
const output = await mkdtemp(path.join(directory, 'run-'));
const loaded = await loadConfigFromFile({ command: 'serve', mode: 'test' }, path.join(root, 'apps/desktop/vite.renderer.config.ts'));
const report = { passed: false, pageErrors: [], consoleErrors: [], missingFiles: [], source: 'current source public Overlay API; not packaged image rendering' };
const baseline = process.argv.includes('--baseline');
if (baseline) report.source = 'a112f79d Overlay and three text-owner modules; unchanged remaining dependencies';
const baselineFiles = ['LightTableEditorOverlay.tsx', 'composition/text/usePositionedTextRecovery.ts',
  'composition/text/useTextPropertyCommands.ts', 'application/text/TextPropertyCommandController.ts']
  .map(file => 'packages/lighttable-app/src/lighttable/' + file);
let app, page, server;
try {
  const buildDirectory = path.join(output, 'build');
  await build({ configFile: false, root, base: './', publicDir: false,
    resolve: loaded.config.resolve, define: loaded.config.define, worker: loaded.config.worker,
    plugins: [...(baseline ? [{ name: 'verified-baseline-modules', enforce: 'pre', load(id) {
      const relative = path.relative(root, id).replaceAll('\\', '/');
      if (baselineFiles.includes(relative)) return execFileSync('git', ['show', `a112f79d:${relative}`], { cwd: root, encoding: 'utf8' });
    } }] : []), react()], logLevel: 'error', build: { outDir: buildDirectory, emptyOutDir: false,
      rollupOptions: { input: path.join(root, 'scripts/fixtures/overlay-open-host.html') } } });
  server = createServer(async (request, response) => {
    const file = path.resolve(buildDirectory, '.' + decodeURIComponent(new URL(request.url, 'http://localhost').pathname));
    if (!file.startsWith(buildDirectory + path.sep)) { response.writeHead(403); response.end(); return; }
    try {
      const bytes = await readFile(file);
      response.setHeader('Content-Type', { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
        '.wasm': 'application/wasm', '.woff2': 'font/woff2' }[path.extname(file)] ?? 'application/octet-stream');
      response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
      response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp'); response.end(bytes);
    } catch { report.missingFiles.push(request.url); response.writeHead(404); response.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  app = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  page = await app.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', error => report.pageErrors.push(error.stack ?? error.message));
  page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push(message.text()); });
  await page.goto(`http://127.0.0.1:${address.port}/scripts/fixtures/overlay-open-host.html`);
  await page.getByRole('button', { name: 'Open presentation', exact: true }).waitFor({ timeout: 60000 });
  for (let i = 0; i < 3; i++) {
    await page.getByRole('button', { name: 'Open presentation', exact: true }).click();
    await page.getByTestId('host-surface').waitFor({ state: 'visible', timeout: 10000 });
    if (i === 0) await page.screenshot({ path: path.join(output, 'open.png') });
    await page.getByRole('button', { name: 'Close presentation', exact: true }).click();
    await page.getByTestId('host-surface').waitFor({ state: 'detached', timeout: 10000 });
    report.openCloseCycles = i + 1;
  }
  assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.consoleErrors, []);
  report.passed = true; report.openCloseCycles = 3;
  await page.screenshot({ path: path.join(output, 'final.png') });
  console.log(`Public Overlay open/close gate passed: ${output}`);
} catch (error) {
  report.error = error.stack ?? String(error);
  if (page) { await page.screenshot({ path: path.join(output, 'failure.png') }); report.body = await page.locator('body').innerText(); }
  throw error;
} finally {
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  if (app) await app.close(); if (server) await new Promise(resolve => server.close(resolve));
}
