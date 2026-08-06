import { _electron as electron } from 'playwright-core';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(import.meta.dirname, '..');
const desktop = path.join(root, 'apps', 'desktop');
const executable = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const output = path.join(root, 'tmp', 'screenshots', 'desktop-recents.png');
const userData = path.join(root, 'tmp', 'smoke-recents-user-data');
const iconDirectory = path.join(root, 'packages', 'lighttable-app', 'src', 'assets', 'icons');
const iconNames = [
  'add_adjustment_layer.png', 'add_group.png', 'add_layer.png', 'add_mask.png',
  'area_closed.png', 'area_open.png', 'arrow-left.png', 'arrow-right.png',
  'clipping_mask.png', 'close.png', 'erase.png', 'horizontal-line.png',
  'image.png', 'layer_adjustment.png', 'layer_group.png', 'layer_trash.png',
  'lens_fx.png', 'lens_fx_off.png'
];
const entries = [
  { id: 'missing-newest', path: path.join(root, 'missing', 'Moved document.lighttable'), openedAt: 10_000 },
  ...iconNames.map((name, index) => ({
    id: `recent-${index}`,
    path: path.join(iconDirectory, name),
    openedAt: 9_999 - index
  }))
];

await rm(userData, { recursive: true, force: true });
await Promise.all([mkdir(userData, { recursive: true }), mkdir(path.dirname(output), { recursive: true })]);
await writeFile(path.join(userData, 'recent-files.json'), JSON.stringify(entries, null, 2));

const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
let app;
try {
  app = await electron.launch({
    executablePath: executable,
    args: [desktop],
    cwd: root,
    env: { ...environment, LIGHTTABLE_AUTOMATION_USER_DATA: userData },
    timeout: 30_000
  });
  const window = await app.firstWindow({ timeout: 30_000 });
  const cards = window.locator('.lighttable-launcher__recent');
  await cards.first().waitFor({ state: 'visible', timeout: 30_000 });
  if (await cards.count() !== 15) throw new Error(`Expected 15 launcher recents, got ${await cards.count()}.`);
  if (await cards.first().locator('.lighttable-launcher__recent-name').textContent() !== 'Moved document.lighttable') {
    throw new Error('Recent documents are not newest first.');
  }
  await cards.first().getByText('File missing').waitFor({ state: 'visible' });
  await cards.first().getByRole('button', { name: /Remove missing recent file/i }).waitFor({ state: 'visible' });
  await window.locator('.lighttable-launcher__recent-preview img').first().waitFor({ state: 'visible', timeout: 15_000 });
  const geometry = await window.locator('.lighttable-launcher__recent-preview').nth(1).evaluate((preview) => {
    const image = preview.querySelector('img');
    const bounds = preview.getBoundingClientRect();
    const imageBounds = image?.getBoundingClientRect();
    return {
      square: Math.abs(bounds.width - bounds.height) < 1,
      contained: Boolean(imageBounds
        && imageBounds.width <= bounds.width + 0.5
        && imageBounds.height <= bounds.height + 0.5),
      fit: image ? getComputedStyle(image).objectFit : ''
    };
  });
  if (!geometry.square || !geometry.contained || geometry.fit !== 'contain') {
    throw new Error(`Recent thumbnail geometry failed: ${JSON.stringify(geometry)}`);
  }
  await window.screenshot({ path: output });
  await cards.first().getByRole('button', { name: /Remove missing recent file/i }).click();
  await window.waitForFunction(() => document.querySelectorAll('.lighttable-launcher__recent').length === 15
    && !document.body.textContent?.includes('Moved document.lighttable'));
  process.stdout.write(`Desktop recents smoke passed: ${output}\n`);
} finally {
  await app?.close().catch(() => undefined);
}
