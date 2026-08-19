import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { brotliCompressSync, constants as zlibConstants, gzipSync } from 'node:zlib';

const workspace = path.resolve(import.meta.dirname, '..');
const roots = ['apps', 'packages'].map((name) => path.join(workspace, name));
const baselinePath = path.join(workspace, 'architecture', 'tests', 'source-structure-baseline.json');
const outputPath = path.resolve(process.argv[2]
  ?? path.join(workspace, 'tmp', 'code-quality', 'source-structure.json'));
const baseline = JSON.parse(await readFile(baselinePath, 'utf8'));
const extensions = new Set(['.ts', '.tsx', '.mjs', '.rs']);

if (baseline.schemaVersion !== 2 || !baseline.generatedFiles || !baseline.reviewedHotspots) {
  throw new Error('The source-structure baseline must use ownership-aware schema v2.');
}

const filesBelow = async (root) => {
  const files = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (['dist', 'out', 'node_modules', 'target'].includes(entry.name)) continue;
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...await filesBelow(absolute));
    else if (extensions.has(path.extname(entry.name)) && !/\.test\.[^.]+$/u.test(entry.name)) files.push(absolute);
  }
  return files;
};

const responsibilitySignals = (source) => [
  ['react-ui', /\buse(?:State|Effect|Memo|Callback|Ref|SyncExternalStore)\b|<\w+/u],
  ['async-lifecycle', /\b(?:setTimeout|setInterval|requestAnimationFrame|AbortController|addEventListener|dispose|destroy)\b/u],
  ['gpu-rendering', /\bGPU(?:Device|Texture|Buffer|Command|Render|Compute)|WGSL|shader\b/u],
  ['commands-history', /\b(?:execute|dispatch|command|undo|redo|history)\b/iu],
  ['persistence-formats', /\b(?:serialize|deserialize|migrate|PSD|PDF|artifact|File|Blob)\b/u],
  ['host-io', /\b(?:electron|ipcMain|ipcRenderer|node:fs|node:http|WebSocket|child_process)\b/u],
  ['workers-tasks', /\b(?:Worker|postMessage|task|job|progress|cancel)\b/u]
].filter(([, pattern]) => pattern.test(source)).map(([name]) => name);

const files = (await Promise.all(roots.map(filesBelow))).flat();
const records = [];
for (const absolute of files) {
  const source = await readFile(absolute, 'utf8');
  const relative = path.relative(workspace, absolute).replaceAll('\\', '/');
  const imports = [...source.matchAll(/^import[\s\S]*?from\s+['"]([^'"]+)['"];?/gmu)]
    .map((match) => match[1]);
  const generated = baseline.generatedFiles[relative] ?? null;
  const review = baseline.reviewedHotspots[relative] ?? null;
  const sourceBytes = Buffer.from(source);
  records.push({
    path: relative,
    kind: generated ? 'generated-artifact' : 'handwritten',
    lines: source.split(/\r?\n/u).length,
    bytes: sourceBytes.byteLength,
    sha256: createHash('sha256').update(source).digest('hex'),
    fanOut: {
      imports: imports.length,
      local: imports.filter((value) => value.startsWith('.')).length,
      packages: imports.filter((value) => !value.startsWith('.')).length
    },
    detectedResponsibilitySignals: responsibilitySignals(source),
    lifecycleSignals: {
      reactHooks: (source.match(/\buse(?:State|Effect|Memo|Callback|Ref|SyncExternalStore)\b/gu) ?? []).length,
      animationFrames: (source.match(/\brequestAnimationFrame\b/gu) ?? []).length,
      timers: (source.match(/\bset(?:Timeout|Interval)\b/gu) ?? []).length,
      abortControllers: (source.match(/\bAbortController\b/gu) ?? []).length,
      eventListeners: (source.match(/\baddEventListener\b/gu) ?? []).length
    },
    ...(generated ? { generated, deliveryEncoding: {
      gzipBytes: gzipSync(sourceBytes, { level: 9 }).byteLength,
      brotliBytes: brotliCompressSync(sourceBytes, { params: {
        [zlibConstants.BROTLI_PARAM_QUALITY]: 6
      } }).byteLength
    } } : {}),
    ...(review ? { ownershipReview: review } : {})
  });
}

const failures = [];
const byPath = new Map(records.map((record) => [record.path, record]));
for (const [generatedPath, policy] of Object.entries(baseline.generatedFiles)) {
  const record = byPath.get(generatedPath);
  if (!record) failures.push(`generated artifact policy references missing ${generatedPath}`);
  else {
    const source = await readFile(path.join(workspace, generatedPath), 'utf8');
    if (!source.startsWith(policy.marker)) failures.push(`${generatedPath} is missing its exact generated marker`);
    const generatorExists = await readFile(path.join(workspace, policy.generator), 'utf8')
      .then(() => true).catch(() => false);
    if (!generatorExists) failures.push(`${generatedPath} references missing generator ${policy.generator}`);
  }
}
for (const record of records.filter(({ kind }) => kind === 'handwritten')) {
  if (record.lines >= baseline.unreviewedHotspotLines && !record.ownershipReview) {
    failures.push(`${record.path} needs an ownership review (${record.lines} lines, ${record.detectedResponsibilitySignals.join(', ') || 'no signals'})`);
  }
  if (record.ownershipReview) {
    const review = record.ownershipReview;
    if (!['mixed-authority', 'cohesive-heavy'].includes(review.classification)
      || !Array.isArray(review.responsibilities) || review.responsibilities.length < 2
      || !Array.isArray(review.lifecycleOwners) || review.lifecycleOwners.length < 1
      || !['low', 'medium', 'high'].includes(review.productRisk) || !review.decision) {
      failures.push(`${record.path} has an incomplete ownership review`);
    }
    if (record.lines > Math.ceil(review.baselineLines * baseline.growthReviewRatio)) {
      failures.push(`${record.path} grew ${Math.round((record.lines / review.baselineLines - 1) * 100)}% since ownership review; re-review responsibilities and lifecycle`);
    }
  }
}
for (const reviewedPath of Object.keys(baseline.reviewedHotspots)) {
  if (!byPath.has(reviewedPath)) failures.push(`ownership review references missing ${reviewedPath}`);
}

const handwritten = records.filter(({ kind }) => kind === 'handwritten')
  .sort((left, right) => right.lines - left.lines || left.path.localeCompare(right.path));
const generatedArtifacts = records.filter(({ kind }) => kind === 'generated-artifact')
  .sort((left, right) => right.bytes - left.bytes || left.path.localeCompare(right.path));
const ownershipConcentrations = handwritten.filter(({ ownershipReview }) => ownershipReview)
  .sort((left, right) => right.ownershipReview.responsibilities.length - left.ownershipReview.responsibilities.length
    || right.detectedResponsibilitySignals.length - left.detectedResponsibilitySignals.length
    || right.lines - left.lines);
const report = {
  schemaVersion: 2,
  generatedAt: new Date().toISOString(),
  policy: {
    unreviewedHotspotLines: baseline.unreviewedHotspotLines,
    growthReviewRatio: baseline.growthReviewRatio,
    interpretation: 'Size triggers ownership review; it is not a refactor success metric.'
  },
  summary: {
    productionFiles: records.length,
    handwrittenFiles: handwritten.length,
    generatedArtifacts: generatedArtifacts.length,
    reviewedHotspots: ownershipConcentrations.length,
    mixedAuthorityHotspots: ownershipConcentrations.filter(({ ownershipReview }) => ownershipReview.classification === 'mixed-authority').length,
    cohesiveHeavyHotspots: ownershipConcentrations.filter(({ ownershipReview }) => ownershipReview.classification === 'cohesive-heavy').length
  },
  largestHandwrittenFiles: handwritten.slice(0, 40),
  generatedArtifacts,
  ownershipConcentrations,
  failures
};
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
if (failures.length) throw new Error(`Source-structure audit failed:\n- ${failures.join('\n- ')}`);
process.stdout.write(`Source-structure audit passed (${handwritten.length} handwritten files, ${generatedArtifacts.length} accountable generated artifacts). Report: ${outputPath}\n`);
