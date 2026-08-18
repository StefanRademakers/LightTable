import { createHash } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  gradeCorpusReportsHaveSameCases,
  parseGradeCorpusReport
} from './grade-corpus-report-compatibility.mjs';

const DEFAULT_SECTIONS = [
  { id: 'light', manifest: 'grade-light-parity-cases.json' },
  { id: 'color', manifest: 'grade-color-parity-cases.json' },
  { id: 'curves', manifest: 'grade-curves-parity-cases.json' },
  { id: 'local-detail', manifest: 'grade-local-detail-parity-cases.json' },
  { id: 'detail', manifest: 'grade-detail-parity-cases.json' },
  { id: 'color-mixer', manifest: 'grade-color-mixer-parity-cases.json' },
  { id: 'point-color', manifest: 'grade-point-color-parity-cases.json' },
  { id: 'color-grading', manifest: 'grade-color-grading-parity-cases.json' },
  { id: 'black-white', manifest: 'grade-black-white-parity-cases.json' },
  { id: 'look-profile', manifest: 'grade-look-profile-parity-cases.json' }
];

const exists = (file) => access(file).then(() => true, () => false);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const readReport = async (file) => {
  try {
    return parseGradeCorpusReport(await readFile(file, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    return { invalid: error instanceof Error ? error.message : String(error) };
  }
};

const validateReport = (report, section, source, manifestHash) => {
  if (!report) return 'missing';
  if (report.invalid) return `invalid-json: ${report.invalid}`;
  if (report.section !== section) return `wrong-section: ${report.section ?? 'none'}`;
  if (report.caseManifestSha256 !== manifestHash) return 'stale-case-manifest';
  if (report.sourceEvidence?.sha256 !== source.sha256) return 'stale-source';
  if (!Array.isArray(report.cases) || report.cases.length === 0) return 'missing-cases';
  return 'valid';
};

export const auditGradeParityReadiness = async ({
  workspace,
  externalRoot,
  sections = DEFAULT_SECTIONS
}) => {
  const inventory = JSON.parse(await readFile(path.join(externalRoot, 'inventory.json'), 'utf8'));
  const results = [];
  for (const definition of sections) {
    const manifestPath = path.join(workspace, 'scripts', definition.manifest);
    if (!await exists(manifestPath)) {
      results.push({
        section: definition.id,
        manifest: definition.manifest,
        status: 'missing-infrastructure',
        expectedSources: inventory.sources.length,
        cameraRawValid: 0,
        lightTableValid: 0,
        compatible: 0,
        sources: []
      });
      continue;
    }
    const manifestHash = sha256(await readFile(manifestPath));
    const sourceResults = [];
    for (const source of inventory.sources) {
      const root = path.join(externalRoot, 'captures', definition.id, source.id);
      const [cameraRaw, lightTable] = await Promise.all([
        readReport(path.join(root, 'camera-raw', 'capture-report.json')),
        readReport(path.join(root, 'lighttable', 'capture-report.json'))
      ]);
      const cameraRawState = validateReport(cameraRaw, definition.id, source, manifestHash);
      const lightTableState = validateReport(lightTable, definition.id, source, manifestHash);
      const compatible = cameraRawState === 'valid'
        && lightTableState === 'valid'
        && gradeCorpusReportsHaveSameCases(cameraRaw, lightTable);
      sourceResults.push({
        source: source.id,
        cameraRaw: cameraRawState,
        lightTable: lightTableState,
        compatible
      });
    }
    const cameraRawValid = sourceResults.filter(({ cameraRaw }) => cameraRaw === 'valid').length;
    const lightTableValid = sourceResults.filter(({ lightTable }) => lightTable === 'valid').length;
    const cameraRawPresent = sourceResults.filter(({ cameraRaw }) => cameraRaw !== 'missing').length;
    const lightTablePresent = sourceResults.filter(({ lightTable }) => lightTable !== 'missing').length;
    const compatible = sourceResults.filter((source) => source.compatible).length;
    const expectedSources = sourceResults.length;
    const status = compatible === expectedSources
      ? 'complete'
      : lightTableValid === expectedSources && cameraRawValid === 0
        ? cameraRawPresent > 0 ? 'lighttable-current-camera-stale' : 'lighttable-only'
        : cameraRawValid === 0 && lightTableValid === 0
          ? cameraRawPresent > 0 || lightTablePresent > 0 ? 'stale' : 'not-captured'
          : 'partial';
    results.push({
      section: definition.id,
      manifest: definition.manifest,
      manifestSha256: manifestHash,
      status,
      expectedSources,
      cameraRawPresent,
      lightTablePresent,
      cameraRawValid,
      lightTableValid,
      compatible,
      sources: sourceResults
    });
  }
  return {
    schema: 1,
    generatedAt: new Date().toISOString(),
    externalRoot,
    expectedSources: inventory.sources.length,
    complete: results.every(({ status }) => status === 'complete'),
    sections: results
  };
};

export const gradeParityReadinessMarkdown = (report) => [
  '# Grade / Camera Raw readiness',
  '',
  `External corpus: \`${report.externalRoot}\``,
  '',
  '| Section | State | Camera Raw | LightTable | Compatible |',
  '| --- | --- | ---: | ---: | ---: |',
  ...report.sections.map((section) => (
    `| ${section.section} | ${section.status} | ${section.cameraRawValid}/${section.expectedSources} | ${section.lightTableValid}/${section.expectedSources} | ${section.compatible}/${section.expectedSources} |`
  )),
  '',
  ...report.sections.flatMap((section) => {
    const incomplete = section.sources.filter((source) => !source.compatible);
    return incomplete.length ? [
      `## ${section.section}`,
      '',
      ...incomplete.map((source) => (
        `- ${source.source}: Camera Raw ${source.cameraRaw}; LightTable ${source.lightTable}; compatible ${source.compatible}`
      )),
      ''
    ] : [];
  })
].join('\n');

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const workspace = path.resolve(import.meta.dirname, '..');
  const corpus = JSON.parse(await readFile(
    path.join(import.meta.dirname, 'grade-camera-raw-corpus.json'), 'utf8'
  ));
  const rootArgument = process.argv.find((value) => value.startsWith('--root='));
  const externalRoot = path.resolve(rootArgument?.slice('--root='.length) ?? corpus.externalRoot);
  const outputArgument = process.argv.find((value) => value.startsWith('--output='));
  const output = path.resolve(outputArgument?.slice('--output='.length)
    ?? path.join(workspace, 'tmp', 'grade-parity-readiness'));
  const report = await auditGradeParityReadiness({ workspace, externalRoot });
  await mkdir(output, { recursive: true });
  await Promise.all([
    writeFile(path.join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`),
    writeFile(path.join(output, 'report.md'), `${gradeParityReadinessMarkdown(report)}\n`)
  ]);
  process.stdout.write(`${gradeParityReadinessMarkdown(report)}\n`);
  process.stdout.write(`Reports: ${path.join(output, 'report.json')} and report.md\n`);
  if (process.argv.includes('--require-complete') && !report.complete) process.exitCode = 1;
}
