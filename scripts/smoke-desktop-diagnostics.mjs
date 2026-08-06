import { _electron as electron } from 'playwright-core';
import { access, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const executablePath = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const appPath = path.join(root, 'apps', 'desktop');
const outputDirectory = path.join(root, 'tmp', 'diagnostic-smoke');
const fixtures = [
  { kind: 'png', file: path.join(root, 'packages', 'lighttable-app', 'src', 'assets', 'icons', 'area_closed.png') },
  { kind: 'psd', file: 'D:\\TextTest.psd' },
  { kind: 'pdf', file: 'D:\\FormulierPersoneel.pdf' }
];

await mkdir(outputDirectory, { recursive: true });
await Promise.all([access(executablePath), ...fixtures.map(({ file }) => access(file))]);
const reports = [];

for (const fixture of fixtures) {
  const output = path.join(outputDirectory, `${fixture.kind}-diagnostics.json`);
  const userData = await mkdtemp(path.join(os.tmpdir(), `lighttable-diagnostics-${fixture.kind}-`));
  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  let app;
  try {
    app = await electron.launch({
      executablePath,
      args: [appPath],
      cwd: root,
      env: {
        ...environment,
        LIGHTTABLE_AUTOMATION_OPEN_FILE: fixture.file,
        LIGHTTABLE_AUTOMATION_SAVE_FILE: output,
        LIGHTTABLE_AUTOMATION_USER_DATA: userData
      },
      timeout: 30_000
    });
    const window = await app.firstWindow({ timeout: 30_000 });
    const pageErrors = [];
    window.on('pageerror', (error) => pageErrors.push(error.message));
    await window.getByRole('button', { name: 'Open file' }).click();
    await window.getByRole('tab', { name: new RegExp(path.basename(fixture.file).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') })
      .waitFor({ state: 'visible', timeout: 45_000 });
    await window.locator('.lighttable-toolbar__meta').filter({ hasText: /ready/i })
      .waitFor({ state: 'visible', timeout: 45_000 });
    await window.getByRole('tab', { name: 'Debug' }).click();
    await window.getByRole('button', { name: 'Preview' }).click();
    const preview = window.locator('.lighttable-debug-panel__preview');
    await preview.waitFor({ state: 'visible', timeout: 10_000 });
    const previewJson = await preview.textContent();
    const previewBundle = JSON.parse(previewJson ?? '{}');
    await window.screenshot({ path: path.join(outputDirectory, `${fixture.kind}-diagnostics.png`) });
    await window.getByRole('button', { name: 'Export bundle' }).click();
    await window.getByText('Diagnostic bundle exported.').waitFor({ state: 'visible', timeout: 10_000 });
    const savedBundle = JSON.parse(await readFile(output, 'utf8'));
    if (savedBundle.document?.value?.type !== previewBundle.document?.value?.type) {
      throw new Error(`${fixture.kind}: preview and exported document type differ.`);
    }
    if (savedBundle.privacy?.uploaded !== false || savedBundle.privacy?.documentContentIncluded !== false) {
      throw new Error(`${fixture.kind}: privacy metadata is invalid.`);
    }
    if (savedBundle.collection?.rendererRecompositions !== 0 || savedBundle.collection?.gpuReadbacks !== 0) {
      throw new Error(`${fixture.kind}: collection reported renderer work.`);
    }
    if (JSON.stringify(savedBundle).includes(path.basename(fixture.file))) {
      throw new Error(`${fixture.kind}: opted-out filename leaked into the bundle.`);
    }
    if (pageErrors.length) throw new Error(`${fixture.kind}: ${pageErrors.join('; ')}`);
    const summary = await window.locator('.lighttable-debug-panel__diagnostics').first().locator('summary').textContent();
    const collectionMs = Number(summary?.match(/\(([\d.]+) ms\)/)?.[1] ?? Number.NaN);
    if (!Number.isFinite(collectionMs) || collectionMs > 25) {
      throw new Error(`${fixture.kind}: collection cost ${collectionMs} ms exceeds the 25 ms interaction budget.`);
    }
    reports.push({ kind: fixture.kind, mediaType: savedBundle.document.value.type, collectionMs });
  } finally {
    await app?.close().catch(() => {});
    await rm(userData, { recursive: true, force: true }).catch(() => {});
  }
}

console.log(JSON.stringify({ passed: true, reports }, null, 2));
