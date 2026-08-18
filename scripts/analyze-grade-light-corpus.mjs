import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const manifest = JSON.parse(await readFile(
  path.join(import.meta.dirname, 'grade-camera-raw-corpus.json'), 'utf8'
));
const rootArgument = process.argv.find((value) => value.startsWith('--root='));
const sectionArgument = process.argv.find((value) => value.startsWith('--section='));
const section = sectionArgument?.slice('--section='.length) ?? 'light';
const casesManifest = JSON.parse(await readFile(
  path.join(import.meta.dirname, `grade-${section}-parity-cases.json`), 'utf8'
));
const controlDefinitions = new Map(casesManifest.controls.map((control) => [control.key, control]));
const root = path.resolve(rootArgument?.slice('--root='.length) ?? manifest.externalRoot);
const captureRoot = path.join(root, 'captures', section);
const sourceDirectories = await readdir(captureRoot, { withFileTypes: true });
const reports = [];
for (const directory of sourceDirectories.filter((entry) => entry.isDirectory())) {
  const reportFile = path.join(captureRoot, directory.name, 'comparison-report.json');
  try {
    const report = JSON.parse(await readFile(reportFile, 'utf8'));
    reports.push({ id: directory.name, report });
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}
if (!reports.length) throw new Error('No completed Grade Light corpus reports were found.');

const versions = new Set(reports.map(({ report }) => (
  `${report.versions.photoshop}|${report.versions.cameraRaw}`
)));
if (versions.size !== 1) throw new Error(`Mixed Adobe oracle versions: ${[...versions].join(', ')}`);
const controls = new Map();
for (const source of reports) {
  for (const control of source.report.controls) {
    const entries = controls.get(control.key) ?? [];
    entries.push({ source: source.id, control });
    controls.set(control.key, entries);
  }
}
const aggregate = [...controls].map(([key, entries]) => {
  const activeEntries = entries.filter(({ control }) => control.summary.descriptorValidated);
  const inactiveSources = entries
    .filter(({ control }) => !control.summary.descriptorValidated)
    .map(({ source }) => source);
  if (!activeEntries.length) {
    throw new Error(`Camera Raw descriptor for ${key} had no measurable effect on any corpus source.`);
  }
  const cases = activeEntries.flatMap(({ source, control }) => control.cases
    .filter((entry) => entry.descriptorHasEffect)
    .map((entry) => ({ source, ...entry })));
  const signs = Object.fromEntries(['negative', 'positive'].map((sign) => {
    const selected = cases.filter(({ value }) => sign === 'negative' ? value < 0 : value > 0);
    if (!selected.length) {
      return [sign, null];
    }
    const worst = selected.reduce((current, entry) => (
      !current || entry.effect.deltaRmse > current.effect.deltaRmse ? entry : current
    ), null);
    return [sign, {
      meanCorrelation: selected.reduce((sum, entry) => sum + entry.effect.correlation, 0) / selected.length,
      meanMagnitudeRatio: selected.reduce((sum, entry) => sum + entry.effect.magnitudeRatio, 0) / selected.length,
      magnitudeRange: [
        Math.min(...selected.map((entry) => entry.effect.magnitudeRatio)),
        Math.max(...selected.map((entry) => entry.effect.magnitudeRatio))
      ],
      maximumDeltaRmse: worst.effect.deltaRmse,
      worstCase: { source: worst.source, id: worst.id, value: worst.value }
    }];
  }));
  const worstSource = activeEntries.reduce((current, entry) => (
    !current || entry.control.summary.maximumDeltaRmse > current.control.summary.maximumDeltaRmse
      ? entry : current
  ), null);
  return {
    key,
    label: entries[0].control.label,
    subgroupLabel: controlDefinitions.get(key)?.subgroupLabel ?? null,
    sources: activeEntries.length,
    inactiveSources,
    minimumSourceCorrelation: Math.min(...activeEntries.map(({ control }) => control.summary.meanCorrelation)),
    meanSourceCorrelation: activeEntries.reduce((sum, { control }) => sum + control.summary.meanCorrelation, 0) / activeEntries.length,
    meanSourceMagnitudeRatio: activeEntries.reduce((sum, { control }) => sum + control.summary.meanMagnitudeRatio, 0) / activeEntries.length,
    maximumDeltaRmse: worstSource.control.summary.maximumDeltaRmse,
    worstSource: worstSource.source,
    signs
  };
});
const [photoshop, cameraRaw] = [...versions][0].split('|');
const report = {
  schema: 1,
  generatedAt: new Date().toISOString(),
  versions: { photoshop, cameraRaw },
  completedSources: reports.length,
  neutralRmse: {
    maximum: Math.max(...reports.map(({ report: item }) => item.neutralRmse)),
    mean: reports.reduce((sum, { report: item }) => sum + item.neutralRmse, 0) / reports.length
  },
  controls: aggregate
};
await mkdir(root, { recursive: true });
await writeFile(path.join(root, `${section}-corpus-summary.json`), `${JSON.stringify(report, null, 2)}\n`);
const percent = (value) => `${(value * 100).toFixed(2)}%`;
const markdown = [
  `# Grade ${section} corpus summary`, '',
  `Sources: ${report.completedSources}  `,
  `Photoshop: ${photoshop}  `,
  `Camera Raw: ${cameraRaw}  `,
  `Neutral RMSE mean / max: ${percent(report.neutralRmse.mean)} / ${percent(report.neutralRmse.maximum)}`,
  '',
  '| Control | Active sources | Min source corr. | Mean magnitude | Negative magnitude range | Positive magnitude range | Worst RMSE | Worst source |',
  '| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |',
  ...aggregate.map((control) => `| ${control.subgroupLabel ? `${control.subgroupLabel} / ` : ''}${control.label} | ${control.sources}/${reports.length} | ${control.minimumSourceCorrelation.toFixed(4)} | ${control.meanSourceMagnitudeRatio.toFixed(3)} | ${control.signs.negative?.magnitudeRange.map((value) => value.toFixed(2)).join('–') ?? '—'} | ${control.signs.positive?.magnitudeRange.map((value) => value.toFixed(2)).join('–') ?? '—'} | ${percent(control.maximumDeltaRmse)} | ${control.worstSource} |`),
  '',
  ...aggregate
    .filter((control) => control.inactiveSources.length)
    .map((control) => `${control.subgroupLabel ? `${control.subgroupLabel} / ` : ''}${control.label}: Camera Raw descriptor inactive on ${control.inactiveSources.join(', ')}.`),
  '',
  'Magnitude ranges spanning substantially different ratios across sources are evidence against a fixed scalar correction.',
  ''
].join('\n');
await writeFile(path.join(root, `${section}-corpus-summary.md`), markdown);
process.stdout.write(`${markdown}\n`);
