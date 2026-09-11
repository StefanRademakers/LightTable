import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { _electron as electron } from 'playwright-core';
import sharp from 'sharp';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';
import { resolveDesktopTestLaunch, waitForDesktopLauncher } from './desktop-test-startup.mjs';

const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, 'tmp', 'font-source-lifecycle');
await mkdir(output, { recursive: true });
const profile = await mkdtemp(path.join(output, 'profile-'));
const launch = await resolveDesktopTestLaunch(root);
const env = { ...process.env, LIGHTTABLE_AUTOMATION_USER_DATA: profile };
delete env.ELECTRON_RUN_AS_NODE;
const report = { status: 'running', startedAt: new Date().toISOString(), pageErrors: [], timings: {} };
const reportPath = path.join(output, 'report.json');
await writeFile(reportPath, JSON.stringify(report, null, 2));
let app;
try {
  app = await electron.launch({ executablePath: launch.executablePath, args: launch.args,
    cwd: root, env, timeout: 30_000 });
  const page = await app.firstWindow();
  page.on('pageerror', error => report.pageErrors.push(error.message));
  await waitForDesktopLauncher({ app, page, outputDirectory: output, sourceFile: null,
    pageErrors: report.pageErrors, label: 'font-source-lifecycle' });
  const driver = await attachLightTableAutomation(page, 'font-source-lifecycle');
  const waitText = async () => {
    let debug = page.getByRole('tab', { name: 'Debug', exact: true });
    if (!await debug.count()) {
      await page.getByRole('menuitem', { name: 'View', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Debug panel', exact: true }).click();
      debug = page.getByRole('tab', { name: 'Debug', exact: true });
    }
    await debug.click();
    await page.waitForFunction(() => {
      const text = document.querySelector('.lighttable-debug-panel')?.textContent ?? '';
      return /Text source:.*1 ready layer/.test(text) && /0 rebuilding/.test(text);
    });
  };
  const create = async name => {
    const result = await driver.executeWorkspace('document.create', {
      name, width: 480, height: 320, resolutionPpi: 72, bitDepth: 8,
      profile: 'srgb', background: { kind: 'solid', color: '#ffffff' }
    });
    const id = result.value?.documentId; assert.ok(id, JSON.stringify(result));
    await driver.waitForRenderedDocument(id); return id;
  };
  const pixels = async id => {
    await driver.waitForRenderedDocument(id);
    // Final-output export fixes the text rendering purpose to outlines. Ordinary
    // previews may legitimately use atlas coverage and are not byte-equivalent.
    const exported = await driver.execute(id, 'file.exportPng', {}, { requireCompleted: false });
    const task = await driver.waitForTask(id, exported.taskId);
    assert.ok(task.artifact?.id, JSON.stringify(task));
    const artifact = await driver.readArtifact(task.artifact.id);
    assert.ok(artifact?.bytes?.length, JSON.stringify(artifact));
    return sharp(artifact.bytes).ensureAlpha().raw().toBuffer();
  };
  const a = await create('Font lifecycle A');
  const blank = await pixels(a);
  const created = await driver.execute(a, 'text.create', {
    mode: 'point', text: 'Document fonts', name: 'Retained font text', origin: { x: 30, y: 90 },
    style: { font: { assetId: 'lighttable-inter-latin-regular', family: 'Inter', style: 'Regular' }, fontSize: 36,
      fill: { enabled: true, color: '#dc2050' } }
  });
  assert.ok(created.value?.layerId, JSON.stringify(created));
  // Wait for actual shaped/rasterized content, not just canonical layer creation.
  await page.waitForFunction(id => {
    const text = window.__lightTableAutomation?.queryLayers(id)?.find(layer => layer.type === 'text');
    return text && window.__lightTableAutomation?.queryText(id, text.id)?.editable;
  }, a);
  await waitText();
  const withText = await pixels(a);
  await sharp(withText, { raw: { width: 480, height: 320, channels: 4 } }).png().toFile(path.join(output, 'before.png'));
  report.beforeText = await driver.queryText(a, created.value.layerId);
  report.beforeDebug = await page.locator('.lighttable-debug-panel').innerText();
  assert.notDeepEqual(withText, blank, 'Text must be visible before export.');
  const opening = await driver.queryDocument(a);
  const startExport = performance.now();
  const exported = await driver.execute(a, 'file.exportNative', {}, { requireCompleted: false });
  const task = await driver.waitForTask(a, exported.taskId);
  assert.ok(task.artifact?.id, JSON.stringify(task));
  const native = await driver.readArtifact(task.artifact.id);
  const bytes = Buffer.from(native.bytes);
  assert.equal(bytes.subarray(-12, -4).toString(), 'LTBLDOC1');
  const manifestSize = bytes.readUInt32LE(bytes.length - 4);
  const manifest = JSON.parse(bytes.subarray(bytes.length - 12 - manifestSize, bytes.length - 12));
  report.embeddedFonts = manifest.document.fonts.map(font => {
    assert.ok(font.asset, 'Portable native export must embed its document font.');
    const binary = bytes.subarray(font.asset.offset, font.asset.offset + font.asset.length);
    assert.equal(binary.length, font.byteLength);
    assert.equal(createHash('sha256').update(binary).digest('hex'), font.fingerprintSha256);
    return { assetId: font.assetId, fingerprintSha256: font.fingerprintSha256, byteLength: binary.length };
  });
  assert.ok(report.embeddedFonts.length);
  report.timings.nativeExportMs = performance.now() - startExport;
  const startOpen = performance.now();
  const opened = await driver.executeWorkspace('file.openArtifact', { artifactId: task.artifact.id });
  const reopened = opened.value?.documentId; assert.ok(reopened, JSON.stringify(opened));
  await driver.waitForRenderedDocument(reopened);
  await waitText();
  const layers = await driver.queryLayers(reopened);
  const text = layers.find(layer => layer.name === 'Retained font text'); assert.ok(text);
  assert.equal((await driver.queryText(reopened, text.id)).content.text, 'Document fonts');
  const afterPixels = await pixels(reopened);
  report.afterText = await driver.queryText(reopened, text.id);
  report.afterDebug = await page.locator('.lighttable-debug-panel').innerText();
  await sharp(afterPixels, { raw: { width: 480, height: 320, channels: 4 } }).png().toFile(path.join(output, 'after.png'));
  assert.deepEqual(report.afterText.content, report.beforeText.content);
  assert.deepEqual(report.afterText.styleRuns, report.beforeText.styleRuns);
  assert.deepEqual(report.afterText.paragraphRuns, report.beforeText.paragraphRuns);
  assert.deepEqual(report.afterText.layout, report.beforeText.layout);
  assert.deepEqual(report.afterText.transform, report.beforeText.transform);
  assert.notDeepEqual(afterPixels, blank, 'Reopened text must actually render.');
  assert.deepEqual(afterPixels, withText, 'Final-output PNG pixels must survive native font roundtrip exactly.');
  report.nativeFinalOutputByteExact = true;
  report.previewNote = 'Initial ordinary preview comparison differed in outline/atlas edge coverage. Final-output PNG forces the same render purpose; preview-mode parity remains separate.';
  report.timings.nativeOpenMs = performance.now() - startOpen;
  const b = await create('Font lifecycle B');
  const switches = [];
  for (const id of [a, reopened, b, a, reopened]) {
    const currentWorkspace = await driver.queryWorkspace();
    const index = currentWorkspace.documents.findIndex(document => document.id === id);
    assert.ok(index >= 0);
    // DocumentTabs renders workspace order; native copies may have identical titles.
    const before = performance.now();
    await page.locator('.ui-document-tabs__tab').nth(index).locator('.ui-document-tabs__title').click();
    await driver.waitForRenderedDocument(id);
    switches.push({ id, ms: performance.now() - before });
    if (id !== b) {
      await waitText();
      assert.deepEqual(await pixels(id), id === a ? withText : afterPixels, 'Rebind must retain exact font pixels.');
    }
  }
  assert.equal((await driver.queryDocument(a)).history.undoDepth, opening.history.undoDepth);
  assert.equal((await driver.queryDocument(a)).canonicalRevision, opening.canonicalRevision);
  assert.deepEqual(report.pageErrors, []);
  await page.screenshot({ path: path.join(output, 'final.png') });
  Object.assign(report, { status: 'passed', switches, source: a, reopened });
} catch (error) {
  Object.assign(report, { status: 'failed', failure: error.stack ?? String(error) });
  throw error;
} finally {
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  await app?.close();
}
console.log(`Font/source lifecycle passed: ${reportPath}`);
