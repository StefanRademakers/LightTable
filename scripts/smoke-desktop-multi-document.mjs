import { _electron as electron } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import sharp from 'sharp';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';
import { packagedDesktopExecutable } from './desktop-test-startup.mjs';

const root = path.resolve(import.meta.dirname, '..');
const outputDirectory = path.join(root, 'tmp', 'multi-document-smoke');
const userData = path.join(outputDirectory, `user-data-${process.pid}`);
const recentUserData = path.join(outputDirectory, `recent-user-data-${process.pid}`);
const imageFile = path.join(outputDirectory, 'image.png');
const videoFile = path.join(outputDirectory, 'video.mp4');
const droppedVideoFile = path.join(outputDirectory, 'dropped.webm');
const reportFile = path.join(outputDirectory, 'report.json');
const executablePath = path.resolve(
  process.env.LIGHTTABLE_TEST_EXECUTABLE
    ?? packagedDesktopExecutable(root)
);
const ffmpeg = process.env.LIGHTTABLE_FFMPEG ?? 'ffmpeg';
const MAX_WARM_DOCUMENT_SWITCH_MS = 100;

await mkdir(userData, { recursive: true });
await mkdir(recentUserData, { recursive: true });
await sharp({
  create: { width: 96, height: 64, channels: 4, background: '#3264c8ff' }
}).png().toFile(imageFile);
execFileSync(ffmpeg, [
  '-hide_banner', '-loglevel', 'error', '-y',
  '-f', 'lavfi', '-i', 'color=c=0x9b42f5:s=320x180:d=1',
  '-pix_fmt', 'yuv420p', '-movflags', '+faststart', videoFile
]);
execFileSync(ffmpeg, [
  '-hide_banner', '-loglevel', 'error', '-y',
  '-f', 'lavfi', '-i', 'color=c=0x42b883:s=240x160:d=1',
  '-c:v', 'libvpx-vp9', '-b:v', '120k', droppedVideoFile
]);

await writeFile(path.join(recentUserData, 'recent-files.json'), JSON.stringify([{
  id: 'cold-start-video', path: videoFile, openedAt: Date.now()
}], null, 2));

const recentEnvironment = {
  ...process.env,
  LIGHTTABLE_AUTOMATION_USER_DATA: recentUserData
};
delete recentEnvironment.ELECTRON_RUN_AS_NODE;
const recentApp = await electron.launch({
  executablePath,
  cwd: root,
  env: recentEnvironment,
  timeout: 30_000
});
try {
  const recentPage = await recentApp.firstWindow({ timeout: 30_000 });
  const recentFailures = [];
  recentPage.on('pageerror', (error) => recentFailures.push(error.stack ?? error.message));
  recentPage.on('crash', () => recentFailures.push('Renderer process crashed.'));
  await recentPage.getByRole('button', { name: 'Recent Files', exact: true }).click();
  await recentPage.getByRole('button', { name: 'video.mp4', exact: true }).click();
  await recentPage.locator('video.lighttable-video-document__media')
    .waitFor({ state: 'visible', timeout: 30_000 });
  await recentPage.waitForTimeout(500);
  if (await recentPage.getByText('This document runtime stopped unexpectedly.').count() > 0
    || recentFailures.some((failure) => failure.includes('font registry'))) {
    throw new Error(`Cold recent-video startup failed: ${recentFailures.join('\n')}`);
  }
} finally {
  await recentApp.close().catch(() => undefined);
}

const environment = {
  ...process.env,
  LIGHTTABLE_AUTOMATION_USER_DATA: userData
};
delete environment.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath,
  args: [imageFile, videoFile],
  cwd: root,
  env: environment,
  timeout: 30_000
});

try {
  const page = await app.firstWindow({ timeout: 30_000 });
  const failures = [];
  page.on('pageerror', (error) => failures.push(error.stack ?? error.message));
  page.on('crash', () => failures.push('Renderer process crashed.'));
  page.on('console', (message) => {
    if (message.type() === 'error') failures.push(`[console:error] ${message.text()}`);
  });
  const driver = await attachLightTableAutomation(page, 'multi-document-smoke');
  const cdp = await page.context().newCDPSession(page);
  const collectLifecycleMetrics = async (label) => {
    await cdp.send('HeapProfiler.collectGarbage').catch(() => undefined);
    await page.waitForTimeout(50);
    const [heap, dom, projection] = await Promise.all([
      cdp.send('Runtime.getHeapUsage'),
      cdp.send('Memory.getDOMCounters'),
      page.evaluate(() => ({
        canvasCount: document.querySelectorAll('canvas').length,
        videoCount: document.querySelectorAll('video').length,
        blobMediaSourceCount: document.querySelectorAll('img[src^="blob:"], video[src^="blob:"]').length,
        imageSurfaceCount: document.querySelectorAll('.lighttable-document-surface-stack__image').length,
        videoSurfaceCount: document.querySelectorAll('.lighttable-video-document').length
      }))
    ]);
    return {
      label,
      heapUsedBytes: heap.usedSize,
      domDocuments: dom.documents,
      domNodes: dom.nodes,
      eventListeners: dom.jsEventListeners,
      ...projection
    };
  };
  const assertImagePixelsVisible = async (label) => {
    const canvas = page.locator('canvas.lighttable-viewport__canvas').first();
    await canvas.waitFor({ state: 'visible', timeout: 30_000 });
    const startedAt = performance.now();
    let lastSample = null;
    while (performance.now() - startedAt < 30_000) {
      const screenshot = await canvas.screenshot();
      const { data, info } = await sharp(screenshot).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const center = (Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) * info.channels;
      const [red, green, blue, alpha] = data.subarray(center, center + 4);
      lastSample = { red, green, blue, alpha };
      if (alpha >= 200 && blue >= red + 30 && blue >= green + 20) {
        return performance.now() - startedAt;
      }
      await page.waitForTimeout(50);
    }
    const screenshot = await canvas.screenshot();
    const failurePath = path.join(outputDirectory, `${label.replaceAll(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`);
    await writeFile(failurePath, screenshot);
    throw new Error(`${label} did not present the blue image pixels: ${JSON.stringify(lastSample)}`);
  };
  const activateDocumentTab = async (title) => {
    const tab = page.getByRole('button', { name: title, exact: true });
    await tab.waitFor({ state: 'attached', timeout: 30_000 });
    // Activate through the tab's normal click handler without requiring a
    // pointer hit. Floating user panels may legitimately overlap the tab strip;
    // that must not make this document-lifecycle smoke nondeterministic.
    await tab.evaluate((element) => element.click());
  };
  const activateImageDocumentTab = async () => {
    const tab = page.getByRole('button', { name: 'image.png', exact: true });
    await tab.waitFor({ state: 'attached', timeout: 30_000 });
    return tab.evaluate((element) => new Promise((resolve, reject) => {
      const startedAt = performance.now();
      element.click();
      const inspectFrame = () => {
        const imageSurface = document.querySelector('.lighttable-document-surface-stack__image');
        const elapsed = performance.now() - startedAt;
        if (imageSurface instanceof HTMLElement
          && !imageSurface.classList.contains('lighttable-document-surface-stack__image--inactive')
          && imageSurface.getBoundingClientRect().width > 0) {
          // Include one complete presentation frame after React exposed the
          // already-retained image surface.
          requestAnimationFrame(() => resolve(performance.now() - startedAt));
          return;
        }
        if (elapsed >= 5_000) {
          reject(new Error('Image surface was not presented within 5 seconds.'));
          return;
        }
        requestAnimationFrame(inspectFrame);
      };
      requestAnimationFrame(inspectFrame);
    }));
  };
  const canonicalDocumentSnapshot = async (documentId) => {
    const document = await driver.queryDocument(documentId);
    const layers = await driver.queryLayers(documentId);
    return {
      canonicalRevision: document?.canonicalRevision ?? null,
      savedRevision: document?.savedRevision ?? null,
      dirty: document?.dirty ?? null,
      canvas: document?.canvas ?? null,
      color: document?.color ?? null,
      activeLayerId: document?.activeLayerId ?? null,
      layerCount: document?.layerCount ?? null,
      history: document?.history ?? null,
      layers: layers?.map(({ id, parentId, kind, name, visible, opacity, blendMode }) => ({
        id, parentId, kind, name, visible, opacity, blendMode
      })) ?? null
    };
  };
  const video = page.locator('video.lighttable-video-document__media');
  await video.waitFor({ state: 'visible', timeout: 30_000 });
  const layout = await page.evaluate(() => {
    const rail = document.querySelector('[aria-label="Video tools"]');
    const toolOptions = document.querySelector('.lighttable-tool-options');
    const host = document.querySelector('.lighttable-document-host');
    const media = document.querySelector('video.lighttable-video-document__media');
    const rect = (element) => {
      const bounds = element?.getBoundingClientRect();
      return bounds ? {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height
      } : null;
    };
    return {
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      rail: rect(rail),
      toolOptions: rect(toolOptions),
      host: rect(host),
      media: rect(media)
    };
  });
  if (!layout.rail || layout.rail.width < 24 || layout.rail.width > 96) {
    throw new Error(`Video toolbox rail has invalid geometry: ${JSON.stringify(layout.rail)}`);
  }
  if (!layout.toolOptions || layout.toolOptions.height < 20 || layout.toolOptions.height > 80) {
    throw new Error(`Video tool options bar has invalid geometry: ${JSON.stringify(layout.toolOptions)}`);
  }
  if (!layout.host || layout.host.width < layout.viewportWidth * 0.5
    || layout.host.height < layout.viewportHeight * 0.4) {
    throw new Error(`Video document host is compressed: ${JSON.stringify(layout)}`);
  }
  if (!layout.media || layout.media.width < 160 || layout.media.height < 90) {
    throw new Error(`Video media is not usefully visible: ${JSON.stringify(layout.media)}`);
  }
  const initialVideoSource = await video.getAttribute('src');
  if (!initialVideoSource?.startsWith('lighttable-media://local/')) {
    throw new Error(`Desktop video did not use the bounded streaming source: ${initialVideoSource}`);
  }
  await page.waitForFunction(() => {
    const media = document.querySelector('video.lighttable-video-document__media');
    return media instanceof HTMLVideoElement && media.readyState >= HTMLMediaElement.HAVE_METADATA;
  }, undefined, { timeout: 30_000 });

  // Warm the image once before measuring document switching. The command-line
  // fixture opens with the final video active, so its first image activation is
  // a cold document open rather than a video-to-existing-image switch.
  const coldImageActivationMs = await activateImageDocumentTab();
  const coldImageOpenMs = await assertImagePixelsVisible('Cold image open');
  const warmedImageWorkspace = await driver.queryWorkspace();
  const imageDocumentId = warmedImageWorkspace.activeDocumentId;
  if (!imageDocumentId) throw new Error('Cold image activation did not expose an active document.');
  const imageCanonicalBeforeSwitch = await canonicalDocumentSnapshot(imageDocumentId);
  await activateDocumentTab('video.mp4');
  await video.waitFor({ state: 'visible', timeout: 30_000 });
  await page.waitForFunction(() => {
    const media = document.querySelector('video.lighttable-video-document__media');
    return media instanceof HTMLVideoElement && media.readyState >= HTMLMediaElement.HAVE_METADATA;
  }, undefined, { timeout: 30_000 });

  const videoControls = page.getByRole('region', { name: 'Video controls', exact: true });
  await videoControls.waitFor({ state: 'visible', timeout: 5_000 });
  const playButton = videoControls.getByRole('button', { name: 'Play', exact: true });
  await playButton.click();
  await page.waitForFunction(() => {
    const media = document.querySelector('video.lighttable-video-document__media');
    return media instanceof HTMLVideoElement && !media.paused;
  });
  await videoControls.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.waitForFunction(() => {
    const media = document.querySelector('video.lighttable-video-document__media');
    return media instanceof HTMLVideoElement && media.paused;
  });
  await videoControls.getByRole('slider', { name: 'Video time', exact: true }).fill('0.5');
  await page.waitForFunction(() => {
    const media = document.querySelector('video.lighttable-video-document__media');
    return media instanceof HTMLVideoElement && Math.abs(media.currentTime - 0.5) < 0.1;
  });

  const openViewMenu = async () => {
    await page.getByRole('menuitem', { name: 'View', exact: true }).click();
  };
  await openViewMenu();
  const debugPanelItem = page.getByRole('menuitem', { name: 'Debug panel', exact: true });
  const videoPanelItem = page.getByRole('menuitem', { name: 'Video Controls panel ✓', exact: true });
  if (await debugPanelItem.count() !== 1 || await videoPanelItem.count() !== 1) {
    throw new Error('View menu did not project current per-workspace panel visibility.');
  }
  await debugPanelItem.click();
  const debugRegion = page.getByRole('region', { name: 'Debug', exact: true });
  await debugRegion.waitFor({ state: 'visible', timeout: 5_000 });
  await openViewMenu();
  await page.getByRole('menuitem', { name: 'Debug panel ✓', exact: true }).click();
  await debugRegion.waitFor({ state: 'detached', timeout: 5_000 });
  await openViewMenu();
  await page.getByRole('menuitem', { name: 'Video Controls panel ✓', exact: true }).click();
  await videoControls.waitFor({ state: 'detached', timeout: 5_000 });
  await openViewMenu();
  await page.getByRole('menuitem', { name: 'Video Controls panel', exact: true }).click();
  await videoControls.waitFor({ state: 'visible', timeout: 5_000 });
  await openViewMenu();
  await page.getByRole('menuitem', { name: 'Debug panel', exact: true }).click();
  await debugRegion.waitFor({ state: 'visible', timeout: 5_000 });
  await openViewMenu();
  await page.getByRole('menuitem', { name: 'Workspace', exact: true }).hover();
  await page.getByRole('menuitem', { name: 'Reset workspace layout', exact: true }).click();
  await debugRegion.waitFor({ state: 'detached', timeout: 5_000 });
  await videoControls.waitFor({ state: 'visible', timeout: 5_000 });

  const initial = await driver.queryWorkspace();
  if (initial?.documents?.map(({ kind }) => kind).join(',') !== 'image,video') {
    throw new Error(`Unexpected typed workspace: ${JSON.stringify(initial?.documents)}`);
  }
  const videoToolButtons = page.locator('[aria-label="Video tools"] .lighttable-toolbox__button');
  if (await videoToolButtons.count() !== 2
    || await page.getByRole('button', { name: 'Move canvas (H)', exact: true }).count() !== 1
    || await page.getByRole('button', { name: 'Zoom (Z)', exact: true }).count() !== 1) {
    throw new Error('Video did not project exactly the shared Pan and Zoom tools.');
  }
  if (await page.locator('[aria-label="Video tools"] [aria-label^="Brush"], .lighttable-toolbox__colors').count() !== 0) {
    throw new Error('Image-only toolbar controls remained mounted for the active video document.');
  }
  const videoWorkspaceSwitch = page.getByLabel('Switch to Video workspace');
  try {
    await page.waitForFunction(() => document.querySelector('[aria-label="Switch to Video workspace"]')?.getAttribute('aria-checked') === 'true', undefined, { timeout: 3_000 });
  } catch {
    const workspaceState = await page.locator('[aria-label="Workspaces"] [aria-checked]').evaluateAll((items) => items.map((item) => ({
      label: item.getAttribute('aria-label'),
      checked: item.getAttribute('aria-checked')
    })));
    throw new Error(`Video workspace was not selected automatically: ${JSON.stringify(workspaceState)}`);
  }
  for (const label of ['Image', 'Layer', 'Type', 'Select', 'Filter']) {
    if (await page.getByRole('menuitem', { name: label, exact: true }).isEnabled()) {
      throw new Error(`${label} menu remained enabled for the active video document.`);
    }
  }
  await page.getByRole('button', { name: 'Zoom (Z)', exact: true }).click();
  await page.getByRole('button', { name: '150%', exact: true }).click();
  await page.waitForFunction(() => {
    const media = document.querySelector('video.lighttable-video-document__media');
    return media instanceof HTMLVideoElement
      && Math.abs(media.getBoundingClientRect().width - 480) < 2;
  });
  const videoSurface = page.locator('.lighttable-video-document');
  const surfaceBounds = await videoSurface.boundingBox();
  const regionSourceBounds = await video.boundingBox();
  if (!surfaceBounds || !regionSourceBounds) throw new Error('Video region zoom has no interaction bounds.');
  const regionStart = {
    x: regionSourceBounds.x + regionSourceBounds.width * 0.1,
    y: regionSourceBounds.y + regionSourceBounds.height * 0.1
  };
  const regionEnd = {
    x: regionSourceBounds.x + regionSourceBounds.width * 0.5,
    y: regionSourceBounds.y + regionSourceBounds.height * 0.5
  };
  const selectedDocumentCenter = {
    x: ((regionStart.x + regionEnd.x) / 2 - regionSourceBounds.x) / 1.5,
    y: ((regionStart.y + regionEnd.y) / 2 - regionSourceBounds.y) / 1.5
  };
  await page.mouse.move(regionStart.x, regionStart.y);
  await page.mouse.down();
  await page.mouse.move(regionEnd.x, regionEnd.y, { steps: 4 });
  await page.mouse.up();
  const regionTargetBounds = await video.boundingBox();
  if (!regionTargetBounds) throw new Error('Video disappeared after region zoom.');
  const regionTargetScale = regionTargetBounds.width / 320;
  const projectedRegionCenter = {
    x: regionTargetBounds.x + selectedDocumentCenter.x * regionTargetScale,
    y: regionTargetBounds.y + selectedDocumentCenter.y * regionTargetScale
  };
  if (Math.abs(projectedRegionCenter.x - (surfaceBounds.x + surfaceBounds.width / 2)) > 3
    || Math.abs(projectedRegionCenter.y - (surfaceBounds.y + surfaceBounds.height / 2)) > 3) {
    throw new Error(`Video region zoom targeted the wrong coordinate space: ${JSON.stringify({
      projectedRegionCenter, surfaceBounds, regionSourceBounds, regionTargetBounds
    })}`);
  }
  await page.locator('.lighttable-video-document').click({ button: 'right', position: { x: 140, y: 100 } });
  const toolSettings = page.getByRole('dialog', { name: 'Tool settings' });
  await toolSettings.waitFor({ state: 'visible' });
  if (await toolSettings.getByRole('button', { name: 'Fit screen', exact: true }).count() !== 1) {
    throw new Error('Video right-click did not reuse the shared Zoom properties.');
  }
  await toolSettings.getByRole('button', { name: 'Fit screen', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.locator('.lighttable-tool-options')
    .getByRole('button', { name: '150%', exact: true }).click();
  await page.getByRole('button', { name: 'Move canvas (H)', exact: true }).click();
  const transformBeforePan = await video.evaluate((element) => element.style.transform);
  await page.mouse.move(surfaceBounds.x + surfaceBounds.width / 2, surfaceBounds.y + surfaceBounds.height / 3);
  await page.mouse.down();
  await page.mouse.move(
    surfaceBounds.x + surfaceBounds.width / 2 + 60,
    surfaceBounds.y + surfaceBounds.height / 3 + 35,
    { steps: 3 }
  );
  await page.mouse.up();
  const transformAfterPan = await video.evaluate((element) => element.style.transform);
  if (transformAfterPan === transformBeforePan) {
    throw new Error('Shared Pan tool did not update the video presentation.');
  }
  await page.getByRole('button', { name: 'Zoom (Z)', exact: true }).click();
  const transformBeforeTemporaryPan = await video.evaluate((element) => element.style.transform);
  const pausedBeforeTemporaryPan = await video.evaluate((element) => {
    element.pause();
    element.currentTime = 0;
    return element.paused;
  });
  await page.keyboard.down('Space');
  await page.waitForFunction(() => document.querySelector('.lighttable-video-document')?.getAttribute('data-active-tool') === 'view');
  await page.mouse.move(surfaceBounds.x + surfaceBounds.width / 2, surfaceBounds.y + surfaceBounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    surfaceBounds.x + surfaceBounds.width / 2 - 45,
    surfaceBounds.y + surfaceBounds.height / 2 + 25,
    { steps: 3 }
  );
  await page.mouse.up();
  await page.keyboard.up('Space');
  await page.waitForFunction(() => document.querySelector('.lighttable-video-document')?.getAttribute('data-active-tool') === 'zoom');
  const transformAfterTemporaryPan = await video.evaluate((element) => element.style.transform);
  const pausedAfterTemporaryPan = await video.evaluate((element) => element.paused);
  if (transformAfterTemporaryPan === transformBeforeTemporaryPan) {
    throw new Error('Holding Space did not temporarily route the shared Pan tool to video.');
  }
  if (pausedAfterTemporaryPan !== pausedBeforeTemporaryPan) {
    throw new Error('Temporary Pan unexpectedly changed video playback state.');
  }
  const videoDocument = await driver.queryDocument(initial.activeDocumentId);
  if (videoDocument?.viewport?.zoomMode !== 'custom'
    || Math.abs(videoDocument.viewport.scale - 1.5) > 0.01
    || videoDocument.viewport.panX === 0
    || videoDocument.viewport.panY === 0) {
    throw new Error(`Video viewport was not projected through the command boundary: ${JSON.stringify(videoDocument?.viewport)}`);
  }
  const firstImageSwitchMs = await activateImageDocumentTab();
  const firstImagePixelEvidenceMs = await assertImagePixelsVisible('First video-to-image switch');
  const imageWorkspace = await driver.queryWorkspace();
  if (imageWorkspace?.documents.find(({ id }) => id === imageWorkspace.activeDocumentId)?.kind !== 'image') {
    throw new Error('Switching to the image tab did not activate the image document.');
  }
  await page.getByLabel('Switch to Grading workspace').click();
  await page.waitForFunction(() => document.querySelector('[aria-label="Switch to Grading workspace"]')?.getAttribute('aria-checked') === 'true');
  await activateDocumentTab('video.mp4');
  await video.waitFor({ state: 'visible', timeout: 30_000 });
  await page.waitForFunction(() => {
    const media = document.querySelector('video.lighttable-video-document__media');
    return media instanceof HTMLVideoElement
      && Math.abs(media.getBoundingClientRect().width - 480) < 2
      && media.style.transform !== 'translate(0px, 0px)';
  });
  const returned = await driver.queryWorkspace();
  if (returned?.documents.find(({ id }) => id === returned.activeDocumentId)?.kind !== 'video') {
    throw new Error('Switching back did not retain the video document.');
  }
  await page.waitForFunction(() => document.querySelector('[aria-label="Switch to Video workspace"]')?.getAttribute('aria-checked') === 'true');
  if (await videoWorkspaceSwitch.getAttribute('aria-checked') !== 'true') {
    throw new Error('Activating a video did not select the Video workspace.');
  }
  const repeatedImageSwitchMs = await activateImageDocumentTab();
  const repeatedImagePixelEvidenceMs = await assertImagePixelsVisible('Repeated video-to-image switch');
  if (firstImageSwitchMs > MAX_WARM_DOCUMENT_SWITCH_MS
    || repeatedImageSwitchMs > MAX_WARM_DOCUMENT_SWITCH_MS) {
    throw new Error(`Warm document switch exceeded ${MAX_WARM_DOCUMENT_SWITCH_MS} ms: ${JSON.stringify({
      firstImageSwitchMs,
      repeatedImageSwitchMs
    })}`);
  }
  const imageCanonicalAfterSwitch = await canonicalDocumentSnapshot(imageDocumentId);
  if (JSON.stringify(imageCanonicalAfterSwitch) !== JSON.stringify(imageCanonicalBeforeSwitch)) {
    throw new Error(`Inactive image document data changed during workspace/document switches: ${JSON.stringify({
      before: imageCanonicalBeforeSwitch,
      after: imageCanonicalAfterSwitch
    })}`);
  }

  // Typed document switches must only change presentation. Repeating the warm
  // path catches leaked React trees, listeners and media/canvas surfaces while
  // the canonical snapshot below protects document data from lifecycle drift.
  const lifecycleSamples = [await collectLifecycleMetrics('warm-baseline')];
  const lifecycleSwitchTimesMs = [];
  for (let cycle = 1; cycle <= 20; cycle += 1) {
    const startedAt = performance.now();
    await activateDocumentTab('video.mp4');
    await video.waitFor({ state: 'visible', timeout: 5_000 });
    await activateImageDocumentTab();
    lifecycleSwitchTimesMs.push(performance.now() - startedAt);
    if (cycle % 5 === 0) {
      lifecycleSamples.push(await collectLifecycleMetrics(`cycle-${cycle}`));
    }
  }
  await assertImagePixelsVisible('Typed-switch soak final image');
  const imageCanonicalAfterSoak = await canonicalDocumentSnapshot(imageDocumentId);
  if (JSON.stringify(imageCanonicalAfterSoak) !== JSON.stringify(imageCanonicalBeforeSwitch)) {
    throw new Error('Repeated typed document switches changed inactive canonical image data.');
  }
  const lifecycleBaseline = lifecycleSamples[0];
  const lifecycleLast = lifecycleSamples.at(-1);
  const stableProjectionKeys = [
    'domDocuments', 'canvasCount', 'videoCount', 'blobMediaSourceCount',
    'imageSurfaceCount', 'videoSurfaceCount'
  ];
  for (const key of stableProjectionKeys) {
    if (lifecycleLast[key] !== lifecycleBaseline[key]) {
      throw new Error(`Typed-switch lifecycle leaked ${key}: ${JSON.stringify(lifecycleSamples)}`);
    }
  }
  const minimumSettledHeap = Math.min(...lifecycleSamples.slice(1).map(({ heapUsedBytes }) => heapUsedBytes));
  const heapTailGrowthBytes = lifecycleLast.heapUsedBytes - minimumSettledHeap;
  const nodeGrowth = lifecycleLast.domNodes - lifecycleBaseline.domNodes;
  const listenerGrowth = lifecycleLast.eventListeners - lifecycleBaseline.eventListeners;
  if (heapTailGrowthBytes > 32 * 1024 * 1024 || nodeGrowth > 64 || listenerGrowth > 64) {
    throw new Error(`Typed-switch lifecycle growth exceeded its bounded budget: ${JSON.stringify({
      heapTailGrowthBytes, nodeGrowth, listenerGrowth, lifecycleSamples
    })}`);
  }
  await page.waitForFunction(() => document.querySelector('[aria-label="Switch to Grading workspace"]')?.getAttribute('aria-checked') === 'true');
  await activateDocumentTab('video.mp4');
  await video.waitFor({ state: 'visible', timeout: 30_000 });
  await page.waitForFunction(() => document.querySelector('[aria-label="Switch to Video workspace"]')?.getAttribute('aria-checked') === 'true');
  const droppedBytes = await readFile(droppedVideoFile);
  await page.evaluate(({ bytes, name }) => {
    const data = Uint8Array.from(atob(bytes), (character) => character.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([data], name, { type: 'video/webm' }));
    window.dispatchEvent(new DragEvent('dragenter', { bubbles: true, dataTransfer: transfer }));
    window.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: transfer }));
    window.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }));
  }, { bytes: droppedBytes.toString('base64'), name: path.basename(droppedVideoFile) });
  await page.getByRole('button', { name: 'dropped.webm', exact: true }).waitFor({
    state: 'visible', timeout: 30_000
  });
  await video.waitFor({ state: 'visible', timeout: 30_000 });
  const dropped = await driver.queryWorkspace();
  if (dropped?.documents.map(({ kind }) => kind).join(',') !== 'image,video,video') {
    throw new Error(`Dropped WebM did not become a typed document: ${JSON.stringify(dropped)}`);
  }
  const body = await page.locator('body').innerText();
  if (body.includes('document runtime stopped unexpectedly') || body.includes('font registry has been disposed')) {
    throw new Error('Document switching entered the runtime error boundary.');
  }
  if (failures.length > 0) throw new Error(failures.join(' | '));
  const report = {
    passed: true,
    documents: dropped.documents.map(({ title, kind }) => ({ title, kind })),
    activeDocumentId: dropped.activeDocumentId,
    coldImageActivationMs: Math.round(coldImageActivationMs),
    coldImageOpenMs: Math.round(coldImageOpenMs),
    imagePresentationMs: {
      first: Math.round(firstImageSwitchMs),
      repeated: Math.round(repeatedImageSwitchMs)
    },
    pixelEvidenceOverheadMs: {
      first: Math.round(firstImagePixelEvidenceMs),
      repeated: Math.round(repeatedImagePixelEvidenceMs)
    },
    typedSwitchSoak: {
      cycles: lifecycleSwitchTimesMs.length,
      medianRoundTripMs: Math.round(lifecycleSwitchTimesMs.toSorted((a, b) => a - b)[
        Math.floor(lifecycleSwitchTimesMs.length / 2)
      ]),
      maximumRoundTripMs: Math.round(Math.max(...lifecycleSwitchTimesMs)),
      heapTailGrowthBytes,
      nodeGrowth,
      listenerGrowth,
      samples: lifecycleSamples
    }
  };
  await writeFile(reportFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ ...report, reportFile }, null, 2));
} finally {
  await app.close().catch(() => {});
}
