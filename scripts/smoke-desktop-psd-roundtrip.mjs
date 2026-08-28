import { _electron as electron } from 'playwright-core';
import { access, mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { resolveDesktopTestLaunch, waitForDesktopLauncher } from './desktop-test-startup.mjs';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';

const root = path.resolve(import.meta.dirname, '..');
const source = path.resolve(process.argv[2] ?? 'D:\\TextTest.psd');
const launch = await resolveDesktopTestLaunch(root);
const output = path.join(root, 'tmp', 'psd-roundtrip');
const userData = path.join(output, `user-data-${process.pid}`);
const reportFile = path.join(output, 'report.json');
const exportedFile = path.join(
  output,
  `${path.basename(source, path.extname(source))}-lighttable-${process.pid}.psd`
);
await Promise.all([access(source), mkdir(userData, { recursive: true })]);

const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath: launch.executablePath,
  args: launch.args,
  cwd: root,
  env: {
    ...environment,
    LIGHTTABLE_AUTOMATION_OPEN_FILE: source,
    LIGHTTABLE_AUTOMATION_SAVE_FILE: exportedFile,
    LIGHTTABLE_AUTOMATION_USER_DATA: userData
  },
  timeout: 30_000
});

try {
  const page = await app.firstWindow({ timeout: 30_000 });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
  const openFileButton = await waitForDesktopLauncher({
    app, page, outputDirectory: output, sourceFile: source, pageErrors, label: 'psd-roundtrip'
  });
  await openFileButton.click();
  await page.locator('.lighttable-toolbar__meta').filter({ hasText: /ready/i })
    .waitFor({ state: 'visible', timeout: 45_000 });
  const driver = await attachLightTableAutomation(page, 'psd-roundtrip');
  const beforeWorkspace = await driver.queryWorkspace();
  const sourceDocumentId = beforeWorkspace?.activeDocumentId;
  if (!sourceDocumentId) throw new Error('The source PSD did not open.');
  const before = await driver.queryDocument(sourceDocumentId);
  const beforeLayers = await driver.queryLayers(sourceDocumentId) ?? [];

  const accepted = await driver.execute(
    sourceDocumentId, 'file.exportPsd', {}, { requireCompleted: false }
  );
  if (accepted.status !== 'accepted') throw new Error(`PSD export was rejected: ${JSON.stringify(accepted)}`);
  const task = await driver.waitForTask(sourceDocumentId, accepted.taskId, 90_000);
  if (!task.artifact || task.artifact.kind !== 'psd-export') {
    throw new Error(`PSD artifact was not published: ${JSON.stringify(task)}`);
  }
  const opened = await driver.executeWorkspace('file.openArtifact', {
    artifactId: task.artifact.id
  });
  const roundtripDocumentId = opened.value?.documentId;
  if (!roundtripDocumentId) throw new Error(`Roundtrip PSD did not open: ${JSON.stringify(opened)}`);
  await page.waitForFunction((id) => {
    const document = window.__lightTableAutomation?.queryDocument(id);
    return document?.lifecycle === 'ready'
      && document.renderer.status === 'ready'
      && Boolean(document.canvas)
      && document.tasks.activeCount === 0;
  }, roundtripDocumentId, {
    timeout: 45_000
  });
  const after = await driver.queryDocument(roundtripDocumentId);
  const afterLayers = await driver.queryLayers(roundtripDocumentId) ?? [];
  const signature = (layers) => layers.map((layer) => ({
    depth: layer.depth,
    type: layer.type,
    name: layer.name,
    visible: layer.visible,
    blendMode: layer.blendMode,
    clipping: layer.clipping,
    maskContent: layer.maskContent,
    textMode: layer.textLayout?.mode ?? null
  }));
  const report = {
    source,
    artifact: task.artifact,
    before,
    after,
    beforeSignature: signature(beforeLayers),
    afterSignature: signature(afterLayers),
    pageErrors
  };
  await writeFile(reportFile, `${JSON.stringify(report, null, 2)}\n`);
  if (before?.canvas?.width !== after?.canvas?.width
    || before?.canvas?.height !== after?.canvas?.height) {
    throw new Error('PSD canvas dimensions changed during roundtrip.');
  }
  if (JSON.stringify(report.beforeSignature) !== JSON.stringify(report.afterSignature)) {
    throw new Error(`PSD semantic layer projection changed. Report: ${reportFile}`);
  }
  if (pageErrors.length) throw new Error(`Renderer errors occurred. Report: ${reportFile}`);
  // A semantically reconstructed PSD may surface its compatibility report on
  // the newly opened artifact. Dismiss that explicit modal before exercising
  // the application menu; hidden menubar controls are intentionally excluded
  // from accessibility queries while a dialog owns focus.
  const reportDialog = page.getByRole('dialog').filter({ hasText: /PSD|compatibility|font/i }).last();
  if (await reportDialog.count() && await reportDialog.isVisible()) {
    await reportDialog.getByRole('button', { name: 'Close', exact: true }).click();
  }
  const fileMenu = page.getByRole('menuitem', { name: 'File', exact: true });
  if (!await fileMenu.count()) {
    throw new Error(`File menu is unavailable after PSD roundtrip: ${JSON.stringify({
      dialogs: await page.getByRole('dialog').allTextContents(),
      buttons: (await page.getByRole('button').allTextContents()).slice(0, 30),
      body: (await page.locator('body').innerText()).slice(0, 1_000)
    })}`);
  }
  await fileMenu.click();
  await page.getByRole('menuitem', { name: 'Export', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Photoshop PSD (Editable)...', exact: true }).click();
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    try {
      if ((await stat(exportedFile)).size > 0) break;
    } catch {
      // The host writes the file asynchronously after the menu command starts.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if ((await stat(exportedFile)).size === 0) {
    throw new Error(`Desktop PSD export is empty: ${exportedFile}`);
  }
  process.stdout.write(`Desktop PSD roundtrip passed. Report: ${reportFile}\n`);
  process.stdout.write(`PSD fixture: ${exportedFile}\n`);
} finally {
  await app.close().catch(() => {});
}
