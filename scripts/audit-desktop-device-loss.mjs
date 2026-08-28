import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { _electron as electron } from 'playwright-core';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';
import { resolveDesktopTestLaunch, waitForDesktopLauncher } from './desktop-test-startup.mjs';

const root = path.resolve(import.meta.dirname, '..');
const argument = (name, fallback = null) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};
const sourceFile = path.resolve(argument('file') ?? '');
const expectation = argument('expect', 'automatic');
const output = path.resolve(argument('output', path.join(root, 'tmp', 'device-loss-audit')));
assert.ok(sourceFile, 'Usage: audit-desktop-device-loss.mjs --file <path> [--output <path>]');
assert.ok(['automatic', 'checkpoint-required'].includes(expectation),
  '--expect must be automatic or checkpoint-required.');
await Promise.all([access(sourceFile), mkdir(output, { recursive: true })]);

const launch = await resolveDesktopTestLaunch(root, { requirePackaged: true });
const profile = await mkdtemp(path.join(output, 'profile-'));
const report = { generatedAt: new Date().toISOString(), sourceFile,
  executablePath: launch.executablePath, pageErrors: [], consoleErrors: [] };
const environment = { ...process.env, LIGHTTABLE_AUTOMATION_USER_DATA: profile,
  LIGHTTABLE_AUTOMATION_OPEN_FILE: sourceFile };
delete environment.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: launch.executablePath, args: launch.args,
  cwd: root, env: environment, timeout: 30_000 });

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const preview = async (driver, documentId, revision) => {
  const requested = await driver.requestDocumentPreview(documentId, revision, 1024);
  const artifactId = requested?.artifact?.id ?? requested?.id;
  const artifact = artifactId ? await driver.readArtifact(artifactId) : null;
  assert.ok(artifact?.bytes?.length, 'Document preview bytes are unavailable.');
  return artifact.bytes;
};

try {
  const page = await app.firstWindow({ timeout: 30_000 });
  page.on('pageerror', error => report.pageErrors.push(error.stack ?? error.message));
  page.on('console', message => {
    if (message.type() === 'error') report.consoleErrors.push(message.text());
  });
  const open = await waitForDesktopLauncher({ app, page, outputDirectory: output,
    sourceFile, pageErrors: report.pageErrors, label: 'device-loss', timeout: 30_000 });
  await open.click();
  const driver = await attachLightTableAutomation(page, 'device-loss', 30_000);
  await page.waitForFunction(() => Boolean(
    window.__lightTableAutomation?.queryWorkspace()?.activeDocumentId
  ), undefined, { timeout: 60_000 });
  const documentId = (await driver.queryWorkspace()).activeDocumentId;
  const before = await driver.waitForRenderedDocument(documentId, 120_000);
  const beforeLayers = await driver.waitForLayers(documentId);
  const beforePreview = await preview(
    driver, documentId, before.document.canonicalRevision
  );

  assert.equal(await driver.forceDeviceLossForAutomation(documentId), true,
    'The packaged renderer refused the automation-only device-loss request.');
  const failedHandle = await page.waitForFunction((id) => {
    const renderer = window.__lightTableAutomation?.queryDocument(id)?.renderer;
    return renderer?.status === 'failed' ? { error: renderer.error } : false;
  }, documentId, { timeout: 10_000 });
  const failedState = await failedHandle.jsonValue();
  report.documentId = documentId;
  report.before = before.document;
  report.failed = { status: 'failed', error: failedState?.error ?? null };
  report.beforePreviewSha256 = hash(beforePreview);
  assert.match(report.failed?.error ?? '', /^WebGPU device lost:/u);
  if (expectation === 'checkpoint-required') {
    await page.waitForTimeout(500);
    const held = await driver.queryDocument(documentId);
    const heldLayers = await driver.waitForLayers(documentId);
    report.held = held;
    report.layersStable = JSON.stringify(beforeLayers) === JSON.stringify(heldLayers);
    report.revisionStable = before.document.canonicalRevision === held.canonicalRevision;
    await writeFile(path.join(output, 'before.png'), beforePreview);
    assert.equal(held.renderer.status, 'failed',
      'A raster document was presented as recovered without rehydrating its pixels.');
    assert.equal(report.layersStable, true, 'Canonical layers changed while recovery was held.');
    assert.equal(report.revisionStable, true,
      'Canonical document revision changed while raster recovery was held.');
  } else {
    // The failed snapshot is intentionally observable before the React
    // recovery generation starts. Do not ask the automation client for a
    // rendered frame while that terminal snapshot is still current: its
    // fail-fast behavior would turn the designed 50 ms recovery handoff into
    // a false negative.
    await page.waitForFunction((id) => {
      const status = window.__lightTableAutomation?.queryDocument(id)?.renderer?.status;
      return status === 'starting' || status === 'ready';
    }, documentId, { timeout: 10_000 });
    const recovered = await driver.waitForRenderedDocument(documentId, 120_000);
    const afterLayers = await driver.waitForLayers(documentId);
    const afterPreview = await preview(
      driver, documentId, recovered.document.canonicalRevision
    );
    report.recovered = recovered.document;
    report.telemetry = recovered.telemetry;
    report.afterPreviewSha256 = hash(afterPreview);
    report.layersStable = JSON.stringify(beforeLayers) === JSON.stringify(afterLayers);
    report.revisionStable = before.document.canonicalRevision
      === recovered.document.canonicalRevision;
    report.previewStable = report.beforePreviewSha256 === report.afterPreviewSha256;
    await Promise.all([
      writeFile(path.join(output, 'before.png'), beforePreview),
      writeFile(path.join(output, 'after.png'), afterPreview)
    ]);
    assert.equal(report.layersStable, true, 'Canonical layers changed during GPU recovery.');
    assert.equal(report.revisionStable, true, 'Canonical document revision changed during GPU recovery.');
    assert.equal(report.previewStable, true, 'Recovered pixels differ from the pre-loss preview.');
    assert.equal(report.telemetry?.vectorBackend?.selected, 'hybrid');
    assert.equal(report.telemetry?.vectorBackend?.active, 'vello',
      `Vello did not remain active after recovery: ${report.telemetry?.vectorBackend?.velloFailure ?? 'unknown failure'}`);
    assert.equal(report.telemetry?.vectorBackend?.velloFailure, null);
  }
  assert.equal(report.pageErrors.length, 0, 'Page errors were observed during device recovery.');
  assert.equal(report.consoleErrors.length, 0, 'Console errors were observed during device recovery.');
} catch (error) {
  report.failure = error instanceof Error ? error.stack ?? error.message : String(error);
  throw error;
} finally {
  await writeFile(path.join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
    .catch(() => {});
  await app.close().catch(() => {});
}

process.stdout.write(`Packaged device-loss recovery passed: ${path.join(output, 'report.json')}\n`);
