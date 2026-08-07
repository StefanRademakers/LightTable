import { _electron as electron } from 'playwright-core';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(import.meta.dirname, '..');
const sourceFile = path.resolve(process.argv[2] ?? 'D:\\adamus2__0002.png');
const output = path.join(root, 'tmp', 'screen-mode-smoke');
const executablePath = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const reportPath = path.join(output, 'report.json');

await Promise.all([access(sourceFile), access(executablePath), mkdir(output, { recursive: true })]);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath,
  args: [path.join(root, 'apps', 'desktop')],
  cwd: root,
  env: {
    ...env,
    LIGHTTABLE_AUTOMATION_OPEN_FILE: sourceFile,
    LIGHTTABLE_AUTOMATION_USER_DATA: path.join(output, `user-data-${process.pid}`)
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

  await page.screenshot({ path: path.join(output, '01-normal.png') });
  const normalViewport = page.viewportSize();
  await page.keyboard.press('f');
  await page.waitForTimeout(350);
  await page.screenshot({ path: path.join(output, '02-fullscreen.png') });
  const fullscreenViewport = page.viewportSize();

  await page.keyboard.press('f');
  await page.locator('.lighttable--canvas-only').waitFor({ state: 'visible' });
  await page.waitForTimeout(500);
  const canvasOnlyGeometry = await page.evaluate(() => {
    const workspace = document.querySelector('.lighttable-dock-workspace').getBoundingClientRect();
    const documentHost = document.querySelector('.lighttable-document-host');
    const documentGroupElement = documentHost?.closest('.dv-groupview') ?? documentHost;
    if (!documentGroupElement) throw new Error('Canvas-only document host is unavailable.');
    const documentGroup = documentGroupElement.getBoundingClientRect();
    const visibleAccessoryGroups = [...document.querySelectorAll('.dv-groupview')]
      .filter((group) => !group.querySelector('.lighttable-document-host'))
      .filter((group) => {
        const style = getComputedStyle(group);
        const bounds = group.getBoundingClientRect();
        return style.visibility !== 'hidden' && bounds.width > 0 && bounds.height > 0;
      }).length;
    return {
      workspace: { left: workspace.left, top: workspace.top, right: workspace.right, bottom: workspace.bottom },
      documentGroup: {
        left: documentGroup.left,
        top: documentGroup.top,
        right: documentGroup.right,
        bottom: documentGroup.bottom
      },
      visibleAccessoryGroups
    };
  });
  const { workspace, documentGroup } = canvasOnlyGeometry;
  if (Math.abs(documentGroup.left - workspace.left) > 1
    || Math.abs(documentGroup.top - workspace.top) > 1
    || Math.abs(documentGroup.right - workspace.right) > 1
    || Math.abs(documentGroup.bottom - workspace.bottom) > 1) {
    throw new Error(`Canvas-only document does not fill the workspace: ${JSON.stringify(canvasOnlyGeometry)}`);
  }
  await page.screenshot({ path: path.join(output, '03-canvas-only.png') });

  await page.keyboard.press('f');
  await page.locator('.lighttable--canvas-only').waitFor({ state: 'detached' });
  await page.waitForFunction(() => [...document.querySelectorAll('.dv-groupview')]
    .some((group) => !group.querySelector('.lighttable-document-host')
      && group.getBoundingClientRect().width > 0
      && getComputedStyle(group).visibility !== 'hidden'));
  await page.screenshot({ path: path.join(output, '04-restored.png') });
  if (pageErrors.length) throw new Error(`Renderer errors: ${JSON.stringify(pageErrors)}`);

  await writeFile(reportPath, `${JSON.stringify({
    sourceFile,
    normalViewport,
    fullscreenViewport,
    canvasOnlyGeometry,
    pageErrors
  }, null, 2)}\n`);
  console.log(`Screen-mode smoke passed. Report: ${reportPath}`);
} finally {
  await app.close();
}
