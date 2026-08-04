import { _electron as electron } from 'playwright-core';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const workspaceRoot = path.resolve(import.meta.dirname, '..');
const sourceFile = path.resolve(process.argv[2] ?? 'D:\\shapes.psd');
const executablePath = path.join(workspaceRoot, 'node_modules', 'electron', 'dist', 'electron.exe');
const outputDirectory = path.join(workspaceRoot, 'tmp', 'pen-tools-smoke');
const userDataPath = path.join(outputDirectory, `user-data-${process.pid}`);
const screenshotPath = path.join(outputDirectory, 'pen-tools.png');
const reportPath = path.join(outputDirectory, 'pen-tools.json');

await Promise.all([access(sourceFile), access(executablePath), mkdir(userDataPath, { recursive: true })]);
const launchEnvironment = { ...process.env };
delete launchEnvironment.ELECTRON_RUN_AS_NODE;
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

try {
  const page = await app.firstWindow({ timeout: 30_000 });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
  await page.getByRole('button', { name: 'Open file' }).click();
  await page.locator('.lighttable-toolbar__meta').filter({ hasText: /ready/i })
    .waitFor({ state: 'visible', timeout: 60_000 });

  await page.keyboard.press('p');
  const group = page.locator('.lighttable-toolbox__group').filter({
    has: page.getByRole('button', { name: 'Show pen tools' })
  });
  const master = group.locator(':scope > .lighttable-toolbox__button');
  await master.waitFor({ state: 'visible' });
  if (await master.getAttribute('aria-pressed') !== 'true') {
    throw new Error('P did not activate the Pen tool.');
  }

  await master.click();
  const family = page.getByRole('toolbar', { name: 'Pen tools' });
  await family.waitFor({ state: 'visible' });
  for (const name of ['Pen (P)', 'Add anchor point', 'Delete anchor point', 'Convert anchor point']) {
    await family.getByRole('button', { name }).waitFor({ state: 'visible' });
  }

  await family.getByRole('button', { name: 'Add anchor point' }).click();
  const rememberedMaster = group.locator(':scope > .lighttable-toolbox__button');
  await rememberedMaster.waitFor({ state: 'visible' });
  if (await rememberedMaster.getAttribute('aria-label') !== 'Add anchor point') {
    throw new Error('The selected anchor tool was not shown in the grouped slot.');
  }
  if (await rememberedMaster.getAttribute('aria-pressed') !== 'true') {
    throw new Error('The selected anchor tool was not projected into the grouped slot.');
  }

  await rememberedMaster.click();
  await family.waitFor({ state: 'visible' });
  await page.screenshot({ path: screenshotPath });
  await page.keyboard.press('Shift+p');
  if (await master.getAttribute('aria-label') !== 'Pen (P)') {
    throw new Error('Shift+P did not cycle back to the Pen tool.');
  }

  if (pageErrors.length) throw new Error(`Page errors: ${JSON.stringify(pageErrors)}`);
  await writeFile(reportPath, `${JSON.stringify({ sourceFile, pageErrors, screenshotPath }, null, 2)}\n`);
  process.stdout.write(`Pen-tools smoke passed. Report: ${reportPath}\n`);
} finally {
  await app.close().catch(() => {});
}
