import { _electron as electron } from 'playwright-core';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const workspaceRoot = path.resolve(import.meta.dirname, '..');
const executablePath = path.join(workspaceRoot, 'node_modules', 'electron', 'dist', 'electron.exe');
const outputDirectory = path.join(workspaceRoot, 'tmp', 'system-font-smoke');
const userDataPath = path.join(outputDirectory, `user-data-${process.pid}`);
const reportPath = path.join(outputDirectory, 'system-fonts.json');
await Promise.all([access(executablePath), mkdir(userDataPath, { recursive: true })]);
const launchEnvironment = { ...process.env };
delete launchEnvironment.ELECTRON_RUN_AS_NODE;
const startedAt = performance.now();
const app = await electron.launch({
  executablePath,
  args: [path.join(workspaceRoot, 'apps', 'desktop')],
  cwd: workspaceRoot,
  env: {
    ...launchEnvironment,
    LIGHTTABLE_AUTOMATION_USER_DATA: userDataPath
  },
  timeout: 30_000
});

try {
  const page = await app.firstWindow({ timeout: 30_000 });
  const firstWindowMs = performance.now() - startedAt;
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
  const report = await page.evaluate(async () => {
    const bridge = window.lightTableDesktop;
    const before = performance.now();
    const fonts = await bridge.listSystemFonts();
    const catalogMs = performance.now() - before;
    const candidate = fonts.find((font) => font.outline === 'truetype' && !font.embedding.bitmapOnly)
      ?? fonts[0];
    if (!candidate) throw new Error('Windows system-font discovery returned no faces.');
    const metadataContainsBytes = fonts.some((font) => Object.values(font)
      .some((value) => value instanceof Uint8Array || value instanceof ArrayBuffer));
    const bytes = await bridge.loadSystemFont(candidate.assetId);
    if (!bytes) throw new Error(`System font ${candidate.assetId} could not be loaded lazily.`);
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes)))]
      .map((value) => value.toString(16).padStart(2, '0')).join('');
    return {
      faceCount: fonts.length,
      catalogMs,
      metadataContainsBytes,
      selected: {
        assetId: candidate.assetId,
        family: candidate.familyNames[0],
        style: candidate.styleName,
        faceIndex: candidate.faceIndex,
        byteLength: candidate.byteLength,
        variableAxes: candidate.variableAxes ?? [],
        embedding: candidate.embedding
      },
      loadedByteLength: bytes.byteLength,
      fingerprintMatches: digest === candidate.fingerprintSha256
    };
  });
  await page.getByRole('button', { name: 'New document' }).click();
  const dialog = page.getByRole('heading', { name: 'New document' }).locator('..').locator('..');
  await dialog.getByLabel('Width').fill('900');
  await dialog.getByLabel('Height').fill('500');
  await dialog.getByRole('button', { name: 'Create' }).click();
  await page.locator('.lighttable-toolbar__meta').filter({ hasText: /ready/i })
    .waitFor({ state: 'visible', timeout: 30_000 });
  await page.keyboard.press('t');
  await page.getByRole('button', { name: 'Type tool (T)', exact: true })
    .waitFor({ state: 'visible' });
  const fontPicker = page.locator('.lighttable-tool-options__font-field .lighttable-font-picker__trigger');
  await fontPicker.click();
  await page.getByRole('searchbox', { name: 'Search fonts' }).fill(report.selected.family);
  const fontOption = page.getByRole('option').filter({ hasText: report.selected.family }).first();
  await fontOption.waitFor({ state: 'visible', timeout: 30_000 });
  await fontOption.click();
  const viewport = page.locator('.lighttable-viewport');
  const viewportBox = await viewport.boundingBox();
  if (!viewportBox) throw new Error('The system-font smoke viewport has no bounds.');
  await page.mouse.click(viewportBox.x + viewportBox.width * 0.76, viewportBox.y + viewportBox.height * 0.28);
  const textInput = page.getByRole('textbox', { name: /^Edit / });
  await textInput.waitFor({ state: 'attached', timeout: 30_000 });
  if (await page.getByRole('dialog', { name: 'Create text' }).count()) {
    throw new Error('System-font authoring opened the legacy text creation dialog.');
  }
  await textInput.pressSequentially('System font via WASM and WebGPU');
  await page.locator('.lighttable-layer__text-status', { hasText: 'Flow' })
    .waitFor({ state: 'visible', timeout: 30_000 });
  await page.waitForTimeout(1_000);
  report.authoredText = await textInput.inputValue();
  report.selectedFamilyInUi = await fontPicker.getAttribute('title');
  report.canvasCount = await page.locator('canvas').count();
  await page.screenshot({ path: path.join(outputDirectory, 'system-font-authoring.png') });
  if (
    report.faceCount < 1
    || report.metadataContainsBytes
    || !report.fingerprintMatches
    || report.loadedByteLength !== report.selected.byteLength
    || !report.authoredText.startsWith('System font via WASM')
    || !report.selectedFamilyInUi?.startsWith(report.selected.family)
    || report.canvasCount < 1
    || pageErrors.length
  ) throw new Error(`System-font smoke failed: ${JSON.stringify({ report, pageErrors })}`);
  await writeFile(reportPath, `${JSON.stringify({ firstWindowMs, ...report, pageErrors }, null, 2)}\n`);
  process.stdout.write(`System-font smoke passed (${report.faceCount} faces; first window ${firstWindowMs.toFixed(1)} ms). Report: ${reportPath}\n`);
} finally {
  await app.close().catch(() => {});
}
