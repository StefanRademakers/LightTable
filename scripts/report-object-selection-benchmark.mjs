import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const workspaceRoot = path.resolve(import.meta.dirname, '..');
const inputDirectory = path.resolve(process.argv[2] ?? path.join(workspaceRoot, 'tmp', 'object-selection-smoke'));
const outputPath = path.resolve(process.argv[3] ?? path.join(inputDirectory, 'benchmark-summary.json'));
const files = (await readdir(inputDirectory))
  .filter((name) => /^benchmark-.+-report\.json$/i.test(name))
  .sort();
const reports = await Promise.all(files.map(async (name) => ({
  name,
  value: JSON.parse(await readFile(path.join(inputDirectory, name), 'utf8'))
})));

const percentile = (values, fraction) => {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(fraction * sorted.length) - 1];
};
const round = (value) => value === undefined ? undefined : Math.round(value * 100) / 100;
const roundCoverage = (value) => value === undefined ? undefined : Math.round(value * 1_000_000) / 1_000_000;

const profiles = [...new Set(reports.map(({ value }) => value.backendProfile))].sort();
const summary = {
  generatedAt: new Date().toISOString(),
  inputDirectory,
  profiles: Object.fromEntries(profiles.map((profile) => {
    const cases = reports.filter(({ value }) => value.backendProfile === profile);
    const passed = cases.filter(({ value }) => value.passed !== false && value.finalCoverage);
    const phases = [...new Set(passed.flatMap(({ value }) => (value.smartSelectionTrace ?? [])
      .filter((entry) => entry.event === 'backend-metric')
      .map((entry) => entry.detail?.phase)
      .filter(Boolean)))].sort();
    return [profile, {
      cases: cases.map(({ name, value }) => ({
        name,
        sourceFile: value.sourceFile,
        passed: value.passed !== false && Boolean(value.finalCoverage),
        visibleCommitMs: round(value.visibleCommitMs),
        selectedMean: value.finalCoverage ? roundCoverage(value.finalCoverage.selectedMean) : undefined,
        error: value.error
      })),
      passed: passed.length,
      failed: cases.length - passed.length,
      visibleCommitMs: {
        p50: round(percentile(passed.map(({ value }) => value.visibleCommitMs), 0.5)),
        p95: round(percentile(passed.map(({ value }) => value.visibleCommitMs), 0.95))
      },
      selectedMean: {
        minimum: passed.length
          ? roundCoverage(Math.min(...passed.map(({ value }) => value.finalCoverage.selectedMean)))
          : undefined,
        maximum: passed.length
          ? roundCoverage(Math.max(...passed.map(({ value }) => value.finalCoverage.selectedMean)))
          : undefined
      },
      phases: Object.fromEntries(phases.map((phase) => {
        const durations = passed.flatMap(({ value }) => (value.smartSelectionTrace ?? [])
          .filter((entry) => entry.event === 'backend-metric' && entry.detail?.phase === phase)
          .map((entry) => entry.detail.durationMs));
        return [phase, {
          samples: durations.length,
          p50Ms: round(percentile(durations, 0.5)),
          p95Ms: round(percentile(durations, 0.95))
        }];
      }))
    }];
  }))
};

await writeFile(outputPath, `${JSON.stringify(summary, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
