import { _electron as electron } from 'playwright-core';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const workspaceRoot = path.resolve(import.meta.dirname, '..');
const planPath = path.resolve(
  workspaceRoot,
  process.argv[2] ?? 'work/done/task_049_psd_template_corpus_feature_audit/suspect-capture-plan.json'
);
const inventoryPath = path.resolve(
  workspaceRoot,
  process.argv[3] ?? 'work/done/task_049_psd_template_corpus_feature_audit/corpus-inventory.json'
);
const outputDirectory = path.resolve(
  workspaceRoot,
  process.argv[4] ?? 'tmp/task-049/suspect-references/lighttable'
);
const executablePath = path.join(workspaceRoot, 'node_modules', 'electron', 'dist', 'electron.exe');

const [planText, inventoryText] = await Promise.all([
  readFile(planPath, 'utf8'),
  readFile(inventoryPath, 'utf8'),
  access(executablePath),
  mkdir(outputDirectory, { recursive: true })
]);
const plan = JSON.parse(planText);
const inventory = JSON.parse(inventoryText);
const sourceByDocument = new Map(inventory.documents.map(({ id, source }) => [id, source]));
const captures = [];

const launchEnvironment = { ...process.env };
delete launchEnvironment.ELECTRON_RUN_AS_NODE;

for (const target of plan) {
  const sourceFile = sourceByDocument.get(target.document);
  if (!sourceFile) throw new Error(`Corpus source is unavailable for ${target.document}.`);
  await access(sourceFile);
  const stem = `${target.document}-${target.address.replaceAll('.', '_')}-${target.cluster}`;
  const contextPath = path.join(outputDirectory, `${stem}-context.png`);
  const soloPath = path.join(outputDirectory, `${stem}-solo.png`);
  const userDataPath = path.join(outputDirectory, `user-data-${process.pid}-${stem}`);
  await mkdir(userDataPath, { recursive: true });

  const app = await electron.launch({
    executablePath,
    args: [path.join(workspaceRoot, 'apps', 'desktop')],
    cwd: workspaceRoot,
    env: {
      ...launchEnvironment,
      LIGHTTABLE_AUTOMATION_OPEN_FILE: sourceFile,
      LIGHTTABLE_AUTOMATION_USER_DATA: userDataPath
    },
    timeout: 30_000
  });

  const pageErrors = [];
  try {
    const page = await app.firstWindow({ timeout: 30_000 });
    page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
    await page.getByRole('button', { name: 'Open file' }).click();
    await page.locator('.lighttable-toolbar__meta').filter({ hasText: /ready/i })
      .waitFor({ state: 'visible', timeout: 60_000 });
    await page.waitForFunction(() => Boolean(window.__lightTableAutomation), undefined, {
      timeout: 10_000
    });
    await page.addStyleTag({ content: '.dv-floating-overlay-host { display: none !important; }' });
    await page.evaluate(() => {
      for (const layersPanel of document.querySelectorAll('.lighttable-layers-panel')) {
        const panelGroup = layersPanel.closest('.dv-groupview');
        const floatingFrame = layersPanel.closest('.dv-resize-container');
        if (panelGroup instanceof HTMLElement) panelGroup.style.display = 'none';
        if (floatingFrame instanceof HTMLElement) floatingFrame.style.display = 'none';
        if (layersPanel instanceof HTMLElement) layersPanel.style.display = 'none';
      }
    });
    await page.locator('.lighttable-viewport').screenshot({ path: contextPath });

    const isolation = await page.evaluate(async ({ name, occurrence }) => {
      const driver = window.__lightTableAutomation;
      if (!driver) throw new Error('Automation driver is unavailable.');
      const documentId = driver.queryWorkspace().activeDocumentId;
      if (!documentId) throw new Error('No active document.');
      const layers = driver.queryLayers(documentId) ?? [];
      const matches = layers.filter((layer) => layer.name === name);
      const targetLayer = matches[occurrence];
      if (!targetLayer) {
        throw new Error(`Layer ${name} occurrence ${occurrence} was not found (${matches.length} matches).`);
      }
      const byId = new Map(layers.map((layer) => [layer.id, layer]));
      const visibleIds = [];
      let current = targetLayer;
      while (current) {
        visibleIds.push(current.id);
        current = current.parentId ? byId.get(current.parentId) : undefined;
      }
      let sequence = 0;
      const execute = async (layerIds, visible) => {
        for (let offset = 0; offset < layerIds.length; offset += 256) {
          const result = await driver.execute({
            protocolVersion: 1,
            requestId: `capture-${++sequence}`,
            command: 'layer.setVisibility',
            documentId,
            parameters: { layerIds: layerIds.slice(offset, offset + 256), visible }
          });
          if (result.status !== 'completed') throw new Error(result.message);
        }
      };
      await execute(layers.map(({ id }) => id), false);
      await execute(visibleIds, true);
      return {
        documentId,
        layerId: targetLayer.id,
        layerType: targetLayer.type,
        parentIds: visibleIds.slice(1),
        layerCount: layers.length
      };
    }, { name: target.name, occurrence: target.lightTableOccurrence });

    await page.waitForTimeout(750);
    await page.locator('.lighttable-viewport').screenshot({ path: soloPath });
    captures.push({
      ...target,
      source: sourceFile,
      context: contextPath,
      solo: soloPath,
      status: 'captured',
      isolation,
      pageErrors
    });
  } catch (error) {
    captures.push({
      ...target,
      source: sourceFile,
      status: 'failed',
      error: error instanceof Error ? error.stack ?? error.message : String(error),
      pageErrors
    });
  } finally {
    await app.close().catch(() => {});
  }
}

const manifestPath = path.join(outputDirectory, 'manifest.json');
await writeFile(manifestPath, `${JSON.stringify(captures, null, 2)}\n`);
const failures = captures.filter(({ status, pageErrors }) => status !== 'captured' || pageErrors.length);
if (failures.length) {
  throw new Error(`LightTable reference capture had ${failures.length} failure(s). See ${manifestPath}.`);
}
process.stdout.write(`LightTable suspect-layer references captured: ${manifestPath}\n`);
