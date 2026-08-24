import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(import.meta.dirname, '..');
const expected = process.argv.includes('--present') ? 'present' : 'absent';
const assets = path.join(root, 'apps', 'desktop', '.vite', 'renderer', 'main_window', 'assets');
const signature = '__LIGHTTABLE_RENDER_TELEMETRY_COLLECTOR__';
const files = (await readdir(assets)).filter((name) => name.endsWith('.js'));
const corpus = (await Promise.all(files.map((name) => readFile(path.join(assets, name), 'utf8')))).join('\n');
const found = corpus.includes(signature);

if ((expected === 'present') !== found) {
  throw new Error(`Render telemetry collector should be ${expected} in the desktop renderer bundle.`);
}
process.stdout.write(`Render telemetry boundary passed: collector is ${expected}.\n`);
