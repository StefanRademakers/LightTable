import { _electron as electron } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import sharp from 'sharp';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';
import { packagedDesktopExecutable } from './desktop-test-startup.mjs';

const root = path.resolve(import.meta.dirname, '..');
const outputDirectory = path.join(root, 'tmp', 'multi-document-smoke');
const userData = path.join(outputDirectory, `user-data-${process.pid}`);
const imageFile = path.join(outputDirectory, 'image.png');
const videoFile = path.join(outputDirectory, 'video.mp4');
const droppedVideoFile = path.join(outputDirectory, 'dropped.webm');
const executablePath = path.resolve(
  process.env.LIGHTTABLE_TEST_EXECUTABLE
    ?? packagedDesktopExecutable(root)
);
const ffmpeg = process.env.LIGHTTABLE_FFMPEG ?? 'ffmpeg';

await mkdir(userData, { recursive: true });
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
  const videoDocument = await driver.queryDocument(initial.activeDocumentId);
  if (videoDocument?.viewport?.zoomMode !== 'custom'
    || Math.abs(videoDocument.viewport.scale - 1.5) > 0.01
    || videoDocument.viewport.panX === 0
    || videoDocument.viewport.panY === 0) {
    throw new Error(`Video viewport was not projected through the command boundary: ${JSON.stringify(videoDocument?.viewport)}`);
  }
  await page.getByRole('button', { name: 'image.png', exact: true }).click();
  await page.locator('canvas').first().waitFor({ state: 'visible', timeout: 30_000 });
  const imageWorkspace = await driver.queryWorkspace();
  if (imageWorkspace?.documents.find(({ id }) => id === imageWorkspace.activeDocumentId)?.kind !== 'image') {
    throw new Error('Switching to the image tab did not activate the image document.');
  }
  await page.getByRole('button', { name: 'video.mp4', exact: true }).click();
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
  console.log(JSON.stringify({
    passed: true,
    documents: dropped.documents.map(({ title, kind }) => ({ title, kind })),
    activeDocumentId: dropped.activeDocumentId
  }, null, 2));
} finally {
  await app.close().catch(() => {});
}
