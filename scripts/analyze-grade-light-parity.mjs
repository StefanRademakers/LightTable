import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import sharp from 'sharp';
import { gradeCorpusReportsHaveSameCases } from './grade-corpus-report-compatibility.mjs';
import {
  gradeCorpusLightTableCasePlanSha256,
  gradeCorpusSharedCasePlanSha256
} from './grade-corpus-case-plan.mjs';

const rootArgument = process.argv.find((value) => value.startsWith('--root='));
const root = path.resolve(rootArgument?.slice('--root='.length)
  ?? 'D:\\mediavibe\\LightTableTests\\GradeLightParity');
const cameraRawDirectory = path.join(root, 'camera-raw');
const lightTableDirectory = path.join(root, 'lighttable');
const parseJson = (value) => JSON.parse(value.replace(/^\uFEFF/u, ''));
const [cameraRawReportBytes, lightTableReportBytes] = await Promise.all([
  readFile(path.join(cameraRawDirectory, 'capture-report.json')),
  readFile(path.join(lightTableDirectory, 'capture-report.json'))
]);
const cameraRawReport = parseJson(cameraRawReportBytes.toString('utf8'));
const lightTableReport = parseJson(lightTableReportBytes.toString('utf8'));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
if (cameraRawReport.section !== lightTableReport.section
  || cameraRawReport.sourceEvidence?.sha256 !== lightTableReport.sourceEvidence?.sha256
  || !gradeCorpusReportsHaveSameCases(cameraRawReport, lightTableReport)) {
  throw new Error('Camera Raw and LightTable capture provenance does not match.');
}

const cameraRawCases = new Map(cameraRawReport.cases.map((entry) => [entry.id, entry]));
const lightTableCases = new Map(lightTableReport.cases.map((entry) => [entry.id, entry]));
const ids = [...cameraRawCases.keys()];
if (ids.length !== lightTableCases.size || ids.some((id) => !lightTableCases.has(id))) {
  throw new Error('Camera Raw and LightTable case manifests do not match.');
}

const load = (file) => sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const loaded = new Map();
const image = async (directory, id) => {
  const key = `${directory}:${id}`;
  if (!loaded.has(key)) loaded.set(key, load(path.join(directory, `${id}.png`)));
  return loaded.get(key);
};
const [cameraRawNeutral, lightTableNeutral] = await Promise.all([
  image(cameraRawDirectory, 'neutral'), image(lightTableDirectory, 'neutral')
]);
const dimensions = ({ info }) => `${info.width}x${info.height}`;
if (dimensions(cameraRawNeutral) !== dimensions(lightTableNeutral)) {
  throw new Error(`Neutral dimensions differ: ${dimensions(cameraRawNeutral)} and ${dimensions(lightTableNeutral)}.`);
}

const luminance = (data, index) => 0.2126 * data[index]
  + 0.7152 * data[index + 1] + 0.0722 * data[index + 2];
const normalizedRmse = (left, right) => {
  let squared = 0;
  for (let index = 0; index < left.length; index += 1) {
    const difference = left[index] - right[index];
    squared += difference * difference;
  }
  return Math.sqrt(squared / left.length) / 255;
};
const effectMetrics = (leftNeutral, leftTarget, rightNeutral, rightTarget) => {
  let squaredDifference = 0;
  let leftEnergy = 0;
  let rightEnergy = 0;
  let dot = 0;
  let leftMeanLuminanceDelta = 0;
  let rightMeanLuminanceDelta = 0;
  for (let index = 0; index < leftTarget.length; index += 3) {
    const leftDeltaLuma = luminance(leftTarget, index) - luminance(leftNeutral, index);
    const rightDeltaLuma = luminance(rightTarget, index) - luminance(rightNeutral, index);
    leftMeanLuminanceDelta += leftDeltaLuma;
    rightMeanLuminanceDelta += rightDeltaLuma;
    for (let channel = 0; channel < 3; channel += 1) {
      const left = leftTarget[index + channel] - leftNeutral[index + channel];
      const right = rightTarget[index + channel] - rightNeutral[index + channel];
      const difference = left - right;
      squaredDifference += difference * difference;
      leftEnergy += left * left;
      rightEnergy += right * right;
      dot += left * right;
    }
  }
  const pixels = leftTarget.length / 3;
  return {
    deltaRmse: Math.sqrt(squaredDifference / leftTarget.length) / 255,
    correlation: dot / Math.max(1e-12, Math.sqrt(leftEnergy * rightEnergy)),
    cameraRawMagnitude: Math.sqrt(leftEnergy / leftTarget.length) / 255,
    lightTableMagnitude: Math.sqrt(rightEnergy / rightTarget.length) / 255,
    magnitudeRatio: Math.sqrt(rightEnergy / Math.max(1e-12, leftEnergy)),
    meanLuminanceDelta: {
      cameraRaw: leftMeanLuminanceDelta / pixels / 255,
      lightTable: rightMeanLuminanceDelta / pixels / 255
    }
  };
};
const clipping = (data) => {
  let shadows = 0;
  let highlights = 0;
  for (let index = 0; index < data.length; index += 3) {
    const y = luminance(data, index);
    if (y <= 0.5) shadows += 1;
    if (y >= 254.5) highlights += 1;
  }
  const pixels = data.length / 3;
  return { shadows: shadows / pixels, highlights: highlights / pixels };
};

const cases = [];
for (const id of ids.filter((value) => value !== 'neutral')) {
  const cameraRawCase = cameraRawCases.get(id);
  const lightTableCase = lightTableCases.get(id);
  if (cameraRawCase.isBaseline || lightTableCase.isBaseline) continue;
  const baselineId = cameraRawCase.baselineId ?? 'neutral';
  if (baselineId !== (lightTableCase.baselineId ?? 'neutral')) {
    throw new Error(`Camera Raw and LightTable baselines differ for ${id}.`);
  }
  const [cameraRawTarget, lightTableTarget] = await Promise.all([
    image(cameraRawDirectory, id), image(lightTableDirectory, id)
  ]);
  const [cameraRawBaseline, lightTableBaseline] = baselineId === 'neutral'
    ? [cameraRawNeutral, lightTableNeutral]
    : await Promise.all([
        image(cameraRawDirectory, baselineId), image(lightTableDirectory, baselineId)
      ]);
  if (dimensions(cameraRawTarget) !== dimensions(cameraRawNeutral)
    || dimensions(lightTableTarget) !== dimensions(lightTableNeutral)) {
    throw new Error(`Dimensions differ for ${id}.`);
  }
  const effect = effectMetrics(
    cameraRawBaseline.data, cameraRawTarget.data,
    lightTableBaseline.data, lightTableTarget.data
  );
  cases.push({
    id,
    key: cameraRawCase.key,
    label: cameraRawCase.label,
    value: cameraRawCase.value,
    baselineId,
    directTargetRmse: normalizedRmse(cameraRawTarget.data, lightTableTarget.data),
    effect,
    descriptorHasEffect: effect.cameraRawMagnitude > 1e-7,
    clipping: {
      cameraRaw: clipping(cameraRawTarget.data),
      lightTable: clipping(lightTableTarget.data)
    }
  });
}

const groupedCases = new Map();
for (const entry of cases) {
  const entries = groupedCases.get(entry.key) ?? [];
  entries.push(entry);
  groupedCases.set(entry.key, entries);
}
const controls = [...groupedCases.values()].map((entries) => ({
  key: entries[0].key,
  label: entries[0].label,
  cases: entries,
  summary: {
    meanCorrelation: entries.reduce((sum, entry) => sum + entry.effect.correlation, 0) / entries.length,
    meanMagnitudeRatio: entries.reduce((sum, entry) => sum + entry.effect.magnitudeRatio, 0) / entries.length,
    maximumDeltaRmse: Math.max(...entries.map((entry) => entry.effect.deltaRmse)),
    descriptorValidated: entries.every((entry) => entry.descriptorHasEffect)
  }
}));
const report = {
  schema: 1,
  generatedAt: new Date().toISOString(),
  section: cameraRawReport.section,
  source: cameraRawReport.source,
  dimensions: dimensions(cameraRawNeutral),
  versions: {
    photoshop: cameraRawReport.photoshopVersion,
    cameraRaw: cameraRawReport.cameraRawVersion
  },
  inputs: {
    cameraRawCaseManifestSha256: cameraRawReport.caseManifestSha256,
    lightTableCaseManifestSha256: lightTableReport.caseManifestSha256,
    sharedCasePlanSha256: gradeCorpusSharedCasePlanSha256(cameraRawReport.cases),
    lightTableCasePlanSha256: lightTableReport.lightTableCasePlanSha256
      ?? gradeCorpusLightTableCasePlanSha256(lightTableReport.cases),
    sourceSha256: cameraRawReport.sourceEvidence.sha256,
    cameraRawReportSha256: sha256(cameraRawReportBytes),
    lightTableReportSha256: sha256(lightTableReportBytes)
  },
  neutralRmse: normalizedRmse(cameraRawNeutral.data, lightTableNeutral.data),
  controls,
  note: 'Characterization only. Metrics compare each product effect against its own declared neutral or prerequisite baseline.'
};
await mkdir(root, { recursive: true });
await writeFile(path.join(root, 'comparison-report.json'), `${JSON.stringify(report, null, 2)}\n`);

const percent = (value) => `${(value * 100).toFixed(2)}%`;
const markdown = [
  `# Grade ${report.section} parity characterization`,
  '',
  `Source: \`${report.source}\`  `,
  `Photoshop: ${report.versions.photoshop}  `,
  `Camera Raw: ${report.versions.cameraRaw}  `,
  `Neutral render RMSE: ${percent(report.neutralRmse)}`,
  '',
  '| Control | Effect correlation | Magnitude LT / ACR | Maximum delta RMSE | Descriptor active |',
  '| --- | ---: | ---: | ---: | :---: |',
  ...controls.map(({ label, summary }) => `| ${label} | ${summary.meanCorrelation.toFixed(4)} | ${summary.meanMagnitudeRatio.toFixed(3)} | ${percent(summary.maximumDeltaRmse)} | ${summary.descriptorValidated ? 'yes' : 'NO'} |`),
  '',
  'These figures are diagnostic observations, not release thresholds or automatic tuning decisions.',
  ''
].join('\n');
await writeFile(path.join(root, 'findings.md'), markdown);
process.stdout.write(`${markdown}\n`);
