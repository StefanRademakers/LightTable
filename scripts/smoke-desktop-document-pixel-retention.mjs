import { _electron as electron } from 'playwright-core';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import sharp from 'sharp';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';
import {
  resolveDesktopTestLaunch,
  waitForDesktopLauncher
} from './desktop-test-startup.mjs';

const root = path.resolve(import.meta.dirname, '..');
const firstFile = path.resolve(process.argv[2] ?? path.join(root, 'architecture', 'ui', '1.png'));
const secondFile = path.resolve(process.argv[3] ?? path.join(root, 'icon', 'logo_emblem.png'));
const output = path.join(root, 'tmp', 'document-pixel-retention-smoke');
const reportPath = path.join(output, 'report.json');
await Promise.all([access(firstFile), access(secondFile), mkdir(output, { recursive: true })]);

const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
const launch = await resolveDesktopTestLaunch(root);
const app = await electron.launch({
  executablePath: launch.executablePath,
  args: launch.args,
  cwd: root,
  env: {
    ...environment,
    LIGHTTABLE_AUTOMATION_OPEN_FILE: firstFile,
    LIGHTTABLE_AUTOMATION_USER_DATA: path.join(output, `user-data-${process.pid}`),
    LIGHTTABLE_AUTOMATION_HEADLESS: '1'
  },
  timeout: 30_000
});

const assertRetained = (label, baseline, current) => {
  if (current.alpha === 0 || current.opaque === 0 || current.rgb === 0) {
    throw new Error(`${label} became transparent: ${JSON.stringify({ baseline, current })}`);
  }
  if (current.width !== baseline.width || current.height !== baseline.height
    || current.alpha !== baseline.alpha || current.opaque !== baseline.opaque) {
    throw new Error(`${label} pixel geometry/coverage changed: ${JSON.stringify({ baseline, current })}`);
  }
  const rgbDelta = Math.abs(current.rgb - baseline.rgb) / Math.max(1, baseline.rgb);
  if (rgbDelta > 0.02) {
    throw new Error(`${label} pixel content changed by ${(rgbDelta * 100).toFixed(2)}%: ${JSON.stringify({ baseline, current })}`);
  }
};

const assertSourceEquivalent = (label, baseline, current) => {
  if (current.alpha === 0 || current.opaque === 0 || current.rgb === 0
    || current.width !== baseline.width || current.height !== baseline.height) {
    throw new Error(`${label} source geometry/coverage changed: ${JSON.stringify({ baseline, current })}`);
  }
  const alphaDelta = Math.abs(current.alpha - baseline.alpha) / Math.max(1, baseline.alpha);
  const opaqueDelta = Math.abs(current.opaque - baseline.opaque) / Math.max(1, baseline.opaque);
  const rgbDelta = Math.abs(current.rgb - baseline.rgb) / Math.max(1, baseline.rgb);
  // A close/reopen performs a new browser/native image decode, unlike a tab
  // rebind. Color-profile and resampling implementations may round slightly;
  // source identity still requires near-identical coverage and a tight
  // aggregate color bound.
  if (alphaDelta > 0.001 || opaqueDelta > 0.001 || rgbDelta > 0.05) {
    throw new Error(`${label} source appearance changed: ${JSON.stringify({
      baseline, current, alphaDelta, opaqueDelta, rgbDelta
    })}`);
  }
};

const imageDifferenceRatio = async (first, second) => {
  const [a, b] = await Promise.all([
    sharp(first).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(second).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  ]);
  if (a.info.width !== b.info.width || a.info.height !== b.info.height
    || a.info.channels !== b.info.channels) return Number.POSITIVE_INFINITY;
  let difference = 0;
  for (let index = 0; index < a.data.length; index += 1) {
    difference += Math.abs(a.data[index] - b.data[index]);
  }
  return difference / (a.data.length * 255);
};

const mimeTypeFor = (file) => ({
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.webp': 'image/webp'
}[path.extname(file).toLowerCase()] ?? 'application/octet-stream');

try {
  const page = await app.firstWindow({ timeout: 30_000 });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
  const open = await waitForDesktopLauncher({
    app,
    page,
    outputDirectory: output,
    sourceFile: firstFile,
    pageErrors,
    label: 'document-pixel-retention'
  });
  await open.click();
  await page.locator('.lighttable-toolbar__meta').filter({ hasText: /ready/i })
    .waitFor({ timeout: 60_000 });
  const driver = await attachLightTableAutomation(page, 'document-pixel-retention');
  const firstId = (await driver.queryWorkspace()).activeDocumentId;
  if (!firstId) throw new Error('The first document did not become active.');

  const previewMetrics = async (documentId, format) => {
    const documentState = await driver.queryDocument(documentId);
    const preview = await page.evaluate((request) => window.__lightTableAutomation
      ?.requestDocumentPreview(request), {
      documentId,
      expectedDocumentRevision: documentState.canonicalRevision,
      maxEdge: 512,
      format
    });
    if (preview?.status !== 'completed') {
      throw new Error(`Preview failed: ${JSON.stringify(preview)}`);
    }
    return page.evaluate(async (artifactId) => {
      const file = window.__lightTableAutomation?.resolveArtifact(artifactId);
      if (!file) throw new Error('Preview artifact disappeared.');
      const bitmap = await createImageBitmap(file);
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(bitmap, 0, 0);
      const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
      let alpha = 0;
      let rgb = 0;
      let opaque = 0;
      for (let index = 0; index < pixels.length; index += 4) {
        alpha += pixels[index + 3];
        rgb += pixels[index] + pixels[index + 1] + pixels[index + 2];
        if (pixels[index + 3] > 0) opaque += 1;
      }
      bitmap.close();
      return { width: canvas.width, height: canvas.height, alpha, rgb, opaque };
    }, preview.artifact.id);
  };

  const firstBaseline = await previewMetrics(firstId, 'png');
  const firstLayerIds = (await driver.queryLayers(firstId)).map((layer) => layer.id);
  const secondBytes = await readFile(secondFile);
  const secondArtifact = await driver.registerInputArtifact(
    secondBytes,
    path.basename(secondFile),
    mimeTypeFor(secondFile)
  );
  await driver.executeWorkspace('file.openArtifact', { artifactId: secondArtifact.id });
  const secondId = (await driver.queryWorkspace()).activeDocumentId;
  if (!secondId || secondId === firstId) throw new Error('The second document did not open.');
  await driver.waitForDocument(secondId, 60_000);
  const secondBaseline = await previewMetrics(secondId, 'png');
  const secondLayerIds = (await driver.queryLayers(secondId)).map((layer) => layer.id);

  await page.evaluate(() => {
    const events = [];
    const record = () => {
      const viewport = document.querySelector('.lighttable-viewport');
      const workspace = window.__lightTableAutomation?.queryWorkspace();
      if (!(viewport instanceof HTMLElement) || !workspace?.activeDocumentId) return;
      const next = {
        documentId: workspace.activeDocumentId,
        ready: viewport.dataset.presentationReady === 'true',
        resident: viewport.dataset.presentationResident === 'true',
        busy: viewport.getAttribute('aria-busy'),
        canvasVisibility: getComputedStyle(
          viewport.querySelector('.lighttable-viewport__canvas')
        ).visibility
      };
      const previous = events.at(-1);
      if (!previous || previous.documentId !== next.documentId || previous.ready !== next.ready
        || previous.resident !== next.resident
        || previous.canvasVisibility !== next.canvasVisibility) events.push(next);
    };
    const observer = new MutationObserver(record);
    observer.observe(document.body, {
      subtree: true,
      attributes: true,
      attributeFilter: [
        'aria-selected',
        'aria-busy',
        'class',
        'data-presentation-ready',
        'data-presentation-resident'
      ]
    });
    window.__lightTablePresentationProbe = {
      clear: () => { events.length = 0; },
      read: () => [...events],
      record
    };
    record();
  });

  const assertPresentationTransition = async (
    documentId,
    label,
    pendingCanvasVisibility = 'hidden',
    pendingResident = false
  ) => {
    const events = await page.evaluate(() => window.__lightTablePresentationProbe?.read() ?? []);
    const owned = events.filter((event) => event.documentId === documentId);
    const pending = owned.filter((event) => !event.ready);
    const presented = owned.findLast((event) => event.ready);
    if (pending.length === 0 || pending.some((event) => (
      event.canvasVisibility !== pendingCanvasVisibility
      || event.resident !== pendingResident
      || event.busy !== 'true'
    ))) {
      throw new Error(`${label} exposed a retained frame before presentation: ${JSON.stringify(events)}`);
    }
    if (!presented || !presented.resident
      || presented.canvasVisibility !== 'visible' || presented.busy !== 'false') {
      throw new Error(`${label} did not publish its presented frame: ${JSON.stringify(events)}`);
    }
    return owned;
  };

  // A document-addressed semantic mutation must not use tab activation as its
  // transport. Keep the second document visible while editing the first, then
  // prove canonical state/revision/history changed only on the requested ID.
  const inactiveTargetId = firstLayerIds.at(-1);
  if (!inactiveTargetId) throw new Error('The first document has no editable layer.');
  const inactiveBefore = await driver.queryDocument(firstId);
  await driver.execute(firstId, 'layer.rename', {
    layerId: inactiveTargetId,
    name: 'Inactive document edit'
  });
  const inactiveAfter = await driver.queryDocument(firstId);
  const workspaceAfterInactiveEdit = await driver.queryWorkspace();
  const inactiveLayer = (await driver.queryLayers(firstId))
    .find(({ id }) => id === inactiveTargetId);
  if (workspaceAfterInactiveEdit.activeDocumentId !== secondId) {
    throw new Error('Editing an inactive document changed the visible document.');
  }
  if (inactiveAfter.canonicalRevision !== inactiveBefore.canonicalRevision + 1
    || inactiveAfter.history.undoDepth !== inactiveBefore.history.undoDepth + 1
    || inactiveLayer?.name !== 'Inactive document edit') {
    throw new Error(`Inactive document mutation was not canonical: ${JSON.stringify({
      inactiveBefore, inactiveAfter, inactiveLayer
    })}`);
  }

  const firstTab = page.getByRole('tab', { name: new RegExp(path.basename(firstFile), 'i') });
  const secondTab = page.getByRole('tab', { name: new RegExp(path.basename(secondFile), 'i') });
  const photoWorkspace = page.getByRole('radio', { name: 'Switch to Photo edit workspace' });
  const gradingWorkspace = page.getByRole('radio', { name: 'Switch to Grading workspace' });
  const genAiWorkspace = page.getByRole('radio', { name: 'Switch to Gen AI workspace' });
  const cycles = [];

  for (let cycle = 0; cycle < 5; cycle += 1) {
    await (cycle % 2 === 0 ? genAiWorkspace : gradingWorkspace).click();
    await page.keyboard.press(cycle % 2 === 0 ? 'p' : 'b');
    await photoWorkspace.click();
    await page.evaluate(() => window.__lightTablePresentationProbe?.clear());
    await firstTab.click();
    await page.waitForFunction((id) => window.__lightTableAutomation
      ?.queryWorkspace()?.activeDocumentId === id, firstId);
    await driver.waitForReadyDocument(firstId, 30_000);
    // Retention is a document-state assertion, so compare the same lossless
    // encoding on both sides. WebP validity belongs to the export codec smoke;
    // a lossy encode is not evidence that inactive document pixels changed.
    const firstCurrent = await previewMetrics(firstId, 'png');
    const firstPresentation = await assertPresentationTransition(
      firstId, `First document after cycle ${cycle + 1}`
    );
    assertRetained(`First document after cycle ${cycle + 1}`, firstBaseline, firstCurrent);
    const firstCurrentLayerIds = (await driver.queryLayers(firstId)).map((layer) => layer.id);
    if (JSON.stringify(firstCurrentLayerIds) !== JSON.stringify(firstLayerIds)) {
      throw new Error(`First document layer identity changed: ${JSON.stringify({ firstLayerIds, firstCurrentLayerIds })}`);
    }

    await photoWorkspace.click();
    await page.keyboard.press(cycle % 2 === 0 ? 'm' : 'p');
    await page.evaluate(() => window.__lightTablePresentationProbe?.clear());
    await secondTab.click();
    await page.waitForFunction((id) => window.__lightTableAutomation
      ?.queryWorkspace()?.activeDocumentId === id, secondId);
    await driver.waitForReadyDocument(secondId, 30_000);
    const secondCurrent = await previewMetrics(secondId, 'png');
    const secondPresentation = await assertPresentationTransition(
      secondId, `Second document after cycle ${cycle + 1}`
    );
    assertRetained(`Second document after cycle ${cycle + 1}`, secondBaseline, secondCurrent);
    const secondCurrentLayerIds = (await driver.queryLayers(secondId)).map((layer) => layer.id);
    if (JSON.stringify(secondCurrentLayerIds) !== JSON.stringify(secondLayerIds)) {
      throw new Error(`Second document layer identity changed: ${JSON.stringify({ secondLayerIds, secondCurrentLayerIds })}`);
    }
    cycles.push({
      cycle: cycle + 1,
      first: firstCurrent,
      second: secondCurrent,
      firstPresentation,
      secondPresentation
    });
  }

  // Do not let every switch settle: A -> B -> A used to let an old A waiter
  // clear the newer A pending marker because pending ownership was only an id.
  await page.evaluate(() => window.__lightTablePresentationProbe?.clear());
  await firstTab.click();
  await page.waitForFunction((id) => window.__lightTableAutomation
    ?.queryWorkspace()?.activeDocumentId === id, firstId);
  await secondTab.click();
  await page.waitForFunction((id) => window.__lightTableAutomation
    ?.queryWorkspace()?.activeDocumentId === id, secondId);
  await firstTab.click();
  await page.waitForFunction((id) => window.__lightTableAutomation
    ?.queryWorkspace()?.activeDocumentId === id, firstId);
  await driver.waitForReadyDocument(firstId, 30_000);
  const rapidPresentation = await assertPresentationTransition(
    firstId, 'Rapid A to B to A switch'
  );
  assertRetained('First document after rapid switch', firstBaseline,
    await previewMetrics(firstId, 'png'));

  // Closing disposes the old document session. Reopening the same artifact
  // must still cross the pending gate before a newly owned frame is exposed.
  await secondTab.click();
  await page.waitForFunction((id) => window.__lightTableAutomation
    ?.queryWorkspace()?.activeDocumentId === id, secondId);
  await driver.waitForReadyDocument(secondId, 30_000);
  await page.keyboard.press('Control+W');
  await page.waitForFunction((id) => {
    const workspace = window.__lightTableAutomation?.queryWorkspace();
    return workspace?.activeDocumentId !== id
      && !workspace?.documents.some((document) => document.id === id);
  }, secondId);
  await page.evaluate(() => window.__lightTablePresentationProbe?.clear());
  await driver.executeWorkspace('file.openArtifact', { artifactId: secondArtifact.id });
  const reopenedSecondId = (await driver.queryWorkspace()).activeDocumentId;
  if (!reopenedSecondId || reopenedSecondId === secondId || reopenedSecondId === firstId) {
    throw new Error(`The closed artifact did not reopen as a new session: ${reopenedSecondId}`);
  }
  await driver.waitForDocument(reopenedSecondId, 60_000);
  await driver.waitForReadyDocument(reopenedSecondId, 30_000);
  const reopenPresentation = await assertPresentationTransition(
    reopenedSecondId, 'Closed document reopen'
  );
  assertSourceEquivalent('Reopened second document', secondBaseline,
    await previewMetrics(reopenedSecondId, 'png'));

  // The regular automation window is intentionally never shown. Give it a
  // real foreground transition before exercising native minimize/restore.
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window?.show();
    window?.focus();
  });
  await page.waitForFunction(() => document.hasFocus());
  await driver.resetRenderTelemetry(reopenedSecondId);
  await page.evaluate(() => window.__lightTablePresentationProbe?.clear());
  await app.evaluate(async ({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    if (!window || window.isMinimized()) return;
    await new Promise((resolve) => {
      window.once('minimize', resolve);
      window.minimize();
    });
  });
  await new Promise((resolve) => setTimeout(resolve, 500));
  const minimizedState = await page.evaluate((id) => {
    const documentState = window.__lightTableAutomation?.queryDocument(id);
    const viewport = document.querySelector('.lighttable-viewport');
    return {
      visibility: document.visibilityState,
      rendererActive: documentState?.renderer?.active,
      presentationReady: viewport?.getAttribute('data-presentation-ready'),
      presentationResident: viewport?.getAttribute('data-presentation-resident')
    };
  }, reopenedSecondId);
  if (minimizedState.rendererActive !== false
    || minimizedState.presentationReady !== 'false'
    || minimizedState.presentationResident !== 'false') {
    throw new Error(`Minimize did not suspend presentation: ${JSON.stringify(minimizedState)}`);
  }
  const hiddenTelemetry = await driver.queryRenderTelemetry(reopenedSecondId);
  if ((hiddenTelemetry?.submittedFrames ?? 0) !== 0) {
    throw new Error(`Minimized renderer submitted background frames: ${JSON.stringify(hiddenTelemetry)}`);
  }
  const minimizedPresentation = await page.evaluate(() => ({
    visibility: document.visibilityState,
    ready: document.querySelector('.lighttable-viewport')
      ?.getAttribute('data-presentation-ready'),
    resident: document.querySelector('.lighttable-viewport')
      ?.getAttribute('data-presentation-resident'),
    canvasVisibility: getComputedStyle(
      document.querySelector('.lighttable-viewport__canvas')
    ).visibility,
    loadingMessageVisible: Array.from(document.querySelectorAll('.lighttable-viewport__message'))
      .some((element) => element.textContent?.includes('Loading image and WebGPU pipeline'))
  }));
  if (minimizedPresentation.resident !== 'false'
    || minimizedPresentation.canvasVisibility !== 'hidden'
    || !minimizedPresentation.loadingMessageVisible) {
    throw new Error(`Minimize exposed a non-durable canvas frame: ${JSON.stringify(minimizedPresentation)}`);
  }
  await app.evaluate(async ({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    if (!window) return;
    if (window.isMinimized()) {
      await new Promise((resolve) => {
        window.once('restore', resolve);
        window.restore();
      });
    }
    window?.show();
    await new Promise((resolve) => setTimeout(resolve, 100));
    window?.focus();
    window?.webContents.focus();
  });
  await page.waitForFunction(() => document.hasFocus());
  await page.waitForFunction((id) => window.__lightTableAutomation
    ?.queryDocument(id)?.renderer?.active === true, reopenedSecondId);
  await page.waitForFunction(() => document.querySelector('.lighttable-viewport')
    ?.getAttribute('data-presentation-ready') === 'true');
  const restorePresentation = await assertPresentationTransition(
    reopenedSecondId, 'Minimize and restore'
  );
  const restoredTelemetry = await driver.queryRenderTelemetry(reopenedSecondId);
  if ((restoredTelemetry?.submittedFrames ?? 0) > 3) {
    throw new Error(`Restore replayed a stale render burst: ${JSON.stringify(restoredTelemetry)}`);
  }
  assertSourceEquivalent('Restored second document', secondBaseline,
    await previewMetrics(reopenedSecondId, 'png'));
  const readyCanvasBeforeBlur = await page.locator('.lighttable-viewport__canvas').screenshot();

  // Focus loss is a separate Electron lifecycle signal from minimization.
  // Interrupt a real mutating pointer gesture so foreground loss also proves
  // terminal rollback rather than only idle renderer suspension.
  const beforeInterruptedGesture = await driver.queryDocument(reopenedSecondId);
  await page.keyboard.press('m');
  const viewportBounds = await page.locator('.lighttable-viewport').boundingBox();
  if (!viewportBounds) throw new Error('Viewport disappeared before blur interruption proof.');
  const gestureStart = {
    x: viewportBounds.x + viewportBounds.width * 0.4,
    y: viewportBounds.y + viewportBounds.height * 0.4
  };
  await page.mouse.move(gestureStart.x, gestureStart.y);
  await page.mouse.down();
  await page.mouse.move(gestureStart.x + 90, gestureStart.y + 70, { steps: 4 });
  await driver.resetRenderTelemetry(reopenedSecondId);
  await page.evaluate(() => window.__lightTablePresentationProbe?.clear());
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.blur();
  });
  await page.waitForFunction((id) => window.__lightTableAutomation
    ?.queryDocument(id)?.renderer?.active === false, reopenedSecondId);
  const blurredPresentation = await page.evaluate(() => ({
    ready: document.querySelector('.lighttable-viewport')
      ?.getAttribute('data-presentation-ready'),
    resident: document.querySelector('.lighttable-viewport')
      ?.getAttribute('data-presentation-resident'),
    canvasVisibility: getComputedStyle(
      document.querySelector('.lighttable-viewport__canvas')
    ).visibility,
    loadingMessageVisible: Array.from(document.querySelectorAll('.lighttable-viewport__message'))
      .some((element) => element.textContent?.includes('Loading image and WebGPU pipeline'))
  }));
  if (blurredPresentation.ready !== 'false'
    || blurredPresentation.resident !== 'true'
    || blurredPresentation.canvasVisibility !== 'visible'
    || blurredPresentation.loadingMessageVisible) {
    throw new Error(`Blur hid a retained document frame: ${JSON.stringify(blurredPresentation)}`);
  }
  const blurredCanvas = await page.locator('.lighttable-viewport__canvas').screenshot();
  const blurredCanvasDifference = await imageDifferenceRatio(readyCanvasBeforeBlur, blurredCanvas);
  if (blurredCanvasDifference > 0.03) {
    throw new Error(`Blur changed the visible retained pixels by ${(
      blurredCanvasDifference * 100
    ).toFixed(2)}%.`);
  }
  await page.mouse.up();
  const interruptedGesture = await driver.queryDocument(reopenedSecondId);
  if (interruptedGesture.history.undoDepth !== beforeInterruptedGesture.history.undoDepth) {
    throw new Error(`Foreground loss committed the interrupted gesture: ${JSON.stringify({
      before: beforeInterruptedGesture.history, after: interruptedGesture.history
    })}`);
  }
  const blurredTelemetry = await driver.queryRenderTelemetry(reopenedSecondId);
  if ((blurredTelemetry?.submittedFrames ?? 0) !== 0) {
    throw new Error(`Blurred renderer submitted background frames: ${JSON.stringify(blurredTelemetry)}`);
  }
  await app.evaluate(async ({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window?.show();
    await new Promise((resolve) => setTimeout(resolve, 100));
    window?.focus();
    window?.webContents.focus();
  });
  await page.waitForFunction(() => document.hasFocus());
  await page.waitForFunction((id) => window.__lightTableAutomation
    ?.queryDocument(id)?.renderer?.active === true, reopenedSecondId);
  await page.waitForFunction(() => document.querySelector('.lighttable-viewport')
    ?.getAttribute('data-presentation-ready') === 'true');
  const refocusPresentation = await assertPresentationTransition(
    reopenedSecondId, 'Blur and refocus', 'visible', true
  );
  const refocusedTelemetry = await driver.queryRenderTelemetry(reopenedSecondId);
  if ((refocusedTelemetry?.submittedFrames ?? 0) > 3) {
    throw new Error(`Refocus replayed a stale render burst: ${JSON.stringify(refocusedTelemetry)}`);
  }
  assertSourceEquivalent('Refocused second document', secondBaseline,
    await previewMetrics(reopenedSecondId, 'png'));

  // The cancellation must release pointer ownership: the next gesture commits
  // exactly once, and undo restores the pre-interruption history position.
  await page.mouse.move(gestureStart.x, gestureStart.y);
  await page.mouse.down();
  await page.mouse.move(gestureStart.x + 70, gestureStart.y + 55, { steps: 4 });
  await page.mouse.up();
  await page.waitForFunction(({ id, depth }) => window.__lightTableAutomation
    ?.queryDocument(id)?.history.undoDepth === depth + 1, {
    id: reopenedSecondId,
    depth: beforeInterruptedGesture.history.undoDepth
  });
  await driver.execute(reopenedSecondId, 'history.undo');

  // Switch and minimize immediately, before the newly-bound document's
  // presentation waiter can conservatively complete. A pre-suspend double-rAF
  // must never certify the restored swap-chain frame.
  await page.evaluate(() => window.__lightTablePresentationProbe?.clear());
  await firstTab.click();
  await page.waitForFunction((id) => window.__lightTableAutomation
    ?.queryWorkspace()?.activeDocumentId === id, firstId);
  await app.evaluate(async ({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    if (!window) return;
    await new Promise((resolve) => {
      window.once('minimize', resolve);
      window.minimize();
    });
    await new Promise((resolve) => {
      window.once('restore', resolve);
      window.restore();
    });
    window.show();
    window.focus();
    window.webContents.focus();
  });
  await page.waitForFunction(() => document.hasFocus());
  await page.waitForFunction(() => document.querySelector('.lighttable-viewport')
    ?.getAttribute('data-presentation-ready') === 'true');
  const rapidRestorePresentation = await assertPresentationTransition(
    firstId, 'Rapid minimize and restore during rebind'
  );
  assertRetained('First document after rapid minimize and restore', firstBaseline,
    await previewMetrics(firstId, 'png'));

  if (pageErrors.length > 0) {
    throw new Error(`Renderer errors occurred: ${JSON.stringify(pageErrors)}`);
  }
  const report = {
    launchMode: launch.mode,
    first: { file: firstFile, documentId: firstId, baseline: firstBaseline },
    second: { file: secondFile, documentId: secondId, baseline: secondBaseline },
    inactiveCommand: {
      targetDocumentId: firstId,
      visibleDocumentId: workspaceAfterInactiveEdit.activeDocumentId,
      layerId: inactiveTargetId,
      canonicalRevision: inactiveAfter.canonicalRevision,
      undoDepth: inactiveAfter.history.undoDepth
    },
    cycles,
    rapidPresentation,
    reopen: { previousDocumentId: secondId, reopenedDocumentId: reopenedSecondId,
      presentation: reopenPresentation },
    minimizeRestore: {
      minimizedState,
      minimizedPresentation,
      hiddenTelemetry,
      restorePresentation,
      restoredTelemetry
    },
    blurRefocus: {
      interruptedGestureUndoDepth: interruptedGesture.history.undoDepth,
      blurredCanvasDifference,
      blurredTelemetry,
      refocusPresentation,
      refocusedTelemetry
    },
    rapidMinimizeRestore: { presentation: rapidRestorePresentation },
    pageErrors
  };
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.stdout.write(`Document pixel-retention smoke passed. Report: ${reportPath}\n`);
} finally {
  await app.close();
}
