import { _electron as electron } from 'playwright-core';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const workspaceRoot = path.resolve(import.meta.dirname, '..');
const desktopAppPath = path.join(workspaceRoot, 'apps', 'desktop');
const defaultExecutable = path.join(
  workspaceRoot, 'node_modules', 'electron', 'dist', 'electron.exe'
);
const argument = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};
const outputFile = path.resolve(argument(
  'output',
  path.join(workspaceRoot, 'tmp', 'screenshots', 'desktop-paragraph-smoke.png')
));
const reportFile = outputFile.replace(/\.[^.]+$/, '.json');
const executablePath = path.resolve(argument('executable', defaultExecutable));
const userDataPath = path.join(workspaceRoot, 'tmp', 'playwright-paragraph-user-data');
const documentSize = { width: 1000, height: 700 };
const authoredText = [
  'Paragraph one proves wrapping and editable GPU text.',
  'Paragraph two should remain reusable when its sibling changes.',
  'Paragraph three is the deliberately edited fragment.'
].join('\n');
const editedSuffix = ' Updated.';

await access(executablePath);
await Promise.all([
  mkdir(path.dirname(outputFile), { recursive: true }),
  mkdir(userDataPath, { recursive: true })
]);

const diagnostics = {
  outputFile,
  executablePath,
  capturedAt: new Date().toISOString(),
  authoredText,
  finalText: '',
  status: '',
  layers: [],
  paragraphTraces: [],
  dragSelection: null,
  debugPanel: '',
  runtime: null,
  geometry: null,
  console: [],
  pageErrors: []
};
const launchEnvironment = { ...process.env };
delete launchEnvironment.ELECTRON_RUN_AS_NODE;

let electronApp;
let window;
let failure;
try {
  electronApp = await electron.launch({
    executablePath,
    args: [desktopAppPath],
    cwd: workspaceRoot,
    env: {
      ...launchEnvironment,
      LIGHTTABLE_AUTOMATION_USER_DATA: userDataPath
    },
    timeout: 30_000
  });
  window = await electronApp.firstWindow({ timeout: 30_000 });
  window.on('console', (message) => diagnostics.console.push({
    type: message.type(), text: message.text()
  }));
  window.on('pageerror', (error) => diagnostics.pageErrors.push(error.stack ?? error.message));

  await window.getByRole('button', { name: 'New document' }).click();
  const dialog = window.getByRole('heading', { name: 'New document' }).locator('..').locator('..');
  await dialog.getByLabel('Width').fill(String(documentSize.width));
  await dialog.getByLabel('Height').fill(String(documentSize.height));
  await dialog.getByRole('button', { name: 'Create' }).click();
  await window.locator('.lighttable-toolbar__meta').filter({ hasText: /ready/i })
    .waitFor({ state: 'visible', timeout: 30_000 });

  await window.getByRole('button', { name: 'Show text tools' }).click();
  await window.getByRole('toolbar', { name: 'Text tools' })
    .getByRole('button', { name: 'Paragraph text' }).click();

  const viewport = window.locator('.lighttable-viewport');
  const viewportBox = await viewport.boundingBox();
  if (!viewportBox) throw new Error('The document viewport has no measurable bounds.');
  const scale = Math.min(
    viewportBox.width / documentSize.width,
    viewportBox.height / documentSize.height
  ) * 0.94;
  const image = {
    x: viewportBox.x + (viewportBox.width - documentSize.width * scale) / 2,
    y: viewportBox.y + (viewportBox.height - documentSize.height * scale) / 2,
    width: documentSize.width * scale,
    height: documentSize.height * scale
  };
  const start = { x: image.x + image.width * 0.16, y: image.y + image.height * 0.16 };
  const end = { x: image.x + image.width * 0.72, y: image.y + image.height * 0.66 };
  diagnostics.geometry = { viewport: viewportBox, image, start, end };

  await window.mouse.move(start.x, start.y);
  await window.mouse.down();
  await window.mouse.move(end.x, end.y, { steps: 12 });
  await window.mouse.up();

  const input = window.getByRole('textbox', { name: /^Edit / });
  await input.waitFor({ state: 'attached', timeout: 30_000 });
  await input.press('Control+A');
  for (const [index, paragraph] of authoredText.split('\n').entries()) {
    if (index > 0) await input.press('Enter');
    await input.pressSequentially(paragraph);
  }
  await window.waitForFunction((expected) => {
    const bridge = document.querySelector('.lighttable-text-input-bridge');
    return bridge instanceof HTMLTextAreaElement && bridge.value === expected;
  }, authoredText, { timeout: 30_000 });
  await window.locator('.lighttable-layer__text-status', { hasText: 'Flow' })
    .waitFor({ state: 'visible', timeout: 30_000 });

  await input.press('Control+End');
  await input.pressSequentially(editedSuffix);
  diagnostics.finalText = `${authoredText}${editedSuffix}`;
  await window.waitForFunction((expected) => {
    const bridge = document.querySelector('.lighttable-text-input-bridge');
    return bridge instanceof HTMLTextAreaElement && bridge.value === expected;
  }, diagnostics.finalText, { timeout: 30_000 });

  // Exercise the real viewport pointer route. Selection geometry remains in
  // the WebGPU overlay; the hidden input is only the semantic assertion port.
  const dragStart = {
    x: start.x + 40 * scale,
    y: start.y + 100 * scale
  };
  const dragEnd = {
    x: start.x + 400 * scale,
    y: start.y + 100 * scale
  };
  await window.mouse.move(dragStart.x, dragStart.y);
  await window.mouse.down();
  await window.mouse.move(dragEnd.x, dragEnd.y, { steps: 24 });
  await window.mouse.up();
  await window.waitForFunction(() => {
    const bridge = document.querySelector('.lighttable-text-input-bridge');
    return bridge instanceof HTMLTextAreaElement
      && bridge.selectionStart !== bridge.selectionEnd;
  }, undefined, { timeout: 30_000 });
  diagnostics.dragSelection = await input.evaluate((bridge) => ({
    start: bridge.selectionStart,
    end: bridge.selectionEnd,
    text: bridge.value.slice(bridge.selectionStart, bridge.selectionEnd)
  }));

  await window.waitForTimeout(750);
  await window.getByRole('tab', { name: 'Debug', exact: true }).click();
  const debugPanel = window.getByRole('region', { name: 'LightTable debug log' });
  await debugPanel.waitFor({ state: 'visible' });
  await window.waitForFunction(() => {
    const text = document.querySelector('.lighttable-debug-panel')?.textContent ?? '';
    return /paragraphHits=[1-9]\d*.*paragraphShapes=1/.test(text);
  }, undefined, { timeout: 30_000 });
  diagnostics.debugPanel = await debugPanel.textContent() ?? '';
  diagnostics.paragraphTraces = [...diagnostics.debugPanel.matchAll(
    /paragraphHits=(\d+).*?paragraphShapes=(\d+).*?paragraphCache=(\d+)\/(\d+)/g
  )].map((match) => ({
    hits: Number(match[1]),
    shapes: Number(match[2]),
    entries: Number(match[3]),
    bytes: Number(match[4])
  }));
  await window.getByRole('tab', { name: 'Text', exact: true }).click();

  await window.mouse.move(end.x, end.y);
  await window.mouse.down();
  await window.mouse.move(end.x + image.width * 0.12, end.y + image.height * 0.08, { steps: 12 });
  await window.mouse.up();
  await window.waitForTimeout(750);

  diagnostics.status = await window.locator('.lighttable-toolbar__status').textContent() ?? '';
  diagnostics.layers = await window.locator('.lighttable-layer').evaluateAll((rows) => rows.map((row) => ({
    name: row.querySelector('.lighttable-layer__name')?.value ?? '',
    statuses: [...row.querySelectorAll('.lighttable-layer__text-status')]
      .map((status) => status.textContent?.trim() ?? '').filter(Boolean)
  })));
  diagnostics.runtime = await window.evaluate(() => ({
    crossOriginIsolated: globalThis.crossOriginIsolated === true,
    webGpuAvailable: Boolean(navigator.gpu),
    canvasCount: document.querySelectorAll('canvas').length,
    inputFocused: document.activeElement?.classList.contains('lighttable-text-input-bridge') ?? false
  }));
  const finalBridgeValue = await input.inputValue();
  if (finalBridgeValue !== diagnostics.finalText) {
    throw new Error('Paragraph frame resize mutated the authored text.');
  }
  if (!diagnostics.paragraphTraces.some(({ hits, shapes }) => hits >= 2 && shapes === 1)) {
    throw new Error('No incremental paragraph cache trace proved sibling reuse.');
  }
  if (diagnostics.layers.filter(({ statuses }) => statuses.includes('Flow')).length !== 1) {
    throw new Error('Expected exactly one editable Flow paragraph layer.');
  }
  if (!diagnostics.dragSelection || diagnostics.dragSelection.start === diagnostics.dragSelection.end) {
    throw new Error('Viewport mouse drag did not produce a text selection.');
  }
  if (diagnostics.pageErrors.length > 0) {
    throw new Error(`Paragraph smoke reported page errors: ${diagnostics.pageErrors.join('\n')}`);
  }
  if (/unavailable|failed|error/i.test(diagnostics.status)) throw new Error(diagnostics.status);
} catch (error) {
  failure = error;
  diagnostics.failure = error instanceof Error ? (error.stack ?? error.message) : String(error);
} finally {
  if (window && !window.isClosed()) {
    await window.screenshot({ path: outputFile }).catch((error) => {
      diagnostics.screenshotError = String(error);
    });
  }
  await writeFile(reportFile, `${JSON.stringify(diagnostics, null, 2)}\n`);
  await electronApp?.close().catch(() => {});
}

if (failure) throw failure;
console.info(`LightTable paragraph smoke: ${outputFile}`);
console.info(`LightTable paragraph diagnostics: ${reportFile}`);
