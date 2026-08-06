import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const workspace = path.resolve(import.meta.dirname, '..');
const roots = ['apps', 'packages'].map((name) => path.join(workspace, name));
const baselinePath = path.join(workspace, 'architecture', 'tests', 'source-structure-baseline.json');
const outputPath = path.resolve(process.argv[2]
  ?? path.join(workspace, 'tmp', 'code-quality', 'source-structure.json'));
const baseline = JSON.parse(await readFile(baselinePath, 'utf8'));
const extensions = new Set(['.ts', '.tsx', '.mjs', '.rs']);

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

const files = (await Promise.all(roots.map(filesBelow))).flat();
const records = [];
for (const absolute of files) {
  const source = await readFile(absolute, 'utf8');
  const relative = path.relative(workspace, absolute).replaceAll('\\', '/');
  records.push({
    path: relative,
    lines: source.split(/\r?\n/u).length,
    imports: (source.match(/^import\s/gmu) ?? []).length,
    reactHooks: (source.match(/\buse(?:State|Effect|Memo|Callback|Ref|SyncExternalStore)\b/gu) ?? []).length,
    animationFrames: (source.match(/\brequestAnimationFrame\b/gu) ?? []).length,
    timers: (source.match(/\bset(?:Timeout|Interval)\b/gu) ?? []).length
  });
}
records.sort((left, right) => right.lines - left.lines || left.path.localeCompare(right.path));

const allow = new Map(Object.entries(baseline.allowedLargeFiles));
const failures = [];
for (const record of records) {
  const ceiling = allow.get(record.path);
  if (ceiling === undefined && record.lines > baseline.newFileMaximumLines) {
    failures.push(`${record.path} is a new ${record.lines}-line production file (limit ${baseline.newFileMaximumLines})`);
  } else if (ceiling !== undefined && record.lines > ceiling) {
    failures.push(`${record.path} grew to ${record.lines} lines (ceiling ${ceiling})`);
  }
}
for (const known of allow.keys()) {
  if (!records.some((record) => record.path === known)) {
    failures.push(`obsolete large-file exception remains for missing ${known}`);
  }
}

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  policy: baseline,
  summary: {
    productionFiles: records.length,
    over750Lines: records.filter(({ lines }) => lines > 750).length,
    over1000Lines: records.filter(({ lines }) => lines > 1000).length,
    largest: records[0]
  },
  largestFiles: records.slice(0, 40),
  failures
};
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
if (failures.length) throw new Error(`Source-structure audit failed:\n- ${failures.join('\n- ')}`);
process.stdout.write(`Source-structure audit passed (${records.length} files). Report: ${outputPath}\n`);
