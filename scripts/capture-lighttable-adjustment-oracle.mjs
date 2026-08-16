import { _electron as electron } from 'playwright-core';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';

const workspace = path.resolve(import.meta.dirname, '..');
const positionalRoot = process.argv.slice(2).find((value) => !value.startsWith('--'));
const root = path.resolve(positionalRoot
  ?? 'D:\\mediavibe\\LightTableTests\\AdjustmentParity\\exposure');
const manifestText = await readFile(path.join(root, 'photoshop-manifest.json'), 'utf8');
const limitArgument = process.argv.find((value) => value.startsWith('--limit='));
const limit = limitArgument ? Number(limitArgument.slice('--limit='.length)) : Number.POSITIVE_INFINITY;
const manifest = JSON.parse(manifestText.replace(/^\uFEFF/u, ''))
  .filter(({ status }) => status === 'captured').slice(0, limit);
const adjustment = manifest[0]?.adjustment ?? path.basename(root);
const output = path.join(root, 'lighttable');
const executable = path.join(workspace, 'node_modules', 'electron', 'dist', 'electron.exe');
const userData = path.join(root, 'runtime', `lighttable-${process.pid}`);
await Promise.all([access(executable), mkdir(output, { recursive: true }), mkdir(userData, { recursive: true })]);
const environment = { ...process.env, LIGHTTABLE_AUTOMATION_USER_DATA: userData };
delete environment.ELECTRON_RUN_AS_NODE;

const app = await electron.launch({
  executablePath: executable,
  args: [path.join(workspace, 'apps', 'desktop')],
  cwd: workspace,
  env: environment,
  timeout: 30_000
});
const results = [];
try {
  const page = await app.firstWindow({ timeout: 30_000 });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
  const driver = await attachLightTableAutomation(page, 'adjustment-parity');
  for (const [index, entry] of manifest.entries()) {
    const result = { id: entry.id, source: entry.psd, output: path.join(output, `${entry.id}.png`) };
    try {
      const artifact = await driver.registerInputArtifact(
        await readFile(entry.psd), path.basename(entry.psd), 'image/vnd.adobe.photoshop'
      );
      if (!artifact?.id) throw new Error('PSD artifact registration failed.');
      const opened = await driver.executeWorkspace('file.openArtifact', { artifactId: artifact.id });
      const documentId = opened.value?.documentId;
      if (!documentId) throw new Error('PSD open did not return a document ID.');
      await driver.waitForDocument(documentId, 120_000);
      const layers = await driver.waitForLayers(documentId, 120_000);
      if (!layers.some(({ type }) => type === 'adjustment')) {
        throw new Error(`Imported PSD does not expose an adjustment layer: ${JSON.stringify(layers)}.`);
      }
      const exported = await driver.execute(documentId, 'file.exportPng', {}, { requireCompleted: false });
      if (exported.status !== 'accepted') throw new Error('PNG export was not accepted.');
      const task = await driver.waitForTask(documentId, exported.taskId, 120_000);
      if (!task.artifact) throw new Error('PNG export did not publish an artifact.');
      const png = await driver.readArtifact(task.artifact.id);
      if (!png) throw new Error('PNG export artifact cannot be read.');
      await writeFile(result.output, png.bytes);
      result.status = 'captured';
    } catch (error) {
      result.status = 'failed';
      result.error = error instanceof Error ? error.stack ?? error.message : String(error);
    }
    results.push(result);
    process.stdout.write(`[${index + 1}/${manifest.length}] ${entry.id}: ${result.status}\n`);
  }
  if (pageErrors.length) results.push({ id: 'runtime', status: 'failed', pageErrors });
} finally {
  await app.close().catch(() => {});
}
await writeFile(path.join(root, 'lighttable-manifest.json'), `${JSON.stringify(results, null, 2)}\n`);
const failures = results.filter(({ status }) => status !== 'captured');
if (failures.length) throw new Error(`LightTable ${adjustment} capture failed; see ${path.join(root, 'lighttable-manifest.json')}.`);
process.stdout.write(`LightTable ${adjustment} oracle: ${path.join(root, 'lighttable-manifest.json')}\n`);
