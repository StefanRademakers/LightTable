import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { _electron as electron } from 'playwright-core';
import sharp from 'sharp';
import { resolveDesktopTestLaunch, waitForDesktopLauncher } from './desktop-test-startup.mjs';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';

const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, 'tmp', 'desktop-scopes-smoke');
await mkdir(output, { recursive: true });
const userData = await mkdtemp(path.join(output, 'profile-'));
const fixture = path.join(output, 'scope-color-bars.png');

const width = 768;
const height = 384;
const colors = [
  [255, 20, 20], [255, 220, 20], [20, 220, 40],
  [20, 220, 235], [30, 60, 255], [220, 30, 235]
];
const pixels = Buffer.alloc(width * height * 4);
for (let y = 0; y < height; y += 1) {
  for (let x = 0; x < width; x += 1) {
    const offset = (y * width + x) * 4;
    const color = colors[Math.min(colors.length - 1, Math.floor(x / (width / colors.length)))];
    const level = 0.25 + (0.75 * y / (height - 1));
    pixels[offset] = Math.round(color[0] * level);
    pixels[offset + 1] = Math.round(color[1] * level);
    pixels[offset + 2] = Math.round(color[2] * level);
    pixels[offset + 3] = 255;
  }
}
await sharp(pixels, { raw: { width, height, channels: 4 } }).png().toFile(fixture);

const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
const pageErrors = [];
let app;

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

try {
  const launch = await resolveDesktopTestLaunch(root, { requirePackaged: true });
  app = await electron.launch({
    executablePath: launch.executablePath,
    args: launch.args,
    cwd: root,
    env: {
      ...environment,
      LIGHTTABLE_AUTOMATION_USER_DATA: userData,
      LIGHTTABLE_AUTOMATION_OPEN_FILE: fixture
    },
    timeout: 30_000
  });
  const page = await app.firstWindow({ timeout: 30_000 });
  page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
  const open = await waitForDesktopLauncher({
    app, page, outputDirectory: output, sourceFile: fixture, pageErrors, label: 'scopes'
  });
  await open.click();
  const driver = await attachLightTableAutomation(page, 'scopes');
  const workspace = await driver.queryWorkspace();
  const documentId = workspace?.activeDocumentId;
  assert.ok(documentId, 'Scopes smoke has no active document.');
  await driver.waitForRenderedDocument(documentId, 60_000);
  const beforeDocument = await driver.queryDocument(documentId);
  const beforePreview = await driver.requestDocumentPreview(
    documentId, beforeDocument.canonicalRevision, 768
  );
  const beforeArtifactId = beforePreview?.artifact?.id ?? beforePreview?.id;
  const beforeBytes = (await driver.readArtifact(beforeArtifactId))?.bytes;
  assert.ok(beforeBytes?.length, 'Scopes smoke could not read its baseline preview.');

  await page.getByRole('radio', { name: 'Switch to Grading workspace' }).click();
  const scopes = page.locator('.lighttable-scopes:visible');
  await scopes.waitFor({ state: 'visible', timeout: 30_000 });

  const assertScopeDrawn = async (label) => {
    const canvas = scopes.getByLabel(label, { exact: true });
    await canvas.waitFor({ state: 'visible', timeout: 30_000 });
    let evidence = null;
    for (let attempt = 0; attempt < 180; attempt += 1) {
      const screenshot = await canvas.screenshot();
      const { data, info } = await sharp(screenshot).removeAlpha().raw()
        .toBuffer({ resolveWithObject: true });
      let minimum = 255;
      let maximum = 0;
      for (let index = 0; index < data.length; index += info.channels) {
        const intensity = Math.max(data[index], data[index + 1], data[index + 2]);
        minimum = Math.min(minimum, intensity);
        maximum = Math.max(maximum, intensity);
      }
      let signalPixels = 0;
      for (let index = 0; index < data.length; index += info.channels) {
        const intensity = Math.max(data[index], data[index + 1], data[index + 2]);
        if (intensity >= minimum + 10) signalPixels += 1;
      }
      evidence = { width: info.width, height: info.height, minimum, maximum,
        dynamicRange: maximum - minimum,
        signalRatio: signalPixels / (info.width * info.height) };
      if (evidence.dynamicRange >= 16 && evidence.signalRatio >= 0.0005) return evidence;
      await page.waitForTimeout(16);
    }
    throw new Error(`${label} remained blank: ${JSON.stringify(evidence)}`);
  };

  const first = Object.fromEntries(await Promise.all([
    'Hue Distribution', 'RGB Parade', 'Vectorscope'
  ].map(async (label) => [label, await assertScopeDrawn(label)])));

  await scopes.getByRole('switch', { name: 'Disable Vectorscope' }).click();
  await scopes.getByLabel('Vectorscope', { exact: true }).waitFor({ state: 'hidden' });
  await scopes.getByRole('switch', { name: 'Enable Vectorscope' }).click();
  const afterVisibilityWake = await assertScopeDrawn('Vectorscope');

  await page.getByRole('radio', { name: 'Switch to Photo edit workspace' }).click();
  await page.getByRole('radio', { name: 'Switch to Grading workspace' }).click();
  await scopes.waitFor({ state: 'visible', timeout: 30_000 });
  const afterWorkspaceWake = await assertScopeDrawn('RGB Parade');

  const afterDocument = await driver.queryDocument(documentId);
  assert.equal(afterDocument.canonicalRevision, beforeDocument.canonicalRevision,
    'Opening, hiding or restoring scopes changed canonical document revision.');
  assert.deepEqual(afterDocument.history, beforeDocument.history,
    'Opening, hiding or restoring scopes changed document history.');
  const afterPreview = await driver.requestDocumentPreview(
    documentId, afterDocument.canonicalRevision, 768
  );
  const afterArtifactId = afterPreview?.artifact?.id ?? afterPreview?.id;
  const afterBytes = (await driver.readArtifact(afterArtifactId))?.bytes;
  assert.ok(afterBytes?.length, 'Scopes smoke could not read its final preview.');
  assert.equal(digest(afterBytes), digest(beforeBytes),
    'Opening, hiding or restoring scopes changed presented document pixels.');
  assert.deepEqual(pageErrors, [], `Scopes smoke emitted page errors: ${pageErrors.join(' | ')}`);

  await page.screenshot({ path: path.join(output, 'scopes.png') });
  process.stdout.write(`Packaged scopes smoke passed: ${JSON.stringify({
    first, afterVisibilityWake, afterWorkspaceWake
  })}\n`);
} finally {
  await app?.close().catch(() => undefined);
}
