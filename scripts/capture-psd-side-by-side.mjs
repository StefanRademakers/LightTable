import { _electron as electron } from 'playwright-core';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import sharp from 'sharp';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';

const workspace = path.resolve(import.meta.dirname, '..');
const root = path.resolve(process.argv[2] ?? 'D:\\Mediavibe\\LightTableTests\\PsdCompare');
const manifestPath = path.join(root, 'manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const executable = path.join(workspace, 'node_modules', 'electron', 'dist', 'electron.exe');
await Promise.all([access(executable), ...manifest.cases.flatMap(({ source, photoshop }) =>
  [access(source), access(photoshop)])]);
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;

const normalize = async (file) => sharp(file)
  .flatten({ background: '#d9dde4' })
  .resize(400, 400, { fit: 'contain', background: '#d9dde4' })
  .removeAlpha()
  .png()
  .toBuffer();
const results = [];

for (const [index, entry] of manifest.cases.entries()) {
  const startedAt = performance.now();
  const result = { ...entry, order: ['LightTable', 'Photoshop'] };
  const userData = path.join(root, 'runtime', `${process.pid}-${entry.id}`);
  await mkdir(userData, { recursive: true });
  let app;
  try {
    app = await electron.launch({ executablePath: executable,
      args: [path.join(workspace, 'apps', 'desktop')], cwd: workspace,
      env: { ...environment, LIGHTTABLE_AUTOMATION_OPEN_FILE: entry.source,
        LIGHTTABLE_AUTOMATION_USER_DATA: userData }, timeout: 30_000 });
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setBounds({ x: 20, y: 20, width: 1400, height: 1000 });
    });
    const page = await app.firstWindow({ timeout: 30_000 });
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
    await page.getByRole('button', { name: 'Open file' }).click();
    await page.locator('.lighttable-toolbar__meta').filter({ hasText: /ready/i })
      .waitFor({ state: 'visible', timeout: 120_000 });
    const driver = await attachLightTableAutomation(page, `psd-compare-${entry.id}`);
    const workspaceState = await driver.queryWorkspace();
    const documentId = workspaceState?.activeDocumentId;
    if (!documentId) throw new Error('No active LightTable document.');
    await driver.execute(documentId, 'view.setZoom', { mode: 'fit' });
    await page.addStyleTag({ content: '.dv-floating-overlay-host { display: none !important; }' });
    await page.waitForTimeout(500);
    const documentState = await driver.queryDocument(documentId);
    const viewport = await page.locator('.lighttable-viewport').boundingBox();
    if (!documentState?.canvas || !viewport) throw new Error('Cannot resolve LightTable canvas geometry.');
    // Fit zoom is derived by the editor from the live viewport and is not
    // persisted in DocumentViewport.scale. The toolbar reports the effective
    // render scale, which is the authority for a screenshot crop.
    const metadata = await page.locator('.lighttable-toolbar__meta').textContent() ?? '';
    const zoomMatch = metadata.match(/(\d+(?:\.\d+)?)%/);
    if (!zoomMatch) throw new Error(`Cannot resolve effective fit zoom: ${metadata}`);
    const effectiveScale = Number(zoomMatch[1]) / 100;
    const width = documentState.canvas.width * effectiveScale;
    const height = documentState.canvas.height * effectiveScale;
    const clip = {
      x: Math.round(viewport.x + viewport.width / 2 + documentState.viewport.panX - width / 2),
      y: Math.round(viewport.y + viewport.height / 2 + documentState.viewport.panY - height / 2),
      width: Math.max(1, Math.round(width)),
      height: Math.max(1, Math.round(height))
    };
    await page.screenshot({ path: entry.lightTable, clip });
    const [left, right] = await Promise.all([normalize(entry.lightTable), normalize(entry.photoshop)]);
    await sharp({ create: { width: 800, height: 400, channels: 3, background: '#d9dde4' } })
      .composite([{ input: left, left: 0, top: 0 }, { input: right, left: 400, top: 0 }])
      .png().toFile(entry.output);
    result.pageErrors = pageErrors;
    result.status = pageErrors.length ? 'review' : 'passed';
  } catch (error) {
    result.status = 'failed';
    result.error = error instanceof Error ? error.stack ?? error.message : String(error);
  } finally {
    await app?.close().catch(() => {});
  }
  result.wallMs = performance.now() - startedAt;
  results.push(result);
  process.stdout.write(`[${index + 1}/${manifest.cases.length}] ${entry.id}: ${result.status}\n`);
  await writeFile(path.join(root, 'report.json'), `${JSON.stringify({
    schema: 1,
    generatedAt: new Date().toISOString(),
    layout: { width: 800, height: 400, left: 'LightTable', right: 'Photoshop' },
    results
  }, null, 2)}\n`);
}
const failed = results.filter(({ status }) => status === 'failed');
process.stdout.write(`Created ${results.length - failed.length}/${results.length} comparisons in ${path.join(root, 'compare')}\n`);
if (failed.length) process.exitCode = 1;
