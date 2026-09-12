import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import process from 'node:process';
import { _electron as electron } from 'playwright-core';
import { PDFDocument } from 'pdf-lib';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';
import { resolveDesktopTestLaunch, waitForDesktopLauncher } from './desktop-test-startup.mjs';

const root = path.resolve(import.meta.dirname, '..');
const outputRoot = path.join(root, 'tmp', 'pdf-preflight-smoke');
await mkdir(outputRoot, { recursive: true });
// Each run preserves its own outputs and failures, including stale-artifact evidence.
const output = await mkdtemp(path.join(outputRoot, 'run-'));
const userData = await mkdtemp(path.join(output, 'profile-'));
const appRequire = createRequire(path.join(root, 'packages', 'lighttable-app', 'package.json'));
const pdfJsPath = appRequire.resolve('pdfjs-dist/legacy/build/pdf.mjs');
const pdfJsAssets = path.resolve(path.dirname(pdfJsPath), '..', '..');
const pdfjs = await import(pathToFileURL(pdfJsPath).href);
const textProof = 'PDF TEXT PROOF';
const environment = { ...process.env }; delete environment.ELECTRON_RUN_AS_NODE;
const pageErrors = []; const observations = []; let scopeProof = null; let launch; let app; let page;
const evidenceScope = 'Real packaged menu/preflight/four exports; independent PDF page, text and vector operators; canonical/history invariance; current stale-plan rejection. Forced async retirement remains unit-test evidence, not a timing claim from this run.';

const inspectPdf = async (file, kind) => {
  const bytes = await readFile(file);
  assert.ok(bytes.length > 8 && bytes.subarray(0, 5).toString() === '%PDF-', 'Output must be an actual PDF');
  const structural = await PDFDocument.load(bytes);
  assert.equal(structural.getPageCount(), 1);
  const pageSize = structural.getPage(0).getSize();
  assert.ok(Math.abs(pageSize.width - 320 * 72 / 300) < 0.01);
  assert.ok(Math.abs(pageSize.height - 240 * 72 / 300) < 0.01);
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: false,
    standardFontDataUrl: `${path.join(pdfJsAssets, 'standard_fonts')}/`,
    cMapUrl: `${path.join(pdfJsAssets, 'cmaps')}/`, cMapPacked: true });
  try {
    const document = await task.promise; assert.equal(document.numPages, 1);
    const pdfPage = await document.getPage(1);
    const text = (await pdfPage.getTextContent()).items.map(item => 'str' in item ? item.str : '').join(' ').replace(/\s+/g, ' ').trim();
    const operators = await pdfPage.getOperatorList();
    const counts = {};
    for (const fn of operators.fnArray) counts[fn] = (counts[fn] ?? 0) + 1;
    const pathCount = counts[pdfjs.OPS.constructPath] ?? 0;
    const imageCount = [pdfjs.OPS.paintImageXObject, pdfjs.OPS.paintInlineImageXObject,
      pdfjs.OPS.paintImageMaskXObject].reduce((sum, op) => sum + (counts[op] ?? 0), 0);
    assert.ok(imageCount > 0, `${kind} must retain the raster underlay`);
    if (kind === 'text' || kind === 'mixed') assert.ok(text.includes(textProof), `Searchable text missing: ${JSON.stringify(text)}`);
    else assert.equal(text, '', `${kind} fixture has no native text`);
    if (kind === 'vector' || kind === 'mixed') assert.ok(pathCount > 0, `${kind} must contain native path operations`);
    return { file, byteLength: bytes.length, pageSize, text, pathCount, imageCount, operatorCount: operators.fnArray.length };
  } finally { await task.destroy(); }
};

try {
  launch = await resolveDesktopTestLaunch(root, { requirePackaged: true });
  app = await electron.launch({ executablePath: launch.executablePath, args: launch.args, cwd: root,
    env: { ...environment, LIGHTTABLE_AUTOMATION_USER_DATA: userData }, timeout: 30_000 });
  page = await app.firstWindow({ timeout: 30_000 });
  page.on('pageerror', error => pageErrors.push(error.stack ?? error.message));
  await waitForDesktopLauncher({ app, page, outputDirectory: output, sourceFile: null,
    pageErrors, label: 'pdf-preflight' });
  const driver = await attachLightTableAutomation(page, 'pdf-preflight');
  const createFixture = async kind => {
    const created = await driver.executeWorkspace('document.create', {
      name: `PDF preflight ${kind}`, width: 320, height: 240, resolutionPpi: 300,
      bitDepth: 8, profile: 'srgb', background: { kind: 'solid', color: '#4d80b3' }
    });
    const id = created.value?.documentId; assert.ok(id);
    await driver.waitForReadyDocument(id, 60_000);
    const layers = [];
    if (kind === 'text' || kind === 'mixed') {
      const text = await driver.execute(id, 'text.create', {
        mode: 'paragraph', name: 'Searchable PDF text', text: textProof,
        origin: { x: 20, y: 45 }, frame: { width: 280, height: 90 }, writingMode: 'horizontal-tb',
        style: { font: { family: 'Inter', style: 'Regular' }, fontSize: 24,
          fill: { enabled: true, color: '#ff0088' } },
        paragraph: { alignment: 'start', direction: 'auto', leading: { value: 30 } }
      });
      assert.ok(text.value?.layerId); layers.push(text.value.layerId);
    }
    if (kind === 'vector' || kind === 'mixed') {
      const vector = await driver.execute(id, 'vector.create', {
        name: 'Native PDF rectangle',
        primitive: { kind: 'rectangle', x: 60, y: 160, width: 160, height: 50, cornerRadii: [0, 0, 0, 0] },
        style: { fill: { type: 'solid', color: [0.15, 0.9, 0.2, 1] } }
      });
      assert.ok(vector.value?.layerId); layers.push(vector.value.layerId);
    }
    return { id, layers };
  };
  const openPreflight = async () => {
    await page.getByRole('menuitem', { name: 'File', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Export', exact: true }).hover();
    await page.getByRole('menuitem', { name: 'PDF...', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'PDF export preflight' });
    await dialog.waitFor({ state: 'visible', timeout: 60_000 });
    await dialog.getByText(/exactly one PDF page/i).waitFor();
    return dialog;
  };
  const setOutput = file => app.evaluate((_electron, filePath) => {
    process.env.LIGHTTABLE_AUTOMATION_SAVE_FILE = filePath;
  }, file);
  const closePreflight = async dialog => {
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
  };
  const signature = state => ({ canonicalRevision: state.canonicalRevision,
    history: state.history, layerCount: state.layerCount, canvas: state.canvas });
  const variants = [
    { kind: 'raster', button: /Export flattened PDF/i, status: /Flattened PDF ready/i },
    { kind: 'text', button: /Export native text PDF/i, status: /Native PDF ready/i },
    { kind: 'vector', button: /Export native vectors PDF/i, status: /Native vector PDF ready/i },
    { kind: 'mixed', button: /Export native text \+ vectors PDF/i, status: /Native mixed PDF ready/i }
  ];
  for (const variant of variants) {
    const fixture = await createFixture(variant.kind);
    const before = await driver.queryDocument(fixture.id);
    const dialog = await openPreflight();
    if (variant.kind === 'text' || variant.kind === 'mixed') {
      await dialog.getByRole('button', { name: 'Validate font resources', exact: true }).click();
      await dialog.getByRole('status').filter({ hasText: /font resources? ready/i }).waitFor({ timeout: 60_000 });
    }
    const file = path.join(output, `${variant.kind}.pdf`); await setOutput(file);
    const started = performance.now();
    await dialog.getByRole('button', { name: variant.button }).click();
    await dialog.getByRole('status').filter({ hasText: variant.status }).waitFor({ timeout: 60_000 });
    assert.ok((await stat(file)).size > 8);
    const pdf = await inspectPdf(file, variant.kind);
    const after = await driver.queryDocument(fixture.id);
    assert.deepEqual(signature(after), signature(before), `${variant.kind} export must not mutate canonical/history state`);
    observations.push({ kind: variant.kind, fixture, before, after, exportMs: performance.now() - started, pdf });
    await page.screenshot({ path: path.join(output, `${variant.kind}-ready.png`) });
    await closePreflight(dialog);
  }

  // Canonical processing is deliberately outside ImageDocument.revision. This
  // proves freshness uses the session's content invalidation, not only its tree.
  const fixture = await createFixture('vector');
  let dialog = await openPreflight();
  const beforeGrade = await driver.queryDocument(fixture.id);
  const staleFile = path.join(output, 'stale-plan-MUST-NOT-EXIST.pdf'); await setOutput(staleFile);
  await driver.execute(fixture.id, 'grade.setBasic', { target: { kind: 'document' }, values: { exposureEV: 1 } });
  const graded = await driver.queryDocument(fixture.id);
  assert.ok(graded.canonicalRevision > beforeGrade.canonicalRevision);
  await dialog.getByRole('button', { name: /Export flattened PDF/i }).click();
  await dialog.getByText('The document changed after PDF preflight. Open preflight again.', { exact: true })
    .waitFor({ state: 'visible', timeout: 15_000 });
  const staleExists = await stat(staleFile).then(() => true, error => {
    if (error.code === 'ENOENT') return false; throw error;
  });
  assert.equal(staleExists, false, 'Rejected stale preflight must not deliver any PDF');
  assert.deepEqual(signature(await driver.queryDocument(fixture.id)), signature(graded));
  await page.screenshot({ path: path.join(output, 'stale-plan-rejected.png') });
  await closePreflight(dialog);
  dialog = await openPreflight();
  const freshFile = path.join(output, 'fresh-processed.pdf'); await setOutput(freshFile);
  await dialog.getByRole('button', { name: /Export flattened PDF/i }).click();
  await dialog.getByRole('status').filter({ hasText: /Flattened PDF ready/i }).waitFor({ timeout: 60_000 });
  const freshPdf = await inspectPdf(freshFile, 'raster');
  assert.deepEqual(signature(await driver.queryDocument(fixture.id)), signature(graded));
  scopeProof = { documentId: fixture.id, beforeGrade, graded, staleFile, staleExists, freshPdf,
    forcedDelay: false, result: 'canonical processing invalidates old preflight; fresh preflight succeeds' };
  await page.screenshot({ path: path.join(output, 'fresh-processed-ready.png') });
  assert.deepEqual(pageErrors, []);
  await writeFile(path.join(output, 'report.json'), JSON.stringify({ passed: true, launch, observations,
    scopeProof, pageErrors, evidenceScope }, null, 2));
  console.log(JSON.stringify({ passed: true, output, variants: observations.map(item => item.kind), scopeProof: scopeProof.result }, null, 2));
} catch (error) {
  await writeFile(path.join(output, 'report.json'), JSON.stringify({ passed: false, launch, observations,
    scopeProof, pageErrors, evidenceScope, error: error.stack ?? String(error),
    bodyText: page ? await page.locator('body').innerText().catch(reason => `Diagnostic unavailable: ${reason}`) : null }, null, 2));
  if (page) await page.screenshot({ path: path.join(output, 'failure.png') });
  console.error(`PDF preflight evidence preserved in ${output}`); throw error;
} finally { await app?.close(); }
