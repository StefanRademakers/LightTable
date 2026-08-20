import { _electron as electron } from 'playwright-core';
import { access, mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { resolveDesktopTestLaunch, waitForDesktopLauncher } from './desktop-test-startup.mjs';

const root = path.resolve(import.meta.dirname, '..');
const fixture = path.resolve(process.argv[2] ?? 'D:\\shapes.psd');
const output = path.join(root, 'tmp', 'async-actions-smoke');
await Promise.all([access(fixture), mkdir(output, { recursive: true })]);
const userData = await mkdtemp(path.join(output, 'profile-'));
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
const launch = await resolveDesktopTestLaunch(root, { requirePackaged: true });
let app;
const pageErrors = [];
try {
  app = await electron.launch({ executablePath: launch.executablePath, args: launch.args,
    cwd: root, env: { ...environment, LIGHTTABLE_AUTOMATION_USER_DATA: userData,
      LIGHTTABLE_AUTOMATION_OPEN_FILE: fixture }, timeout: 30_000 });
  const window = await app.firstWindow({ timeout: 30_000 });
  window.on('pageerror', (error) => pageErrors.push(error.message));
  const open = await waitForDesktopLauncher({ app, page: window, outputDirectory: output,
    sourceFile: fixture, pageErrors, label: 'async-actions' });
  await open.click();
  await window.locator('.lighttable-toolbar__meta').filter({ hasText: /ready/i })
    .waitFor({ timeout: 60_000 });
  const artifactsBefore = await window.evaluate(() =>
    window.__lightTableAutomation?.listArtifacts().length ?? -1);

  await window.getByRole('menuitem', { name: 'View' }).click();
  await window.getByRole('menuitem', { name: 'Actions panel' }).click();
  const panel = window.getByRole('complementary', { name: 'Actions' });
  const recorder = panel.locator('.lighttable-action-recorder');
  await recorder.getByRole('button', { name: 'Record' }).click();
  await panel.getByRole('radio', { name: 'Commands' }).click();
  await panel.getByRole('searchbox', { name: 'Search commands' }).fill('Export LightTable');
  const exportCommand = panel.locator('details').filter({ hasText: 'file.exportNative' });
  await exportCommand.locator('summary').click();
  await exportCommand.getByRole('button', { name: 'Run' }).click();
  await panel.getByRole('status').filter({ hasText: 'file.exportNative: accepted' })
    .waitFor({ timeout: 30_000 });
  await panel.getByRole('radio', { name: 'Actions' }).click();
  const exportStep = recorder.locator('li').filter({ hasText: 'file.exportNative' });
  await exportStep.waitFor();
  if (!await exportStep.locator('details').getAttribute('open')) await exportStep.locator('summary').click();
  await window.waitForFunction(() => {
    const step = [...document.querySelectorAll('.lighttable-action-recorder li')]
      .find((node) => node.textContent?.includes('file.exportNative'));
    return step?.textContent?.includes('artifact') && step.textContent.includes('native-document');
  }, null, { timeout: 30_000 });
  await recorder.getByRole('button', { name: 'Stop' }).click();
  if (await exportStep.getByText('accepted', { exact: true }).count() !== 1) {
    throw new Error(`The recorded async step lost its accepted outcome: ${await exportStep.textContent()}`);
  }

  await recorder.getByRole('button', { name: 'Play', exact: true }).click();
  await recorder.getByRole('status').filter({ hasText: 'Playback: completed' })
    .waitFor({ timeout: 60_000 }).catch(async () => {
      const evidence = await window.evaluate(() => {
        const driver = window.__lightTableAutomation;
        const documentId = driver?.queryWorkspace().activeDocumentId;
        return { recorder: document.querySelector('.lighttable-action-recorder')?.textContent,
          document: documentId ? driver?.queryDocument(documentId) : null,
          artifacts: driver?.listArtifacts(), body: document.body.innerText.slice(-2500) };
      });
      throw new Error(`Async Action playback did not complete: ${JSON.stringify({
        evidence, pageErrors
      })}`);
    });
  const artifactsAfter = await window.evaluate(() =>
    window.__lightTableAutomation?.listArtifacts().length ?? -1);
  if (artifactsBefore < 0 || artifactsAfter !== artifactsBefore + 2) {
    throw new Error(`Async Action did not publish one artifact per run: ${JSON.stringify({
      artifactsBefore, artifactsAfter
    })}`);
  }
  if (await recorder.locator('li').count() !== 1) {
    throw new Error('Async playback recursively changed the one-step recording.');
  }
  if (pageErrors.length) throw new Error(`Async Actions page errors: ${pageErrors.join(' | ')}`);
  console.log('Desktop task-aware Actions smoke passed.');
} finally {
  await app?.close();
}
