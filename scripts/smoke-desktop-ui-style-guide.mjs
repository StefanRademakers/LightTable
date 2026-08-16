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
    Paint: ['.color-swatch-field', '.lighttable-color-picker-prototype', '.gradient-field',
      '.none-paint-field', '.opacity-slider .lighttable-adjustment'],
    'Panel controls': ['.lighttable-adjustment', '.lighttable-style-angle', '.lighttable-style-advanced'],
    'Adjustment dialogs': ['.lighttable-adjustment-dialog', '.lighttable-curves-editor',
      '.lighttable-adjustment-visual', '.lighttable-adjustment-color-range'],
    Dialogs: ['.lighttable-ui-guide__dialog-specimen', '.modal__header', '.modal__footer']
  };
  let fieldFocusPresentation = null;
  let paintFieldGeometry = null;
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
    if (category === 'Paint') {
      paintFieldGeometry = await dialog.locator('.lighttable-ui-guide__control-table').evaluate((table) => {
        const fields = [...table.querySelectorAll(
          '.color-swatch-field, .gradient-field, .none-paint-field'
        )].map((element) => {
          const bounds = element.getBoundingClientRect();
          return { className: element.className, width: bounds.width, height: bounds.height };
        });
        const rows = [...table.querySelectorAll('.lighttable-ui-guide__control-row')]
          .map((row) => getComputedStyle(row).gridTemplateColumns);
        return { fields, rows };
      });
      if (paintFieldGeometry.fields.some(({ width, height }) => width !== 104 || height !== 28)
        || paintFieldGeometry.fields.length !== 4 || paintFieldGeometry.rows.length !== 4) {
        throw new Error(`Paint fields are not aligned: ${JSON.stringify(paintFieldGeometry)}`);
      }
      await dialog.getByRole('button', { name: 'Open color dropdown', exact: true }).click();
      await page.locator('.color-swatch-field__popover').waitFor({ state: 'visible' });
      await page.keyboard.press('Escape');
      await page.locator('.color-swatch-field__popover').waitFor({ state: 'detached' });
    }
    if (category === 'Adjustment dialogs') {
      const adjustmentNames = await dialog.locator('.lighttable-ui-guide__sample > h5').allTextContents();
      if (adjustmentNames.length !== 18
        || !adjustmentNames.includes('Curves - Ctrl+M')
        || !adjustmentNames.includes('Levels - Ctrl+L')
        || !adjustmentNames.includes('Hue/Saturation - Ctrl+U')
        || !adjustmentNames.includes('Color Balance - Ctrl+B')
        || !adjustmentNames.includes('Black & White - Shift+Ctrl+Alt+B')
        || !adjustmentNames.includes('Invert - Ctrl+I')
        || !adjustmentNames.includes('Gradient Map')
        || !adjustmentNames.includes('Grain')) {
        throw new Error(`Adjustment dialog catalog is incomplete: ${JSON.stringify(adjustmentNames)}`);
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
    sourceFile, fieldFocusPresentation, paintFieldGeometry, aboutGeometry, pageErrors
  }, null, 2)}\n`);
  console.log(`UI Style Guide smoke passed. Output: ${output}`);
} finally {
  await app.close();
}
