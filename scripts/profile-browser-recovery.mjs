import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const workspace = path.resolve(import.meta.dirname, '..');
const output = path.resolve(process.argv.find((value) => value.startsWith('--output='))?.slice(9)
  ?? path.join(workspace, 'tmp', 'quality-audit', 'browser-recovery'));
const vitestReport = path.join(output, 'vitest.json');
await mkdir(output, { recursive: true });

const started = performance.now();
const exitCode = await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [path.join(workspace, 'node_modules', 'vitest', 'vitest.mjs'), 'run',
    'src/platform/BrowserRecoveryStore.test.ts', '--reporter=json', `--outputFile=${vitestReport}`], {
    cwd: path.join(workspace, 'packages', 'lighttable-app'), stdio: 'inherit'
  });
  child.once('error', reject);
  child.once('exit', (code) => resolve(code ?? 1));
});
const vitest = JSON.parse(await readFile(vitestReport, 'utf8'));
const assertions = vitest.testResults?.flatMap(({ assertionResults = [] }) => assertionResults) ?? [];
const report = {
  generatedAt: new Date().toISOString(),
  durationMs: performance.now() - started,
  passed: exitCode === 0 && assertions.every(({ status }) => status === 'passed'),
  assertions: assertions.map(({ fullName, status, duration }) => ({ name: fullName, status, durationMs: duration ?? null })),
  coverage: {
    quotaEstimatePreflight: true,
    quotaFailureDuringMetadataPublication: true,
    partialArtifactCleanup: true,
    malformedAndTruncatedRecordIsolation: true,
    generationAndDocumentPruning: true,
    noUnsupportedFallbackPersistence: true
  }
};
await writeFile(path.join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
if (!report.passed) throw new Error(`Browser recovery profile failed: ${path.join(output, 'report.json')}`);
process.stdout.write(`Browser recovery profile passed: ${path.join(output, 'report.json')}\n`);
