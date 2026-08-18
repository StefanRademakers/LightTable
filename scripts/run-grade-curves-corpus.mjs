import { spawnSync } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { parseGradeCorpusRunMode } from './grade-corpus-run-mode.mjs';
import {
  gradeCorpusReportsHaveSameCases,
  parseGradeCorpusReport
} from './grade-corpus-report-compatibility.mjs';

const workspace = path.resolve(import.meta.dirname, '..');
const corpus = JSON.parse(await readFile(path.join(import.meta.dirname, 'grade-camera-raw-corpus.json'), 'utf8'));
const casesPath = path.join(import.meta.dirname, 'grade-curves-parity-cases.json');
const argument = (name) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const root = path.resolve(argument('root') ?? corpus.externalRoot);
const selectedArgument = argument('source');
const selected = selectedArgument ? new Set(selectedArgument.split(',').map((value) => value.trim()).filter(Boolean)) : null;
const force = process.argv.includes('--force');
const { captureCameraRaw, captureLightTable } = parseGradeCorpusRunMode(process.argv);
const run = (command, args) => {
  const result = spawnSync(command, args, { cwd: workspace, stdio: 'inherit', shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status}.`);
};
const exists = (file) => access(file).then(() => true, () => false);
const reportsAreCompatible = async (cameraReport, lightTableReport) => {
  if (!await exists(cameraReport) || !await exists(lightTableReport)) return false;
  const [cameraRaw, lightTable] = await Promise.all([
    readFile(cameraReport, 'utf8').then(parseGradeCorpusReport),
    readFile(lightTableReport, 'utf8').then(parseGradeCorpusReport)
  ]);
  return gradeCorpusReportsHaveSameCases(cameraRaw, lightTable);
};
const inventoryPath = path.join(root, 'inventory.json');
if (!await exists(inventoryPath)) run(process.execPath, [path.join(import.meta.dirname, 'generate-grade-camera-raw-corpus.mjs'), `--root=${root}`]);
const inventory = JSON.parse(await readFile(inventoryPath, 'utf8'));
const sources = inventory.sources.filter(({ id }) => !selected || selected.has(id));
if (!sources.length) throw new Error('No Grade Curves corpus sources were selected.');

for (const source of sources) {
  const captureRoot = path.join(root, 'captures', 'curves', source.id);
  const cameraReport = path.join(captureRoot, 'camera-raw', 'capture-report.json');
  const lightTableReport = path.join(captureRoot, 'lighttable', 'capture-report.json');
  process.stdout.write(`\n=== Grade Curves corpus: ${source.id} ===\n`);
  if (captureCameraRaw) {
    if (force || !await exists(cameraReport)) run('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(import.meta.dirname, 'capture-camera-raw-grade-curves-oracle.ps1'), '-Source', source.file, '-Root', captureRoot, '-CasePath', casesPath]);
    else process.stdout.write('Camera Raw capture already exists; use --force to replace it.\n');
  }
  if (captureLightTable) {
    if (force || !await exists(lightTableReport)) run(process.execPath, [path.join(import.meta.dirname, 'capture-lighttable-grade-curves-oracle.mjs'), `--source=${source.file}`, `--root=${captureRoot}`, `--cases=${casesPath}`]);
    else process.stdout.write('LightTable capture already exists; use --force to replace it.\n');
  }
  if (await reportsAreCompatible(cameraReport, lightTableReport)) {
    run(process.execPath, [path.join(import.meta.dirname, 'analyze-grade-light-parity.mjs'), `--root=${captureRoot}`]);
    run(process.execPath, [path.join(import.meta.dirname, 'create-grade-parity-contact-sheets.mjs'), `--root=${captureRoot}`]);
  } else {
    process.stdout.write('Matching oracle case reports are required before analysis; capture retained for a later resume.\n');
  }
}
process.stdout.write(`\nCompleted Grade Curves corpus for ${sources.length} source(s).\n`);
