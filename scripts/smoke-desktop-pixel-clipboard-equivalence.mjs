import { _electron as electron } from 'playwright-core';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { resolveDesktopTestLaunch, waitForDesktopLauncher } from './desktop-test-startup.mjs';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';
import { startPackagedMcpTestSession } from './packaged-mcp-test-session.mjs';
import { runPixelClipboardRouteEquivalence } from './pixel-clipboard-route-equivalence.mjs';

const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, 'tmp', 'pixel-clipboard-equivalence');
await mkdir(output, { recursive: true });
const userData = await mkdtemp(path.join(output, 'profile-'));
const launch = await resolveDesktopTestLaunch(root, { requirePackaged: true });
const mcpSession = await startPackagedMcpTestSession({ label: 'Pixel clipboard equivalence' });
const environment = { ...process.env, ...mcpSession.desktopEnvironment };
delete environment.ELECTRON_RUN_AS_NODE;
const pageErrors = [];
let app;

try {
  app = await electron.launch({ executablePath: launch.executablePath, args: launch.args,
    cwd: root, env: { ...environment, LIGHTTABLE_AUTOMATION_USER_DATA: userData }, timeout: 30_000 });
  const page = await app.firstWindow({ timeout: 30_000 });
  page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
  await waitForDesktopLauncher({ app, page, outputDirectory: output,
    sourceFile: null, pageErrors, label: 'pixel-clipboard-equivalence' });
  const driver = await attachLightTableAutomation(page, 'pixel-clipboard-equivalence');
  const created = await driver.executeWorkspace('document.create', {
    name: 'Pixel clipboard route', width: 256, height: 192, resolutionPpi: 72,
    bitDepth: 8, profile: 'srgb', background: { kind: 'solid', color: '#386aa8' }
  });
  const documentId = created.value?.documentId;
  assert.ok(documentId, 'Pixel clipboard setup returned no document ID.');
  await driver.waitForRenderedDocument(documentId, 60_000);
  const mcp = await mcpSession.pairAndAuthorize(page);

  const evidence = await runPixelClipboardRouteEquivalence({ page, driver, mcp, output });
  if (pageErrors.length) throw new Error(`Page errors: ${JSON.stringify(pageErrors)}`);
  await writeFile(path.join(output, 'report.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  process.stdout.write(`Packaged pixel clipboard equivalence passed: ${output}\n`);
} finally {
  await app?.close().catch(() => {});
  await mcpSession.close().catch(() => {});
}
