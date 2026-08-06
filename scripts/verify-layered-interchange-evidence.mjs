import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import sharp from 'sharp';
import { createLayeredInterchangeMatrix } from './layered-interchange-matrix.mjs';

const workspace = path.resolve(import.meta.dirname, '..');
const argument = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};
const paths = {
  matrix: path.join(workspace, 'architecture', 'contracts', 'LAYERED_INTERCHANGE_RELEASE_MATRIX.json'),
  blend: path.resolve(argument('blend-report', 'D:\\Mediavibe\\LightTableTests\\BlendColorMatrix\\report.json')),
  blendAll: path.resolve(argument('all-blend-report', 'D:\\Mediavibe\\LightTableTests\\BlendModes\\report.json')),
  effects: path.resolve(argument('effects-report', 'D:\\mediavibe\\LightTableTestFiles\\psd\\layer-effects-roundtrip\\lighttable-report.json')),
  templates: path.resolve(argument('template-inventory', path.join(workspace, 'work', 'done',
    'task_049_psd_template_corpus_feature_audit', 'corpus-inventory.json'))),
  context: path.resolve(argument('context-report', 'D:\\Mediavibe\\LightTableTests\\PsdCompare\\report.json')),
  lightTableRoundtrip: path.resolve(argument('lighttable-roundtrip', path.join(workspace, 'tmp', 'psd-roundtrip', 'report.json'))),
  photoshopRoundtrip: path.resolve(argument('photoshop-roundtrip', path.join(workspace, 'tmp', 'psd-roundtrip', 'photoshop-report.json'))),
  output: path.resolve(argument('output', path.join(workspace, 'tmp', 'layered-interchange-evidence.json')))
};
const json = async (file) => JSON.parse(await readFile(file, 'utf8'));
const invariant = (value, message) => { if (!value) throw new Error(message); };

const nonEmptyImage = async (file, label) => {
  await access(file);
  const metadata = await sharp(file).metadata();
  invariant((metadata.width ?? 0) > 0 && (metadata.height ?? 0) > 0,
    `${label} has zero pixels: ${file}`);
  const stats = await sharp(file).removeAlpha().stats();
  invariant(stats.channels.some(({ min, max }) => max > min), `${label} is a flat/invalid capture: ${file}`);
  return { file, width: metadata.width, height: metadata.height };
};

const [matrixFile, generatedMatrix, blend, blendAll, effects, templates, context, lightTable, photoshop] =
  await Promise.all([
    json(paths.matrix), createLayeredInterchangeMatrix(), json(paths.blend), json(paths.blendAll), json(paths.effects),
    json(paths.templates), json(paths.context), json(paths.lightTableRoundtrip), json(paths.photoshopRoundtrip)
  ]);
invariant(JSON.stringify(matrixFile) === JSON.stringify(generatedMatrix), 'Committed interchange matrix is stale.');

invariant(blend.results?.length === 48, `Expected 48 blend cases, found ${blend.results?.length ?? 0}.`);
invariant(blend.results.every((entry) => entry.status === 'passed' && entry.semanticParity
  && entry.visualParity && !entry.pageErrors?.length && Number.isFinite(entry.metrics?.rgbRmse)),
'Blend corpus contains a semantic, visual or runtime failure.');
const blendCaptures = await Promise.all(blend.results.map((entry) =>
  nonEmptyImage(entry.rawDifference, `Blend ${entry.id} raw difference`)));
const canonicalBlendModes = new Set(matrixFile.inventory.blends);
invariant(blendAll.results?.length === 32, `Expected 32 all-mode blend cases, found ${blendAll.results?.length ?? 0}.`);
const declaredPartialBlendModes = new Set(matrixFile.rows
  .filter((entry) => entry.family === 'blend-mode' && entry.cells['visual-parity'].status === 'partial')
  .map((entry) => entry.capability));
invariant(blendAll.results.every((entry) => entry.semanticParity && !entry.pageErrors?.length
  && (entry.status === 'passed' || declaredPartialBlendModes.has(entry.mode))),
  'All-mode blend corpus contains an undeclared failure.');
invariant([...declaredPartialBlendModes].every((mode) => blendAll.results.some((entry) =>
  entry.mode === mode && entry.status !== 'passed')), 'A declared partial blend no longer fails and should be promoted.');
invariant(canonicalBlendModes.size === 26 && [...canonicalBlendModes].every((mode) =>
  blendAll.results.some((entry) => entry.mode === mode)), 'All-mode corpus does not cover the canonical blend registry.');

invariant(effects.results?.length === 40, `Expected 40 effects cases, found ${effects.results?.length ?? 0}.`);
invariant(effects.strict === true, 'Effects report was not produced in strict mode.');
invariant(effects.results.every((entry) => entry.status === 'passed' && entry.semanticParity
  && !entry.pageErrors?.length && Number.isFinite(entry.importMetrics?.rgbRmse)
  && Number.isFinite(entry.roundtripSelfMetrics?.rgbRmse)),
'Effects corpus contains a semantic, roundtrip or runtime failure.');
const soloCaptures = await Promise.all(effects.results.slice(0, 10).map((entry) =>
  nonEmptyImage(entry.reference, `Solo effect ${entry.id}`)));

invariant(templates.documentCount === 10 && templates.documents?.length === 10,
  `Expected ten inventoried templates, found ${templates.documentCount ?? 0}.`);
const contextResults = context.results?.filter(({ source }) => source.includes('Save the Date Invitation PSD 6')) ?? [];
invariant(contextResults.length === 10, `Expected ten contextual settled captures, found ${contextResults.length}.`);
invariant(contextResults.every((entry) => entry.status === 'passed' && !entry.pageErrors?.length),
  'A contextual template capture failed.');
const contextCaptures = await Promise.all(contextResults.map((entry) =>
  nonEmptyImage(entry.output, `Context template ${entry.id}`)));

invariant(lightTable.before?.canvas?.width > 0 && lightTable.after?.canvas?.width > 0,
  'LightTable PSD roundtrip has no canvas pixels.');
invariant(JSON.stringify(lightTable.beforeSignature) === JSON.stringify(lightTable.afterSignature),
  'LightTable PSD roundtrip silently changed its semantic layer signature.');
invariant(!lightTable.pageErrors?.length, 'LightTable PSD roundtrip recorded runtime errors.');
invariant(photoshop.status === 'passed' && photoshop.width > 0 && photoshop.height > 0
  && photoshop.layers?.length > 0, 'Photoshop did not accept and rewrite the LightTable PSD.');

const report = {
  schema: 1,
  generatedAt: new Date().toISOString(),
  matrixRows: matrixFile.rows.length,
  gates: {
    blend: { colorProfileCases: 48, allModeCases: 32, canonicalModes: 26,
      declaredPartialModes: [...declaredPartialBlendModes],
      colorReport: paths.blend, allModeReport: paths.blendAll, captures: blendCaptures.length },
    effects: { cases: 40, strict: true, report: paths.effects, soloCaptures },
    templates: { documents: 10, inventory: paths.templates, contextCaptures },
    roundtrip: {
      lightTableToPsdToLightTable: paths.lightTableRoundtrip,
      lightTableToPhotoshopToPsd: paths.photoshopRoundtrip,
      semanticSignatureStable: true
    },
    guards: { zeroPixelComparisons: 0, runtimeErrors: 0, silentSemanticLoss: 0 }
  }
};
await mkdir(path.dirname(paths.output), { recursive: true });
await writeFile(paths.output, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`Layered interchange evidence passed (${matrixFile.rows.length} rows, 26/32 all-mode blends, 48 color cases, 40 effects, 10 templates).\n`);
process.stdout.write(`Report: ${paths.output}\n`);
