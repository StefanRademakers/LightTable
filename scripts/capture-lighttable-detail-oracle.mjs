import { _electron as electron } from 'playwright-core';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';

const workspace = path.resolve(import.meta.dirname, '..');
const sourceArgument = process.argv.find((value) => value.startsWith('--source='));
const rootArgument = process.argv.find((value) => value.startsWith('--root='));
const source = path.resolve(sourceArgument?.slice('--source='.length) ?? 'D:\\people.jpg');
const root = path.resolve(rootArgument?.slice('--root='.length)
  ?? 'D:\\mediavibe\\LightTableTests\\DetailParity');
const outputDirectory = path.join(root, 'lighttable');
const executable = path.join(workspace, 'node_modules', 'electron', 'dist', 'electron.exe');
const userData = path.join(root, 'runtime', `lighttable-${process.pid}`);
await Promise.all([
  access(source), access(executable), mkdir(outputDirectory, { recursive: true }),
  mkdir(userData, { recursive: true })
]);

const mimeByExtension = new Map([
  ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'], ['.png', 'image/png'],
  ['.tif', 'image/tiff'], ['.tiff', 'image/tiff']
]);

const setLuminanceNoiseReduction = async (page, target) => {
  const subgroup = page.locator('.lighttable-detail-controls__subgroup')
    .filter({ has: page.getByRole('button', { name: 'Noise Reduction', exact: true }) });
  const slider = subgroup.locator('input[type="range"][aria-label="Luminance"]');
  await slider.waitFor({ state: 'attached', timeout: 30_000 });
  await slider.scrollIntoViewIfNeeded();
  await slider.evaluate((input, value) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, String(value));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, target);
  const actual = Number(await slider.inputValue());
  if (actual !== target) throw new Error(`Luminance settled at ${actual}, expected ${target}.`);
};

const environment = { ...process.env, LIGHTTABLE_AUTOMATION_USER_DATA: userData };
delete environment.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath: executable,
  args: [path.join(workspace, 'apps', 'desktop')],
  cwd: workspace,
  env: environment,
  timeout: 30_000
});

const cases = [
  { id: 'neutral', luminanceNoiseReduction: 0 },
  { id: 'luminance-100', luminanceNoiseReduction: 100 }
];
const results = [];
try {
  const page = await app.firstWindow({ timeout: 30_000 });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
  const driver = await attachLightTableAutomation(page, 'detail-parity', 30_000);
  const sourceArtifact = await driver.registerInputArtifact(
    await readFile(source), path.basename(source),
    mimeByExtension.get(path.extname(source).toLowerCase()) ?? 'application/octet-stream'
  );
  if (!sourceArtifact?.id) throw new Error('Detail source registration failed.');

  for (const entry of cases) {
    const opened = await driver.executeWorkspace('file.openArtifact', {
      artifactId: sourceArtifact.id
    });
    const documentId = opened.value?.documentId;
    if (!documentId) throw new Error('Detail source open did not return a document ID.');
    await driver.waitForDocument(documentId, 120_000);
    const gradePanel = page.locator('aside.lighttable-grade-panel');
    if (!await gradePanel.isVisible().catch(() => false)) {
      await page.getByRole('treeitem', { name: /Global Grade/ }).click();
    }
    await gradePanel.waitFor({ state: 'visible', timeout: 30_000 });
    if (entry.luminanceNoiseReduction !== 0) {
      await setLuminanceNoiseReduction(page, entry.luminanceNoiseReduction);
    }
    const exported = await driver.execute(documentId, 'file.exportPng', {}, {
      requireCompleted: false
    });
    const task = await driver.waitForTask(documentId, exported.taskId, 120_000);
    if (!task.artifact) throw new Error('Detail PNG export did not publish an artifact.');
    const png = await driver.readArtifact(task.artifact.id);
    if (!png) throw new Error('Detail PNG export artifact cannot be read.');
    const output = path.join(outputDirectory, `${entry.id}.png`);
    await writeFile(output, png.bytes);
    results.push({ ...entry, output });
    process.stdout.write(`LightTable ${entry.id}: ${output}\n`);
  }
  if (pageErrors.length) throw new Error(`LightTable runtime errors: ${pageErrors.join('\n')}`);
} finally {
  await app.close().catch(() => {});
}

await writeFile(path.join(outputDirectory, 'capture-report.json'), `${JSON.stringify({
  schema: 1,
  generatedAt: new Date().toISOString(),
  source,
  cases: results
}, null, 2)}\n`);
