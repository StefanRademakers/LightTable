import { createHash } from 'node:crypto';
import { access, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { _electron as electron } from 'playwright-core';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';
import { resolveDesktopTestLaunch, waitForDesktopLauncher } from './desktop-test-startup.mjs';

const root = path.resolve(import.meta.dirname, '..');
const sourceFile = path.resolve(process.argv[2] ?? 'D:\\pukkels-lighttable.png');
const output = path.resolve(process.argv[3] ?? path.join(root, 'tmp', 'face-warp-parity', path.parse(sourceFile).name));
const userData = path.join(output, `user-data-${process.pid}`);
const launch = await resolveDesktopTestLaunch(root);
await Promise.all([
  access(sourceFile), mkdir(output, { recursive: true }),
  rm(userData, { recursive: true, force: true }), mkdir(userData, { recursive: true })
]);

const cases = [
  ['face-width', 'faceWidth'], ['eye-size', 'eyeSize'],
  ['nose-width', 'noseWidth'], ['smile', 'smile']
].flatMap(([name, parameter]) => [-0.5, 0.5].map((amount) => ({
  name: `${name}-${amount < 0 ? 'minus' : 'plus'}-50`, parameter, amount
})));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath: launch.executablePath, args: launch.args, cwd: root,
  env: { ...environment, LIGHTTABLE_AUTOMATION_OPEN_FILE: sourceFile, LIGHTTABLE_AUTOMATION_USER_DATA: userData },
  timeout: 30_000
});

let page;
const pageErrors = [];
const consoleErrors = [];
const exportArtifact = async (driver, documentId, command) => {
  const started = await driver.execute(documentId, command, {}, { requireCompleted: false });
  if (started.status !== 'accepted' || !started.taskId) throw new Error(`${command} did not start an export task.`);
  const task = await driver.waitForTask(documentId, started.taskId, 60_000);
  if (!task.artifact?.id) throw new Error(`${command} completed without an artifact.`);
  const artifact = await driver.readArtifact(task.artifact.id);
  if (!artifact) throw new Error(`${command} artifact could not be read.`);
  return artifact;
};

try {
  page = await app.firstWindow({ timeout: 30_000 });
  page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  const open = await waitForDesktopLauncher({ app, page, outputDirectory: output, sourceFile, pageErrors,
    label: 'face-warp-parity' });
  await open.click();
  await page.locator('.lighttable-toolbar__meta').filter({ hasText: /ready/i })
    .waitFor({ state: 'visible', timeout: 60_000 });
  const driver = await attachLightTableAutomation(page, 'face-warp-parity');
  const workspace = await driver.queryWorkspace();
  const documentId = workspace?.activeDocumentId;
  if (!documentId) throw new Error('The source document did not become active.');
  await page.getByRole('button', { name: /^Face Warp/ }).click();
  await page.getByRole('button', { name: 'Detect faces' }).click();
  await page.getByRole('button', { name: 'Redetect faces' }).waitFor({ state: 'visible', timeout: 60_000 });
  await page.getByLabel('Show mesh').uncheck();
  const layers = await driver.queryLayers(documentId);
  const layerId = layers?.find((layer) => layer.kind === 'raster')?.id ?? layers?.[0]?.id;
  if (!layerId) throw new Error('The detected face has no source layer.');

  const identity = await exportArtifact(driver, documentId, 'file.exportPng');
  await writeFile(path.join(output, 'lighttable-identity.png'), identity.bytes);
  const results = [];
  for (const entry of cases) {
    await driver.execute(documentId, 'faceWarp.applyOperation', {
      layerId, operation: { kind: 'set-semantic', faceId: 'face-1', target: 'both', change: { [entry.parameter]: entry.amount } }
    });
    const png = await exportArtifact(driver, documentId, 'file.exportPng');
    const pngName = `lighttable-${entry.name}.png`;
    await writeFile(path.join(output, pngName), png.bytes);

    const native = await exportArtifact(driver, documentId, 'file.exportNative');
    const nativeInput = await driver.registerInputArtifact(native.bytes, `roundtrip-${entry.name}.lighttable`, native.mediaType);
    if (!nativeInput?.id) throw new Error(`Could not register native roundtrip for ${entry.name}.`);
    const reopened = await driver.executeWorkspace('file.openArtifact', { artifactId: nativeInput.id });
    const reopenedId = reopened.value?.documentId;
    if (!reopenedId) throw new Error(`Native roundtrip did not open for ${entry.name}.`);
    await driver.waitForDocument(reopenedId, 60_000);
    const roundtrip = await exportArtifact(driver, reopenedId, 'file.exportPng');
    const roundtripName = `lighttable-${entry.name}-roundtrip.png`;
    await writeFile(path.join(output, roundtripName), roundtrip.bytes);
    if (hash(png.bytes) !== hash(roundtrip.bytes)) {
      throw new Error(`Native roundtrip changed rendered pixels for ${entry.name}.`);
    }
    results.push({ ...entry, png: pngName, roundtrip: roundtripName, sha256: hash(png.bytes) });
    await driver.execute(documentId, 'faceWarp.applyOperation', {
      layerId, operation: { kind: 'set-semantic', faceId: 'face-1', target: 'both', change: { [entry.parameter]: 0 } }
    });
  }
  if (pageErrors.length || consoleErrors.some((message) => /render validation failed|invalid renderpipeline/i.test(message))) {
    throw new Error(`Runtime errors occurred: ${JSON.stringify({ pageErrors, consoleErrors })}`);
  }
  await writeFile(path.join(output, 'manifest.json'), `${JSON.stringify({
    sourceFile, identity: 'lighttable-identity.png', cases: results,
    photoshopFilesExpected: results.map(({ name }) => `photoshop-${name}.png`),
    pageErrors, consoleErrors
  }, null, 2)}\n`);
  process.stdout.write(`Face Warp parity corpus passed: ${path.join(output, 'manifest.json')}\n`);
} catch (error) {
  await writeFile(path.join(output, 'failure.json'), `${JSON.stringify({
    error: error instanceof Error ? error.stack ?? error.message : String(error), pageErrors, consoleErrors
  }, null, 2)}\n`);
  throw error;
} finally {
  await app.close().catch(() => {});
}
