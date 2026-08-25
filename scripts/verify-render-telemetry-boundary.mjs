import { readdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';

const require = createRequire(import.meta.url);
const { extractFile, listPackage } = require('@electron/asar');
const root = path.resolve(import.meta.dirname, '..');
const expected = process.argv.includes('--present') ? 'present' : 'absent';
const assets = path.join(root, 'apps', 'desktop', '.vite', 'renderer', 'main_window', 'assets');
const signature = '__LIGHTTABLE_RENDER_TELEMETRY_COLLECTOR__';

const readLooseRendererCorpus = async () => {
  try {
    const files = (await readdir(assets)).filter((name) => name.endsWith('.js'));
    return (await Promise.all(files.map((name) => readFile(path.join(assets, name), 'utf8')))).join('\n');
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
};

const findAsar = async (directory) => {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = await findAsar(entryPath);
      if (nested) return nested;
    } else if (entry.name === 'app.asar') return entryPath;
  }
  return null;
};

const readPackagedRendererCorpus = async () => {
  const configuredOutput = process.env.LIGHTTABLE_PACKAGE_OUT || 'out';
  const output = path.isAbsolute(configuredOutput)
    ? configuredOutput
    : path.join(root, 'apps', 'desktop', configuredOutput);
  let asar;
  try {
    asar = await findAsar(output);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
  if (!asar) return null;
  const files = listPackage(asar).filter((entry) => {
    const normalized = entry.replaceAll('\\', '/');
    return normalized.includes('/.vite/renderer/main_window/assets/') && normalized.endsWith('.js');
  });
  return files.map((entry) => extractFile(asar, entry.replace(/^[/\\]+/u, '')).toString('utf8')).join('\n');
};

// A completed package is authoritative. The loose Vite directory can be
// absent after Forge finalization or can belong to a different prior profile.
const corpus = await readPackagedRendererCorpus() ?? await readLooseRendererCorpus();
if (corpus === null) {
  throw new Error('No packaged or loose desktop renderer bundle was found.');
}
const found = corpus.includes(signature);

if ((expected === 'present') !== found) {
  throw new Error(`Render telemetry collector should be ${expected} in the desktop renderer bundle.`);
}
process.stdout.write(`Render telemetry boundary passed: collector is ${expected}.\n`);
