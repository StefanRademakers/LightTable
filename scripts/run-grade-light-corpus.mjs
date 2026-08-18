import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { parseGradeCorpusRunMode } from './grade-corpus-run-mode.mjs';
import {
  gradeCorpusReportsHaveSameCases,
  gradeCorpusReportMatchesCapture,
  parseGradeCorpusReport
} from './grade-corpus-report-compatibility.mjs';
import { packagedDesktopExecutable } from './desktop-test-startup.mjs';

const workspace = path.resolve(import.meta.dirname, '..');
const manifest = JSON.parse(await readFile(
  path.join(import.meta.dirname, 'grade-camera-raw-corpus.json'), 'utf8'
));
const rootArgument = process.argv.find((value) => value.startsWith('--root='));
const sourceArgument = process.argv.find((value) => value.startsWith('--source='));
const refreshControlArgument = process.argv.find((value) => value.startsWith('--refresh-control='));
const refreshControl = refreshControlArgument?.slice('--refresh-control='.length) ?? null;
const force = process.argv.includes('--force');
const { captureCameraRaw, captureLightTable } = parseGradeCorpusRunMode(process.argv);
const externalRoot = path.resolve(rootArgument?.slice('--root='.length) ?? manifest.externalRoot);
const inventoryPath = path.join(externalRoot, 'inventory.json');
const packagedExecutable = packagedDesktopExecutable(workspace);
const casesPath = path.join(import.meta.dirname, 'grade-light-parity-cases.json');
const caseManifestSha256 = createHash('sha256').update(await readFile(casesPath)).digest('hex');

const run = (command, args) => {
  const result = spawnSync(command, args, {
    cwd: workspace,
    stdio: 'inherit',
    shell: false,
    env: {
      ...process.env,
      LIGHTTABLE_AUTOMATION_HEADLESS: '1',
      LIGHTTABLE_TEST_EXECUTABLE: packagedExecutable
    }
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status}.`);
};
const exists = async (file) => access(file).then(() => true, () => false);
const reportsAreCompatible = async (cameraReport, lightTableReport) => {
  if (!await exists(cameraReport) || !await exists(lightTableReport)) return false;
  const [cameraRaw, lightTable] = await Promise.all([
    readFile(cameraReport, 'utf8').then(parseGradeCorpusReport),
    readFile(lightTableReport, 'utf8').then(parseGradeCorpusReport)
  ]);
  return gradeCorpusReportsHaveSameCases(cameraRaw, lightTable);
};
const reportIsCurrent = async (file, source) => {
  if (!await exists(file)) return false;
  try {
    return gradeCorpusReportMatchesCapture(
      parseGradeCorpusReport(await readFile(file, 'utf8')),
      { section: 'light', caseManifestSha256, sourceSha256: source.sha256 }
    );
  } catch { return false; }
};

if (!await exists(inventoryPath)) run(process.execPath, [
  path.join(import.meta.dirname, 'generate-grade-camera-raw-corpus.mjs'), `--root=${externalRoot}`
]);
if (!await exists(packagedExecutable)) {
  throw new Error(`Packaged LightTable executable is missing: ${packagedExecutable}. Run npm run package:desktop:verify first.`);
}
const inventory = JSON.parse(await readFile(inventoryPath, 'utf8'));
const selected = sourceArgument
  ? new Set(sourceArgument.slice('--source='.length).split(',').map((value) => value.trim()).filter(Boolean))
  : null;
const sources = inventory.sources.filter(({ id }) => !selected || selected.has(id));
if (!sources.length) throw new Error('No Grade Light corpus sources were selected.');

for (const source of sources) {
  const captureRoot = path.join(externalRoot, 'captures', 'light', source.id);
  const cameraReport = path.join(captureRoot, 'camera-raw', 'capture-report.json');
  const lightTableReport = path.join(captureRoot, 'lighttable', 'capture-report.json');
  process.stdout.write(`\n=== Grade Light corpus: ${source.id} ===\n`);
  if (captureCameraRaw && (force || !await reportIsCurrent(cameraReport, source))) {
    run('powershell', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
      path.join(import.meta.dirname, 'capture-camera-raw-grade-light-oracle.ps1'),
      '-Source', source.file, '-Root', captureRoot
    ]);
  } else if (captureCameraRaw) {
    process.stdout.write('Current Camera Raw capture already exists; use --force to replace it.\n');
  }
  if (captureLightTable && (force || refreshControl || !await reportIsCurrent(lightTableReport, source))) {
    run(process.execPath, [
      path.join(import.meta.dirname, 'capture-lighttable-grade-light-oracle.mjs'),
      `--source=${source.file}`, `--root=${captureRoot}`, '--packaged', '--resume-partial',
      ...(refreshControl ? [`--refresh-control=${refreshControl}`] : [])
    ]);
  } else if (captureLightTable) {
    process.stdout.write('Current LightTable capture already exists; use --force to replace it.\n');
  }
  if (await reportsAreCompatible(cameraReport, lightTableReport)) {
    run(process.execPath, [path.join(import.meta.dirname, 'analyze-grade-light-parity.mjs'), `--root=${captureRoot}`]);
    run(process.execPath, [path.join(import.meta.dirname, 'create-grade-parity-contact-sheets.mjs'), `--root=${captureRoot}`]);
  } else {
    process.stdout.write('Matching oracle case reports are required before analysis; capture retained for a later resume.\n');
  }
}

process.stdout.write(`\nCompleted Grade Light corpus for ${sources.length} source(s).\n`);
