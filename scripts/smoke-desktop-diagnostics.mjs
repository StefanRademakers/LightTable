import { _electron as electron } from 'playwright-core';
import { access, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { resolveDesktopTestLaunch, waitForDesktopLauncher } from './desktop-test-startup.mjs';

const root = path.resolve(import.meta.dirname, '..');
const launch = await resolveDesktopTestLaunch(root);
const outputDirectory = path.join(root, 'tmp', 'diagnostic-smoke');
const fixtures = [
  { kind: 'png', file: path.join(root, 'packages', 'lighttable-app', 'src', 'assets', 'icons', 'area_closed.png') },
  { kind: 'psd', file: 'D:\\TextTest.psd' },
  { kind: 'pdf', file: 'D:\\FormulierPersoneel.pdf' }
];

await mkdir(outputDirectory, { recursive: true });
await Promise.all(fixtures.map(({ file }) => access(file)));
const reports = [];

for (const fixture of fixtures) {
  const output = path.join(outputDirectory, `${fixture.kind}-diagnostics.json`);
  const userData = await mkdtemp(path.join(os.tmpdir(), `lighttable-diagnostics-${fixture.kind}-`));
  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  let app;
  try {
    app = await electron.launch({
      executablePath: launch.executablePath,
      args: launch.args,
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
    const openFileButton = await waitForDesktopLauncher({
      app, page: window, outputDirectory, sourceFile: fixture.file,
      pageErrors, label: `diagnostics-${fixture.kind}`
    });
    await openFileButton.click();
    await window.getByRole('tab', { name: new RegExp(path.basename(fixture.file).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') })
      .waitFor({ state: 'visible', timeout: 45_000 });
    await window.locator('.lighttable-toolbar__meta').filter({ hasText: /ready/i })
      .waitFor({ state: 'visible', timeout: 45_000 });
    await window.getByRole('tab', { name: 'Debug' }).click();
    const betaToggle = window.getByLabel('Record privacy-safe beta events locally');
    if (await betaToggle.isChecked()) throw new Error(`${fixture.kind}: beta diagnostics were not opt-in.`);
    await betaToggle.check();
    await window.getByRole('button', { name: 'Preview' }).click();
    const preview = window.locator('.lighttable-debug-panel__preview');
    await preview.waitFor({ state: 'visible', timeout: 10_000 });
    const previewJson = await preview.textContent();
    const previewBundle = JSON.parse(previewJson ?? '{}');
    if (previewBundle.betaDiagnostics?.status !== 'available'
      || previewBundle.betaDiagnostics?.value?.localOnly !== true) {
      throw new Error(`${fixture.kind}: opted-in local beta diagnostics were not inspectable.`);
    }
    await betaToggle.uncheck();
    const retainedBetaKeys = await window.evaluate(() => Object.keys(localStorage)
      .filter((key) => key.startsWith('lighttable.beta-diagnostics.')));
    if (retainedBetaKeys.length) throw new Error(`${fixture.kind}: revocation retained beta event storage.`);
    await window.getByRole('button', { name: 'Preview' }).click();
    const revokedBundle = JSON.parse(await preview.textContent() ?? '{}');
    if (revokedBundle.betaDiagnostics?.status !== 'unavailable') {
      throw new Error(`${fixture.kind}: revoked beta diagnostics remained in the bundle.`);
    }
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
