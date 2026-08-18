import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const workspace = path.resolve(import.meta.dirname, '..');
const suitePath = path.join(
  workspace, 'architecture', 'reference', 'implementation', 'adjustment-parity-suite.json'
);
const suite = JSON.parse(await readFile(suitePath, 'utf8'));
const corpusRoot = path.resolve(process.env.LIGHTTABLE_ADJUSTMENT_PARITY_ROOT
  ?? 'D:\\mediavibe\\LightTableTests\\AdjustmentParity');
const capture = process.argv.includes('--capture');
const regressionsOnly = process.argv.includes('--regressions-only');
const filterArgument = process.argv.find((value) => value.startsWith('--filter='));
const filter = filterArgument ? new RegExp(filterArgument.slice('--filter='.length), 'iu') : null;
const selected = suite.corpora.filter((entry) => !filter
  || filter.test(entry.adjustment) || filter.test(entry.root));
const report = [];
const packagedExecutable = path.join(
  workspace, 'apps', 'desktop', 'out', 'LightTable-win32-x64', 'LightTable.exe'
);

if (capture && process.platform === 'win32') {
  // A `.cmd` file is not a native executable. Recent Node releases can return
  // `{ status: null, error: EINVAL }` when it is passed directly to spawnSync,
  // which used to make a current-product capture fail before packaging even
  // started. An npm-launched script already publishes the exact CLI module;
  // execute that module with the current Node binary and retain a shell-backed
  // fallback for direct `node scripts/...` invocations.
  const npmCli = process.env.npm_execpath;
  const packaged = spawnSync(
    npmCli ? process.execPath : 'npm.cmd',
    npmCli
      ? [npmCli, 'run', 'package:desktop:verify']
      : ['run', 'package:desktop:verify'],
    {
      cwd: workspace,
      encoding: 'utf8',
      stdio: 'inherit',
      shell: !npmCli
    }
  );
  if (packaged.status !== 0) {
    const cause = packaged.error?.message
      ?? (packaged.signal ? `terminated by ${packaged.signal}` : 'unknown process failure');
    throw new Error(
      `Current desktop packaging failed with exit code ${packaged.status}: ${cause}.`
    );
  }
  process.env.LIGHTTABLE_TEST_EXECUTABLE = packagedExecutable;
}

const run = (script, args) => spawnSync(process.execPath, [path.join(workspace, 'scripts', script), ...args], {
  cwd: workspace,
  encoding: 'utf8',
  stdio: capture ? 'inherit' : 'pipe'
});

for (const [index, entry] of selected.entries()) {
  const root = path.join(corpusRoot, entry.root);
  const analysisPath = path.join(root, 'analysis.json');
  let before;
  try {
    before = JSON.parse(await readFile(analysisPath, 'utf8'));
  } catch (error) {
    report.push({ ...entry, status: 'missing', message: String(error) });
    continue;
  }
  const source = before.source;
  if (capture) {
    const captured = run('capture-lighttable-adjustment-oracle.mjs', [root, '--source', source]);
    if (captured.status !== 0) {
      report.push({ ...entry, source, status: 'capture-failed', exitCode: captured.status });
      continue;
    }
    // The analyzer intentionally exits non-zero for a parity gate failure, but
    // still writes the complete report. Read that evidence instead of hiding it.
    run('analyze-adjustment-oracle.mjs', ['--root', root, '--source', source]);
  }
  const after = JSON.parse(await readFile(analysisPath, 'utf8'));
  const summary = after.renderedSummary;
  const regression = entry.baseline - summary.parityPercent;
  const belowMinimum = summary.parityPercent < suite.minimumParityPercent;
  const insufficientCaseCoverage = summary.casePassRatePercent < 95;
  const status = regression > suite.maximumRegressionPercentPoints
    ? 'regressed'
    : belowMinimum || insufficientCaseCoverage
      ? entry.open ? 'open' : 'failed'
      : 'passed';
  report.push({
    ...entry,
    source,
    status,
    parityPercent: summary.parityPercent,
    casePassRatePercent: summary.casePassRatePercent,
    caseCount: summary.caseCount,
    regressionPercentPoints: regression
  });
  process.stdout.write(
    `[${index + 1}/${selected.length}] ${entry.root}: ${status} `
    + `${summary.parityPercent.toFixed(3)}% (${summary.casePassRatePercent.toFixed(1)}% cases)\n`
  );
}

const outputDirectory = path.join(workspace, 'tmp', 'adjustment-parity-regression');
await mkdir(outputDirectory, { recursive: true });
const outputPath = path.join(outputDirectory, 'report.json');
const totals = Object.fromEntries(['passed', 'open', 'failed', 'regressed', 'missing', 'capture-failed']
  .map((status) => [status, report.filter((entry) => entry.status === status).length]));
await writeFile(outputPath, `${JSON.stringify({
  schema: 1,
  generatedAt: new Date().toISOString(),
  photoshopVersion: suite.photoshopVersion,
  capture,
  corpusRoot,
  totals,
  corpora: report
}, null, 2)}\n`);
process.stdout.write(`Adjustment parity regression report: ${outputPath}\n`);

const fatal = report.some(({ status }) => status === 'regressed'
  || status === 'missing' || status === 'capture-failed'
  || (!regressionsOnly && status === 'failed'));
if (fatal) process.exitCode = 1;
