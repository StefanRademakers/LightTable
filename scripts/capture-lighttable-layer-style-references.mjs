import { _electron as electron } from 'playwright-core';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const workspaceRoot = path.resolve(import.meta.dirname, '..');
const planPath = path.resolve(workspaceRoot, process.argv[2]
  ?? 'architecture/reference/implementation/LAYER_STYLE_REFERENCE_PLAN.json');
const corpusRoot = path.resolve(process.argv[3]
  ?? 'D:\\mediavibe\\LightTableTestFiles\\psd\\templates\\Save the Date Invitation PSD 6');
const outputDirectory = path.resolve(workspaceRoot, process.argv[4]
  ?? 'tmp/task-050/layer-styles/lighttable');
const executablePath = path.join(workspaceRoot, 'node_modules', 'electron', 'dist', 'electron.exe');
const inventoryPath = path.join(
  workspaceRoot, 'work', 'done', 'task_049_psd_template_corpus_feature_audit', 'corpus-inventory.json'
);

if (!outputDirectory.startsWith(`${workspaceRoot}${path.sep}`)) {
  throw new Error('LightTable reference output must stay inside the workspace.');
}
const [planText, inventoryText] = await Promise.all([
  readFile(planPath, 'utf8'), readFile(inventoryPath, 'utf8'), access(executablePath), mkdir(outputDirectory, { recursive: true })
]);
const plan = JSON.parse(planText);
const inventory = JSON.parse(inventoryText);
const sourceByDocument = new Map(inventory.documents.map(({ id, source }) => [id, source]));
const launchEnvironment = { ...process.env };
delete launchEnvironment.ELECTRON_RUN_AS_NODE;
const results = [];

for (const target of plan) {
  const sourceFile = sourceByDocument.get(target.document)
    ?? path.join(corpusRoot, target.document, target.document, `${target.document}.psd`);
  await access(sourceFile);
  const stem = `${target.document}-${target.address.replaceAll('.', '_')}-${target.name.replaceAll(' ', '_')}`;
  const files = Object.fromEntries(['context-enabled', 'context-bypassed', 'solo-enabled', 'solo-bypassed']
    .map((kind) => [kind, path.join(outputDirectory, `${stem}-${kind}.png`)]));
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
    await page.waitForFunction(() => Boolean(window.__lightTableAutomation), undefined, { timeout: 10_000 });
    await page.addStyleTag({ content: '.dv-floating-overlay-host { display: none !important; }' });
    const setup = await page.evaluate(({ name, sourceId, expectedKinds }) => {
      const driver = window.__lightTableAutomation;
      if (!driver) throw new Error('Automation driver is unavailable.');
      const documentId = driver.queryWorkspace().activeDocumentId;
      if (!documentId) throw new Error('No active document.');
      const layers = driver.queryLayers(documentId) ?? [];
      const targetLayer = layers.find((layer) => layer.id === `psd-layer-${sourceId}`);
      if (!targetLayer || targetLayer.name !== name) {
        throw new Error(`Layer ${name} with PSD source id ${sourceId} was not found.`);
      }
      const effects = driver.queryLayerEffects(documentId, targetLayer.id);
      if (!effects) throw new Error('Layer effect projection is unavailable.');
      for (const kind of expectedKinds) {
        if (!effects.effects.some((effect) => effect.kind === kind && effect.enabled)) {
          throw new Error(`Expected enabled ${kind} was not imported.`);
        }
      }
      return { documentId, targetLayer, layers, effects };
    }, { name: target.name, sourceId: target.sourceId, expectedKinds: target.effects });

    let sequence = 0;
    const execute = async (command, parameters) => {
      const result = await page.evaluate(async ({ command, documentId, parameters, requestId }) =>
        window.__lightTableAutomation.execute({
          protocolVersion: 1, requestId, command, documentId, parameters
        }), {
        command, documentId: setup.documentId, parameters,
        requestId: `style-capture-${++sequence}`
      });
      if (result.status !== 'completed') throw new Error(result.message);
    };
    const viewportBounds = await page.locator('.lighttable-viewport').boundingBox();
    const metadataText = await page.locator('.lighttable-toolbar__meta').textContent() ?? '';
    const size = metadataText.match(/(\d+)\s*[x×]\s*(\d+)/i);
    const zoom = metadataText.match(/(\d+(?:\.\d+)?)%/);
    if (!viewportBounds || !size || !zoom) throw new Error(`Cannot resolve document capture bounds: ${metadataText}`);
    const displayWidth = Number(size[1]) * Number(zoom[1]) / 100;
    const displayHeight = Number(size[2]) * Number(zoom[1]) / 100;
    const clip = {
      x: Math.round(viewportBounds.x + (viewportBounds.width - displayWidth) / 2),
      y: Math.round(viewportBounds.y + (viewportBounds.height - displayHeight) / 2),
      width: Math.round(displayWidth), height: Math.round(displayHeight)
    };
    const capture = (file) => page.screenshot({ path: file, clip });
    await page.waitForTimeout(400);
    await capture(files['context-enabled']);
    await execute('layer.style.setEnabled', { layerId: setup.targetLayer.id, enabled: false });
    await page.waitForTimeout(250);
    await capture(files['context-bypassed']);
    await execute('layer.style.setEnabled', { layerId: setup.targetLayer.id, enabled: true });

    const byId = new Map(setup.layers.map((layer) => [layer.id, layer]));
    const visibleIds = [];
    let current = setup.targetLayer;
    while (current) {
      visibleIds.push(current.id);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    for (let offset = 0; offset < setup.layers.length; offset += 256) {
      await execute('layer.setVisibility', {
        layerIds: setup.layers.slice(offset, offset + 256).map(({ id }) => id), visible: false
      });
    }
    await execute('layer.setVisibility', { layerIds: visibleIds, visible: true });
    await page.waitForTimeout(250);
    await capture(files['solo-enabled']);
    await execute('layer.style.setEnabled', { layerId: setup.targetLayer.id, enabled: false });
    await page.waitForTimeout(250);
    await capture(files['solo-bypassed']);
    results.push({ ...target, source: sourceFile, files, effects: setup.effects, status: 'captured', pageErrors });
  } catch (error) {
    results.push({ ...target, source: sourceFile, status: 'failed',
      error: error instanceof Error ? error.stack ?? error.message : String(error), pageErrors });
  } finally {
    await app.close().catch(() => {});
  }
}

const manifestPath = path.join(outputDirectory, 'manifest.json');
await writeFile(manifestPath, `${JSON.stringify(results, null, 2)}\n`);
const failures = results.filter(({ status, pageErrors }) => status !== 'captured' || pageErrors.length);
if (failures.length) throw new Error(`LightTable layer-style capture failed; see ${manifestPath}.`);
process.stdout.write(`LightTable layer-style references: ${manifestPath}\n`);
