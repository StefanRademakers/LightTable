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
    Foundations: ['.lighttable-ui-guide__type-stack', '.lighttable-ui-guide__geometry',
      '.lighttable-ui-guide__swatches'],
    Actions: ['.action-button', '.action-button--control', '.square-icon-button'],
    Fields: ['.form-input', '.lighttable-style-field', '.lighttable-file-field'],
    Selection: ['.switch-control', '.segmented-control', '.segmented-control--low-attention'],
    Sliders: ['.lighttable-adjustment--stacked', '.lighttable-adjustment--inline',
      '.lighttable-adjustment--bare', '.lighttable-adjustment--layer-row',
      '.lighttable-adjustment--tool-bar', '.lighttable-adjustment--tool-panel',
      '.opacity-slider', '.lighttable-levels__track'],
    'Paint & color': ['.color-swatch-field', '.lighttable-color-picker-prototype',
      '.gradient-field', '.none-paint-field'],
    Gradients: ['.gradient-field--regular', '.gradient-field--compact', '.lighttable-style-gradient'],
    'Lists & navigation': ['.context-menu--specimen', '.lighttable-ui-guide__split-menu',
      '[role="listbox"]', '[role="tree"]', '[role="tablist"]'],
    Containers: ['.lighttable-group', '.lighttable-property-stack',
      '.lighttable-ui-guide__toolbar-group', '.lighttable-ui-guide__popover-specimen'],
    'Layout & geometry': ['.lighttable-ui-guide__spacing-scale',
      '.lighttable-ui-guide__property-widths', '.lighttable-ui-guide__workspace-geometry'],
    Feedback: ['.lighttable-style-notice', '.lighttable-ui-guide__feedback--success',
      '.lighttable-ui-guide__feedback--error', '.lighttable-panel__empty'],
    'Adjustment dialogs': ['.lighttable-adjustment-dialog', '.lighttable-curves-editor',
      '.lighttable-adjustment-visual', '.lighttable-adjustment-color-range'],
    Dialogs: ['.lighttable-ui-guide__dialog-specimen', '.modal__header', '.modal__footer']
  };
  let fieldFocusPresentation = null;
  let paintFieldGeometry = null;
  let actionGeometry = null;
  let sliderGeometry = null;
  let layoutGeometry = null;
  for (const [category, selectors] of Object.entries(categories)) {
    await dialog.getByRole('button', { name: category, exact: true }).click();
    for (const selector of selectors) {
      await dialog.locator(selector).first().waitFor({ state: 'visible' });
    }
    if (category === 'Actions') {
      const densitySample = dialog.locator('.lighttable-ui-guide__sample')
        .filter({ hasText: 'One button component' });
      const stateSample = dialog.locator('.lighttable-ui-guide__sample')
        .filter({ hasText: 'States - geometry' });
      actionGeometry = {
        densityHeights: await densitySample.locator('.action-button').evaluateAll((buttons) => (
          buttons.map((button) => Math.round(button.getBoundingClientRect().height))
        )),
        stateHeights: await stateSample.locator('.action-button').evaluateAll((buttons) => (
          buttons.map((button) => Math.round(button.getBoundingClientRect().height))
        ))
      };
      if (JSON.stringify(actionGeometry.densityHeights) !== JSON.stringify([36, 28, 24])
        || actionGeometry.stateHeights.some((height) => height !== 28)) {
        throw new Error(`Button geometry drifted: ${JSON.stringify(actionGeometry)}`);
      }
    }
    if (category === 'Fields') {
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
    if (category === 'Sliders') {
      sliderGeometry = await dialog.evaluate((element) => {
        const width = (selector) => Math.round(
          element.querySelector(selector)?.getBoundingClientRect().width ?? 0
        );
        return {
          stacked: width('.lighttable-adjustment--stacked'),
          layerRow: width('.lighttable-adjustment--layer-row'),
          toolBar: width('.lighttable-adjustment--tool-bar'),
          toolPanel: width('.lighttable-adjustment--tool-panel')
        };
      });
      if (sliderGeometry.toolBar !== 148
        || sliderGeometry.layerRow !== sliderGeometry.stacked
        || sliderGeometry.toolPanel !== sliderGeometry.stacked) {
        throw new Error(`Slider variants drifted: ${JSON.stringify(sliderGeometry)}`);
      }
    }
    if (category === 'Paint & color') {
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
    if (category === 'Layout & geometry') {
      layoutGeometry = await dialog.locator('.lighttable-ui-guide__sample-content').evaluate((content) => {
        const size = (selector) => {
          const element = content.querySelector(selector);
          if (!element) return null;
          const bounds = element.getBoundingClientRect();
          return { width: Math.round(bounds.width), height: Math.round(bounds.height) };
        };
        return {
          propertyWidths: [...content.querySelectorAll('.lighttable-ui-guide__property-frame')]
            .map((element) => Math.round(element.getBoundingClientRect().width)),
          menubar: size('.lighttable-ui-guide__workspace-menubar'),
          toolbar: size('.lighttable-ui-guide__workspace-toolbar'),
          toolRail: size('.lighttable-ui-guide__workspace-body > aside'),
          panel: size('.lighttable-ui-guide__workspace-body > section'),
          statusbar: size('.lighttable-ui-guide__workspace-status')
        };
      });
      if (JSON.stringify(layoutGeometry.propertyWidths) !== JSON.stringify([220, 260, 320])
        || layoutGeometry.menubar?.height !== 36 || layoutGeometry.toolbar?.height !== 38
        || layoutGeometry.toolRail?.width !== 38 || layoutGeometry.panel?.width !== 260
        || layoutGeometry.statusbar?.height !== 32) {
        throw new Error(`Layout geometry drifted: ${JSON.stringify(layoutGeometry)}`);
      }
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
    const categorySlug = category.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-').replaceAll(/^-|-$/g, '');
    await dialog.screenshot({ path: path.join(output, `${categorySlug}.png`) });
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
    sourceFile, fieldFocusPresentation, paintFieldGeometry, actionGeometry, sliderGeometry, layoutGeometry,
    aboutGeometry, pageErrors
  }, null, 2)}\n`);
  console.log(`UI Style Guide smoke passed. Output: ${output}`);
} finally {
  await app.close();
}
