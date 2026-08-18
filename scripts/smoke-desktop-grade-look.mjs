import { _electron as electron } from 'playwright-core';
import { createHash } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';
import { resolveDesktopTestLaunch, waitForDesktopLauncher } from './desktop-test-startup.mjs';

const workspace = path.resolve(import.meta.dirname, '..');
const source = path.resolve(process.argv[2] ?? 'D:/colors.png');
const lut = path.resolve(process.argv[3]
  ?? path.join(workspace, 'packages/lighttable-app/src/assets/luts/FGCineCold.cube'));
const destinationSource = path.resolve(process.argv[4] ?? 'D:/people.jpg');
const output = path.join(workspace, 'tmp', 'grade-look');
const userData = path.join(output, `user-data-${process.pid}`);
const launch = await resolveDesktopTestLaunch(workspace, { requirePackaged: true });
const corpus = JSON.parse(await readFile(
  path.join(import.meta.dirname, 'grade-camera-raw-corpus.json'), 'utf8'
));
const caseManifestBytes = await readFile(
  path.join(import.meta.dirname, 'grade-look-profile-parity-cases.json')
);
const evidenceDirectory = path.join(
  path.resolve(corpus.externalRoot), 'captures', 'look-profile', 'native'
);
await Promise.all([
  access(source), access(lut), access(destinationSource),
  mkdir(userData, { recursive: true }), mkdir(evidenceDirectory, { recursive: true })
]);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

const environment = {
  ...process.env,
  LIGHTTABLE_AUTOMATION_USER_DATA: userData,
  LIGHTTABLE_AUTOMATION_OPEN_FILE: source,
  LIGHTTABLE_AUTOMATION_HEADLESS: '1'
};
delete environment.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath: launch.executablePath,
  args: launch.args,
  cwd: workspace,
  env: environment,
  timeout: 30_000
});

const decodeMean = (page, bytes) => page.evaluate(async (encoded) => {
  const data = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
  const bitmap = await createImageBitmap(new Blob([data], { type: 'image/png' }));
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas 2D unavailable.');
  context.drawImage(bitmap, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const total = [0, 0, 0];
  let count = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    if (pixels[index + 3] === 0) continue;
    total[0] += pixels[index]; total[1] += pixels[index + 1]; total[2] += pixels[index + 2];
    count += 1;
  }
  return total.map((value) => value / Math.max(1, count));
}, Buffer.from(bytes).toString('base64'));

const distance = (left, right) => Math.sqrt(left.reduce(
  (sum, value, index) => sum + (value - right[index]) ** 2, 0
));

try {
  const page = await app.firstWindow({ timeout: 30_000 });
  const open = await waitForDesktopLauncher({
    app, page, outputDirectory: output, sourceFile: source, label: 'grade-look'
  });
  await open.click();
  const driver = await attachLightTableAutomation(page, 'grade-look', 30_000);
  const documentId = (await driver.queryWorkspace())?.activeDocumentId;
  if (!documentId) throw new Error('No active document after opening the Look fixture.');
  await driver.waitForDocument(documentId, 120_000);

  const exportMean = async (targetDocumentId = documentId) => {
    const request = await driver.execute(targetDocumentId, 'file.exportPng', {}, { requireCompleted: false });
    const task = await driver.waitForTask(targetDocumentId, request.taskId, 120_000);
    const artifact = task.artifact && await driver.readArtifact(task.artifact.id);
    if (!artifact) throw new Error('Grade Look smoke export produced no artifact.');
    return decodeMean(page, artifact.bytes);
  };

  const sourceNeutral = await exportMean();
  await page.getByRole('button', { name: 'New fill or processing layer' }).click();
  await page.getByRole('menu', { name: 'New fill or processing layer' })
    .getByRole('menuitem', { name: 'New Grade layer', exact: true }).click();
  const panel = page.getByLabel('Grade Layer properties', { exact: true }).last();
  await panel.waitFor({ state: 'visible', timeout: 30_000 });
  const section = panel.locator('.lighttable-group').filter({ hasText: 'Look' }).first();
  const toggle = section.getByRole('button', { name: 'Look', exact: true });
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
  const neutral = await exportMean();
  if (distance(sourceNeutral, neutral) > 0.75) {
    throw new Error(`A neutral Grade Layer changed the image by ${distance(sourceNeutral, neutral).toFixed(3)}.`);
  }
  const chooserPromise = page.waitForEvent('filechooser');
  await section.getByRole('button', { name: 'Load .cube...', exact: true }).click();
  await (await chooserPromise).setFiles(lut);
  await section.locator('select').waitFor({ state: 'visible' });
  await page.waitForTimeout(300);
  const full = await exportMean();

  const strength = section.getByRole('slider', { name: 'Strength', exact: true });
  await strength.fill('50');
  if (await strength.inputValue() !== '50') throw new Error('Strength slider did not settle at 50 percent.');
  await page.waitForTimeout(150);
  const half = await exportMean();

  await strength.fill('0');
  if (await strength.inputValue() !== '0') throw new Error('Strength slider did not settle at zero.');
  await page.waitForTimeout(150);
  const bypass = await exportMean();

  if (distance(neutral, full) < 2) throw new Error('The selected Grade Look produced no visible effect.');
  const fullDistance = distance(neutral, full);
  const halfDistance = distance(neutral, half);
  if (!(halfDistance > 0.25 && halfDistance < fullDistance)) {
    throw new Error(`Half-strength Look did not visually interpolate between bypass and full: `
      + `half=${halfDistance.toFixed(3)}, full=${fullDistance.toFixed(3)}.`);
  }
  if (distance(neutral, bypass) > 0.75) {
    throw new Error(`Zero-strength Look is not an exact visual bypass: ${distance(neutral, bypass).toFixed(3)}; `
      + `neutral=${neutral.map((value) => value.toFixed(2))}; zero=${bypass.map((value) => value.toFixed(2))}.`);
  }

  await strength.fill('62');
  if (await strength.inputValue() !== '62') {
    throw new Error(`Source Look Strength settled at ${await strength.inputValue()}, expected 62.`);
  }
  await page.waitForTimeout(200);
  await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Copy grade', exact: true }).click();
  await page.waitForTimeout(200);
  const copiedStrength = await page.evaluate(() => {
    const raw = window.localStorage.getItem('storybuilder:lighttable:grade-clipboard');
    return raw ? JSON.parse(raw).settings?.gradeLook?.strength : null;
  });
  if (copiedStrength !== 62) {
    throw new Error(`Grade clipboard stored Look Strength ${copiedStrength}, expected 62.`);
  }

  const destinationBytes = await readFile(destinationSource);
  const destinationArtifact = await driver.registerInputArtifact(
    destinationBytes,
    path.basename(destinationSource),
    /\.png$/i.test(destinationSource) ? 'image/png' : 'image/jpeg'
  );
  const openedDestination = await driver.executeWorkspace('file.openArtifact', {
    artifactId: destinationArtifact.id
  });
  const destinationDocumentId = openedDestination.value?.documentId;
  if (!destinationDocumentId) throw new Error('Cross-document Look smoke did not open its destination.');
  await driver.waitForDocument(destinationDocumentId, 120_000);
  const destinationNeutral = await exportMean(destinationDocumentId);

  await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();
  await page.getByRole('menuitem', { name: /Paste grade:/ }).click();
  const destinationLook = page.locator('.lighttable-grade-panel:visible .lighttable-group')
    .filter({ hasText: 'Look' }).first();
  const destinationStrength = destinationLook.getByRole('slider', { name: 'Strength', exact: true });
  await destinationStrength.waitFor({ state: 'attached', timeout: 30_000 });
  await page.waitForTimeout(200);
  const destinationLookMean = await exportMean(destinationDocumentId);
  const destinationStrengthValue = await destinationStrength.inputValue();
  if (destinationStrengthValue !== '62') {
    throw new Error(`Cross-document Look Strength settled at ${destinationStrengthValue}, expected 62; `
      + `effect distance=${distance(destinationNeutral, destinationLookMean).toFixed(3)}.`);
  }
  if (distance(destinationNeutral, destinationLookMean) < 1) {
    throw new Error('Cross-document Grade paste did not apply the embedded Look.');
  }
  await writeFile(path.join(evidenceDirectory, 'capture-report.json'), `${JSON.stringify({
    schema: 1,
    generatedAt: new Date().toISOString(),
    section: 'look-profile',
    caseManifestSha256: sha256(caseManifestBytes),
    packagedDesktop: launch.mode === 'production-packaged',
    passed: true,
    inputs: {
      source: { file: source, sha256: sha256(await readFile(source)) },
      lut: { file: lut, sha256: sha256(await readFile(lut)) },
      destination: { file: destinationSource, sha256: sha256(await readFile(destinationSource)) }
    },
    cases: [
      { id: 'neutral-grade-layer', mean: neutral },
      { id: 'look-full', mean: full },
      { id: 'look-half', mean: half },
      { id: 'look-zero', mean: bypass },
      { id: 'cross-document-copy', strength: 62, mean: destinationLookMean }
    ]
  }, null, 2)}\n`);
  process.stdout.write(`Grade Look smoke passed: neutral=${neutral.map((value) => value.toFixed(2))}; `
    + `full=${full.map((value) => value.toFixed(2))}; half=${half.map((value) => value.toFixed(2))}; `
    + `zero=${bypass.map((value) => value.toFixed(2))}; cross-document strength=62.\n`);
} finally {
  await app.close().catch(() => undefined);
}
