import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const workspace = path.resolve(import.meta.dirname, '..');
const architectureRoot = path.join(workspace, 'architecture');

const walk = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  }));
  return nested.flat();
};

const relative = (file) => path.relative(workspace, file).replaceAll('\\', '/');
const markdownFiles = (await walk(architectureRoot))
  .filter((file) => file.endsWith('.md'))
  .sort((left, right) => left.localeCompare(right));
const failures = [];
let localLinkCount = 0;

for (const file of markdownFiles) {
  const source = await readFile(file, 'utf8');
  for (const match of source.matchAll(/\[[^\]]*\]\(([^)]+)\)/gu)) {
    const href = match[1].trim().replace(/^<|>$/gu, '');
    if (/^(?:https?:|mailto:|#)/iu.test(href)) continue;
    const targetPart = decodeURIComponent(href.split('#')[0]);
    if (!targetPart) continue;
    localLinkCount += 1;
    const target = path.resolve(path.dirname(file), targetPart);
    await stat(target).catch(() => failures.push(
      `${relative(file)} links to missing ${targetPart}`
    ));
  }
}

const baselinePath = path.join(architectureRoot, 'tests', 'source-structure-baseline.json');
const baseline = JSON.parse(await readFile(baselinePath, 'utf8'));
if (baseline.schemaVersion !== 2 || !baseline.generatedFiles || !baseline.reviewedHotspots) {
  failures.push('source-structure baseline is not the ownership-aware schema v2');
}
for (const sourcePath of [
  ...Object.keys(baseline.generatedFiles ?? {}),
  ...Object.keys(baseline.reviewedHotspots ?? {})
]) {
  const absolute = path.join(workspace, sourcePath);
  const source = await readFile(absolute, 'utf8').catch(() => null);
  if (source === null) {
    failures.push(`source-structure baseline references missing ${sourcePath}`);
  }
}

const inventory = JSON.parse(await readFile(path.join(
  architectureRoot, 'reference', 'implementation', 'THIRD_PARTY_DEPENDENCY_INVENTORY.json'
), 'utf8'));
const thirdParty = await readFile(path.join(
  architectureRoot, 'THIRD_PARTY_AND_FORMAT_SUPPORT.md'
), 'utf8');
const documentedCounts = thirdParty.match(
  /current snapshot contains (\d+) npm package\/version entries, (\d+) Cargo crates/iu
);
if (!documentedCounts) {
  failures.push('third-party document does not declare generated dependency counts');
} else {
  const npmCount = inventory.npm.length;
  const cargoCount = inventory.cargo.length;
  if (Number(documentedCounts[1]) !== npmCount || Number(documentedCounts[2]) !== cargoCount) {
    failures.push(`third-party counts are stale: docs ${documentedCounts[1]}/${documentedCounts[2]}, inventory ${npmCount}/${cargoCount}`);
  }
}

const systemMap = await readFile(path.join(architectureRoot, 'SYSTEM_MAP.md'), 'utf8');
for (const root of ['apps', 'packages']) {
  const directories = (await readdir(path.join(workspace, root), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => `${root}/${entry.name}`);
  for (const directory of directories) {
    if (!systemMap.includes(directory)) {
      failures.push(`SYSTEM_MAP.md omits current workspace ${directory}`);
    }
  }
}

if (failures.length > 0) {
  console.error(`Architecture documentation audit failed (${failures.length}):`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exitCode = 1;
} else {
  console.log(`Architecture documentation audit passed: ${markdownFiles.length} documents, ${localLinkCount} local links, dependency counts and workspace map current.`);
}
