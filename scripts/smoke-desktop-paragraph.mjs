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
const packagedApplication = /LightTable\.exe$/i.test(executablePath);
const requestedSizeBeforeCreate = Number.parseFloat(argument('size-before-create', ''));
const sizeBeforeCreate = Number.isFinite(requestedSizeBeforeCreate)
  ? requestedSizeBeforeCreate
  : null;
const maximumTypingMs = Number.parseFloat(argument('max-typing-ms', '10000'));
const immediateTextOverlay = argument('immediate-text-overlay', 'true') !== 'false';
const textInputTrace = argument('text-input-trace', 'true') !== 'false';
const caretSettleMs = Number.parseFloat(argument('caret-settle-ms', '1000'));
const userDataPath = path.join(workspaceRoot, 'tmp', `playwright-paragraph-user-data-${process.pid}`);
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
  sizeBeforeCreate,
  maximumTypingMs,
  immediateTextOverlay,
  textInputTrace,
  caretSettleMs,
  typingMs: null,
  finalText: '',
  status: '',
  layers: [],
  cacheStats: null,
  typingPipeline: null,
  caretNavigation: null,
  caretPipeline: null,
  dragSelection: null,
  doubleClickSelection: null,
  keyboardWordSelection: null,
  immediateEditKeys: null,
  fontSearch: null,
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
    args: packagedApplication ? [] : [desktopAppPath],
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

  // Point and paragraph text intentionally share the Type tool: clicking
  // creates point text, while this drag gesture creates the paragraph frame.
  await window.keyboard.press('t');
  await window.getByRole('button', { name: 'Type tool (T)', exact: true })
    .waitFor({ state: 'visible' });
  if (sizeBeforeCreate !== null) {
    await window.locator('[aria-label="Text settings"]')
      .getByLabel('Size').fill(String(sizeBeforeCreate));
  }

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
  await input.evaluate((enabled) => {
    globalThis.__LIGHTTABLE_TEXT_INPUT_TRACE__ = enabled;
    performance.clearMeasures('LightTable text input');
    performance.clearMeasures('LightTable text document sync');
  }, textInputTrace);
  await input.press('Control+A');
  const typingStartedAt = performance.now();
  for (const [index, paragraph] of authoredText.split('\n').entries()) {
    if (index > 0) await input.press('Enter');
    await input.pressSequentially(paragraph);
  }
  await window.waitForFunction((expected) => {
    const bridge = document.querySelector('.lighttable-text-input-bridge');
    return bridge instanceof HTMLTextAreaElement && bridge.value === expected;
  }, authoredText, { timeout: 30_000 });
  diagnostics.typingMs = performance.now() - typingStartedAt;
  await window.locator('.lighttable-layer__text-status', { hasText: 'Flow' })
    .waitFor({ state: 'visible', timeout: 30_000 });

  await input.press('Control+End');
  await input.pressSequentially(editedSuffix);
  diagnostics.finalText = `${authoredText}${editedSuffix}`;
  await window.waitForFunction((expected) => {
    const bridge = document.querySelector('.lighttable-text-input-bridge');
    return bridge instanceof HTMLTextAreaElement && bridge.value === expected;
  }, diagnostics.finalText, { timeout: 30_000 });

  // Delete and Enter must update the semantic input in the same gesture, not
  // hitch a pending edit onto the next key or pointer event.
  await input.press('Backspace');
  const afterDelete = diagnostics.finalText.slice(0, -1);
  await window.waitForFunction((expected) => document
    .querySelector('.lighttable-text-input-bridge')?.value === expected,
  afterDelete, { timeout: 1_000 });
  await input.pressSequentially(diagnostics.finalText.at(-1));
  await input.press('Enter');
  await window.waitForFunction((expected) => document
    .querySelector('.lighttable-text-input-bridge')?.value === expected,
  `${diagnostics.finalText}\n`, { timeout: 1_000 });
  await input.press('Backspace');
  await window.waitForFunction((expected) => document
    .querySelector('.lighttable-text-input-bridge')?.value === expected,
  diagnostics.finalText, { timeout: 1_000 });
  diagnostics.immediateEditKeys = { delete: true, enter: true };

  const fontTrigger = window.locator('.lighttable-font-picker__trigger');
  await fontTrigger.click();
  const fontSearch = window.getByRole('searchbox', { name: 'Search fonts' });
  await fontSearch.fill('Source Serif');
  const matchingFonts = await window.locator('.lighttable-font-picker__option').allTextContents();
  if (!matchingFonts.length || matchingFonts.some((family) => !/source serif/i.test(family))) {
    throw new Error(`Font search returned unexpected options: ${matchingFonts.join(', ')}`);
  }
  diagnostics.fontSearch = { query: 'Source Serif', matches: matchingFonts };
  await fontSearch.press('Escape');
  await input.focus();

  // Measure the user-visible bridge update, not Playwright command latency.
  // Each sample dispatches one real React keyboard event and waits until the
  // controlled native selection reflects the new editing-controller state.
  // Keep typing/re-layout out of the caret-only sample.
  await window.waitForTimeout(caretSettleMs);
  diagnostics.typingPipeline = await input.evaluate(() => {
    const grouped = new Map();
    for (const entry of performance.getEntriesByName('LightTable text input')) {
      if (!entry.detail?.id || !entry.detail?.stage) continue;
      const sample = grouped.get(entry.detail.id) ?? {};
      sample[entry.detail.stage] ??= entry.detail.elapsedMs;
      grouped.set(entry.detail.id, sample);
    }
    globalThis.__LIGHTTABLE_TEXT_INPUT_TRACE__ = false;
    const samples = [...grouped.values()].filter((sample) => sample['queue-submit'] !== undefined);
    const summarize = (stage) => {
      const values = samples.flatMap((sample) => (
        sample[stage] === undefined ? [] : [sample[stage]]
      )).sort((left, right) => left - right);
      const at = (fraction) => values[Math.min(
        values.length - 1, Math.max(0, Math.ceil(values.length * fraction) - 1)
      )] ?? 0;
      return { sampleCount: values.length, medianMs: at(0.5), p95Ms: at(0.95), maxMs: at(1) };
    };
    const documentSync = {};
    for (const entry of performance.getEntriesByName('LightTable text document sync')) {
      const stage = entry.detail?.stage;
      if (!stage) continue;
      (documentSync[stage] ??= []).push(entry.duration);
    }
    const summarizeDurations = (values = []) => {
      values.sort((left, right) => left - right);
      const at = (fraction) => values[Math.min(
        values.length - 1, Math.max(0, Math.ceil(values.length * fraction) - 1)
      )] ?? 0;
      return { sampleCount: values.length, medianMs: at(0.5), p95Ms: at(0.95), maxMs: at(1) };
    };
    return {
      sampleCount: samples.length,
      sourceSync: summarize('source-sync'),
      scheduleEnter: summarize('schedule-enter'),
      keyReady: summarize('key-ready'),
      previousAborted: summarize('previous-aborted'),
      urgentDispatch: summarize('urgent-dispatch'),
      deferredDispatch: summarize('deferred-dispatch'),
      runtimeReady: summarize('runtime-ready'),
      sessionReady: summarize('session-ready'),
      shapeStart: summarize('shape-start'),
      shapeComplete: summarize('shape-complete'),
      sourcePublished: summarize('source-published'),
      queueSubmit: summarize('queue-submit'),
      gpuComplete: summarize('gpu-complete'),
      documentSync: Object.fromEntries(Object.entries(documentSync)
        .map(([stage, values]) => [stage, summarizeDurations(values)])),
      samples
    };
  });
  await input.press('Control+Home');
  await window.waitForFunction(() => {
    const bridge = document.querySelector('.lighttable-text-input-bridge');
    return bridge instanceof HTMLTextAreaElement && bridge.selectionStart === 0;
  }, undefined, { timeout: 1_000 });
  await input.evaluate((bridge, immediateOverlay) => {
    const samples = [];
    globalThis.__lightTableCaretSamples = samples;
    globalThis.__LIGHTTABLE_TEXT_INTERACTION_TRACE__ = true;
    globalThis.__LIGHTTABLE_TEXT_IMMEDIATE_OVERLAY__ = immediateOverlay;
    performance.clearMeasures('LightTable text interaction');
    bridge.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowRight') return;
      const before = bridge.selectionStart;
      const startedAt = performance.now();
      const inspect = () => {
        if (bridge.selectionStart > before) samples.push(performance.now() - startedAt);
        else requestAnimationFrame(inspect);
      };
      requestAnimationFrame(inspect);
    }, { capture: true });
  }, immediateTextOverlay);
  const caretSampleCount = Math.min(10, diagnostics.finalText.length);
  for (let index = 0; index < caretSampleCount; index += 1) {
    await input.press('ArrowRight');
    await window.waitForFunction((expected) => performance
      .getEntriesByName('LightTable text interaction')
      .filter((entry) => entry.detail?.stage === 'gpu-complete').length >= expected,
    index + 1, { timeout: 2_000 });
  }
  diagnostics.caretNavigation = await input.evaluate(() => {
    const samples = globalThis.__lightTableCaretSamples ?? [];
    const ordered = [...samples].sort((left, right) => left - right);
    const percentile = (fraction) => ordered[Math.min(
      ordered.length - 1,
      Math.max(0, Math.ceil(ordered.length * fraction) - 1)
    )] ?? 0;
    return {
      samples,
      medianMs: percentile(0.5),
      p95Ms: percentile(0.95),
      maxMs: percentile(1)
    };
  });
  diagnostics.caretPipeline = await input.evaluate(() => {
    const grouped = new Map();
    for (const entry of performance.getEntriesByName('LightTable text interaction')) {
      if (!entry.detail?.id || !entry.detail?.stage) continue;
      const sample = grouped.get(entry.detail.id) ?? {};
      sample[entry.detail.stage] = entry.detail.elapsedMs;
      sample[`${entry.detail.stage}StageMs`] = entry.detail.stageMs;
      grouped.set(entry.detail.id, sample);
    }
    globalThis.__LIGHTTABLE_TEXT_INTERACTION_TRACE__ = false;
    const samples = [...grouped.values()].filter((sample) => sample['gpu-complete'] !== undefined);
    const summarize = (stage) => {
      const values = samples.map((sample) => sample[stage]).sort((left, right) => left - right);
      const at = (fraction) => values[Math.min(
        values.length - 1, Math.max(0, Math.ceil(values.length * fraction) - 1)
      )] ?? 0;
      return { medianMs: at(0.5), p95Ms: at(0.95), maxMs: at(1) };
    };
    return {
      sampleCount: samples.length,
      controller: summarize('controller'),
      overlayBuild: summarize('overlay-build'),
      overlaySet: summarize('overlay-set'),
      renderStart: summarize('render-start'),
      queueSubmit: summarize('queue-submit'),
      gpuComplete: summarize('gpu-complete'),
      samples
    };
  });

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

  // Stay left of the deliberately floating Layers panel and hit the first word.
  const wordPoint = { x: start.x + 90 * scale, y: start.y + 28 * scale };
  await window.mouse.dblclick(wordPoint.x, wordPoint.y, { delay: 45 });
  await window.waitForFunction(() => {
    const bridge = document.querySelector('.lighttable-text-input-bridge');
    return bridge instanceof HTMLTextAreaElement
      && bridge.selectionEnd > bridge.selectionStart;
  }, undefined, { timeout: 2_000 });
  diagnostics.doubleClickSelection = await input.evaluate((bridge) => ({
    start: bridge.selectionStart,
    end: bridge.selectionEnd,
    text: bridge.value.slice(bridge.selectionStart, bridge.selectionEnd)
  }));

  await input.press('Control+Home');
  await input.press('Control+Shift+ArrowRight');
  diagnostics.keyboardWordSelection = await input.evaluate((bridge) => ({
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
    return /Layout cache:.*?[1-9]\d* hits/i.test(text);
  }, undefined, { timeout: 30_000 });
  diagnostics.debugPanel = await debugPanel.textContent() ?? '';
  const layoutCache = diagnostics.debugPanel.match(
    /Layout cache:.*?(\d+) hits\s*\/\s*(\d+) misses/i
  );
  const textInput = diagnostics.debugPanel.match(
    /Text input:.*?submit p95 ([\d.]+) ms.*?GPU p95 ([\d.]+) ms/i
  );
  diagnostics.cacheStats = {
    layoutHits: Number(layoutCache?.[1] ?? 0),
    layoutMisses: Number(layoutCache?.[2] ?? 0),
    submitP95Ms: Number(textInput?.[1] ?? 0),
    gpuP95Ms: Number(textInput?.[2] ?? 0)
  };
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
  if (!diagnostics.cacheStats || diagnostics.cacheStats.layoutHits < 1) {
    throw new Error('No layout-cache reuse was observed while editing paragraph text.');
  }
  if (diagnostics.layers.filter(({ statuses }) => statuses.includes('Flow')).length !== 1) {
    throw new Error('Expected exactly one editable Flow paragraph layer.');
  }
  if (!diagnostics.dragSelection || diagnostics.dragSelection.start === diagnostics.dragSelection.end) {
    throw new Error('Viewport mouse drag did not produce a text selection.');
  }
  if (!diagnostics.doubleClickSelection
    || !diagnostics.doubleClickSelection.text
    || /\s/.test(diagnostics.doubleClickSelection.text)) {
    throw new Error('Viewport double-click did not select one word.');
  }
  if (diagnostics.keyboardWordSelection?.text !== 'Paragraph') {
    throw new Error('Ctrl+Shift+ArrowRight did not select the next complete word.');
  }
  if (diagnostics.typingMs === null || diagnostics.typingMs > maximumTypingMs) {
    throw new Error(
      `Paragraph typing took ${diagnostics.typingMs ?? 'an unknown duration'} ms; maximum is ${maximumTypingMs} ms.`
    );
  }
  if (diagnostics.pageErrors.length > 0) {
    throw new Error(`Paragraph smoke reported page errors: ${diagnostics.pageErrors.join('\n')}`);
  }
  if (/unavailable|failed|error/i.test(diagnostics.status)) throw new Error(diagnostics.status);
} catch (error) {
  failure = error;
  diagnostics.bridgeTextOnFailure = window && !window.isClosed()
    ? await window.locator('.lighttable-text-input-bridge').inputValue().catch(() => null)
    : null;
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
