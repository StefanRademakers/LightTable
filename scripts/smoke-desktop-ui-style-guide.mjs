import { _electron as electron } from 'playwright-core';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(import.meta.dirname, '..');
const sourceFile = path.resolve(process.argv[2] ?? 'D:\\adamus2__0002.png');
const output = path.join(root, 'tmp', 'ui-style-guide-smoke');
const executablePath = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
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
  await page.getByRole('menuitem', { name: 'View', exact: true }).click();
  await page.getByRole('menuitem', { name: 'UI Style Guide...', exact: true }).click();

  const dialog = page.getByRole('dialog', { name: 'UI Style Guide' });
  await dialog.waitFor({ state: 'visible' });
  const categories = {
    Typography: ['.lighttable-ui-guide__type-stack', '.form-input'],
    Actions: ['.action-button', '.square-icon-button'],
    Inputs: ['.form-input', '.lighttable-style-field', '.lighttable-style-toggle',
      '.switch-control', '.segmented-control'],
    Paint: ['.color-swatch-field', '.lighttable-color-picker-prototype', '.gradient-field'],
    'Panel controls': ['.lighttable-adjustment', '.lighttable-style-angle', '.lighttable-style-advanced'],
    Dialogs: ['.lighttable-ui-guide__dialog-specimen', '.modal__header', '.modal__footer']
  };
  let fieldFocusPresentation = null;
  for (const [category, selectors] of Object.entries(categories)) {
    await dialog.getByRole('button', { name: category, exact: true }).click();
    for (const selector of selectors) {
      await dialog.locator(selector).first().waitFor({ state: 'visible' });
    }
    if (category === 'Inputs') {
      await dialog.locator('select').focus();
      await dialog.screenshot({ path: path.join(output, 'fields-select-focus.png') });
      const field = dialog.locator('.form-input').first();
      const restingBorderColor = await field.evaluate((element) => getComputedStyle(element).borderColor);
      await field.focus();
      fieldFocusPresentation = await field.evaluate((element, resting) => {
        const style = getComputedStyle(element);
        return {
          focused: document.activeElement === element,
          restingBorderColor: resting,
          focusBorderColor: style.borderColor,
          outlineStyle: style.outlineStyle,
          borderWidth: style.borderWidth
        };
      }, restingBorderColor);
      if (!fieldFocusPresentation.focused || fieldFocusPresentation.outlineStyle !== 'none'
        || fieldFocusPresentation.borderWidth !== '1px'
        || fieldFocusPresentation.focusBorderColor === fieldFocusPresentation.restingBorderColor) {
        throw new Error(`Text field focus does not reuse its border: ${JSON.stringify(fieldFocusPresentation)}`);
      }
    }
    await dialog.screenshot({ path: path.join(output, `${category.toLowerCase()}.png`) });
  }
  await dialog.locator(':scope > .lighttable-preferences__footer')
    .getByRole('button', { name: 'Close', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
  await page.getByRole('menuitem', { name: 'Help', exact: true }).click();
  await page.getByRole('menuitem', { name: 'About LightTable...', exact: true }).click();
  const about = page.getByRole('dialog', { name: 'About LightTable' });
  await about.waitFor({ state: 'visible' });
  await about.locator('.modal__header').waitFor({ state: 'visible' });
  await about.locator('.lighttable-about__body').waitFor({ state: 'visible' });
  await about.locator('.modal__footer').waitFor({ state: 'visible' });
  const aboutGeometry = await about.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const rows = [...element.querySelectorAll('dl > div')].map((row) => {
      const style = getComputedStyle(row);
      return { display: style.display, columns: style.gridTemplateColumns };
    });
    return { width: bounds.width, height: bounds.height, rows };
  });
  if (aboutGeometry.height > 460 || aboutGeometry.rows.some(({ display }) => display !== 'grid')) {
    throw new Error(`About dialog does not follow the compact dialog grid: ${JSON.stringify(aboutGeometry)}`);
  }
  await about.screenshot({ path: path.join(output, 'about-dialog.png') });
  await about.getByRole('button', { name: 'Close', exact: true }).click();
  await about.waitFor({ state: 'detached' });
  if (pageErrors.length) throw new Error(`Renderer errors: ${JSON.stringify(pageErrors)}`);
  await writeFile(path.join(output, 'report.json'), `${JSON.stringify({
    sourceFile, fieldFocusPresentation, aboutGeometry, pageErrors
  }, null, 2)}\n`);
  console.log(`UI Style Guide smoke passed. Output: ${output}`);
} finally {
  await app.close();
}
