import { _electron as electron } from 'playwright-core';
import { access, mkdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';
import { resolveDesktopTestLaunch, waitForDesktopLauncher } from './desktop-test-startup.mjs';

const workspace = path.resolve(import.meta.dirname, '..');
const source = path.resolve(process.argv[2] ?? 'D:\\colors.png');
const output = path.join(workspace, 'tmp', 'grade-black-white');
const userData = path.join(output, `user-data-${process.pid}`);
const launch = await resolveDesktopTestLaunch(workspace);
await Promise.all([access(source), mkdir(userData, { recursive: true })]);

const environment = { ...process.env, LIGHTTABLE_AUTOMATION_USER_DATA: userData,
  LIGHTTABLE_AUTOMATION_OPEN_FILE: source };
delete environment.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath: launch.executablePath,
  args: launch.args,
  cwd: workspace,
  env: environment,
  timeout: 30_000
});

const decodeMean = (page, bytes) => page.evaluate(async (encoded) => {
  const binary = atob(encoded);
  const data = Uint8Array.from(binary, (character) => character.charCodeAt(0));
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
    total[0] += pixels[index];
    total[1] += pixels[index + 1];
    total[2] += pixels[index + 2];
    count += 1;
  }
  return total.map((value) => value / Math.max(1, count));
}, Buffer.from(bytes).toString('base64'));

try {
  const page = await app.firstWindow({ timeout: 30_000 });
  const open = await waitForDesktopLauncher({ app, page, outputDirectory: output, sourceFile: source,
    label: 'grade-black-white' });
  await open.click();
  const driver = await attachLightTableAutomation(page, 'grade-black-white', 30_000);
  const workspaceState = await driver.queryWorkspace();
  const documentId = workspaceState?.activeDocumentId;
  if (!documentId) throw new Error('No active document after opening the B&W fixture.');
  await driver.waitForDocument(documentId, 120_000);

  const exportMean = async () => {
    const request = await driver.execute(documentId, 'file.exportPng', {}, { requireCompleted: false });
    const task = await driver.waitForTask(documentId, request.taskId, 120_000);
    const artifact = task.artifact && await driver.readArtifact(task.artifact.id);
    if (!artifact) throw new Error('B&W smoke export produced no artifact.');
    return decodeMean(page, artifact.bytes);
  };
  const neutral = await exportMean();

  await page.getByRole('button', { name: 'New fill or processing layer' }).click();
  await page.getByRole('menu', { name: 'New fill or processing layer' })
    .getByRole('menuitem', { name: 'New Grade layer', exact: true }).click();
  const panel = page.getByLabel('Grade Layer properties', { exact: true }).last();
  await panel.waitFor({ state: 'visible', timeout: 30_000 });
  const section = panel.locator('.lighttable-group').filter({ hasText: 'Black & White Mix' });
  const sectionToggle = section.getByRole('button', { name: 'Black & White Mix', exact: true });
  if (await sectionToggle.getAttribute('aria-expanded') !== 'true') await sectionToggle.click();
  await section.getByRole('radio', { name: 'B&W', exact: true }).click();
  const monochrome = await exportMean();

  const channelSpread = Math.max(...monochrome) - Math.min(...monochrome);
  const effect = Math.sqrt(monochrome.reduce((sum, value, index) => (
    sum + (value - neutral[index]) ** 2
  ), 0));
  if (channelSpread > 1.5) {
    throw new Error(`B&W output is not neutral: mean ${monochrome.map((value) => value.toFixed(2)).join(', ')}.`);
  }
  if (effect < 2) throw new Error('B&W output is indistinguishable from the color source.');
  process.stdout.write(`Grade B&W smoke passed: neutral=${neutral.map((value) => value.toFixed(2))}; `
    + `monochrome=${monochrome.map((value) => value.toFixed(2))}.\n`);
} finally {
  await app.close().catch(() => undefined);
}

