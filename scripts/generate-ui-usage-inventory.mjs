import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const sourceRoot = path.join(root, 'packages', 'lighttable-app', 'src');
const uiRoot = path.join(sourceRoot, 'ui');
const manifestPath = path.join(uiRoot, 'uiComponentManifest.json');
const baselinePath = path.join(uiRoot, 'uiAuditBaseline.json');
const outputPath = path.join(uiRoot, 'generatedUiUsageInventory.json');
const checkOnly = process.argv.includes('--check');

const walk = async (directory) => (await Promise.all((await readdir(directory, {
  withFileTypes: true
})).map((entry) => entry.isDirectory()
  ? walk(path.join(directory, entry.name))
  : [path.join(directory, entry.name)]))).flat();

const slash = (value) => value.split(path.sep).join('/');
const relativeSourcePath = (file) => slash(path.relative(sourceRoot, file));
const isTest = (file) => /(?:\.test|\.spec)\.[cm]?[jt]sx?$/.test(file);
const isCatalogSpecimen = (file) => /standalone\/(?:UiStyleGuideDialog|UiSystemSpecimens|UiColorPickerPrototype|UiCoverageSpecimen|UiInspectorHost|AdjustmentDialogSpecimens)\.tsx$/.test(file);
const countMatches = (source, expression) => [...source.matchAll(expression)].length;

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const baseline = JSON.parse(await readFile(baselinePath, 'utf8'));
const files = await walk(sourceRoot);
const sourceFiles = files.filter((file) => /\.[cm]?[jt]sx?$/.test(file) && !isTest(file));
const productionFiles = sourceFiles.filter((file) => !isCatalogSpecimen(relativeSourcePath(file)));
const cssFiles = files.filter((file) => file.endsWith('.css'));
const sourceCache = new Map(await Promise.all([...new Set([...productionFiles, ...cssFiles])]
  .map(async (file) => [file, await readFile(file, 'utf8')])));
const uiSource = sourceFiles.filter((file) => file.startsWith(`${uiRoot}${path.sep}`))
  .map((file) => sourceCache.get(file) ?? '')
  .join('\n');

const components = manifest.map((component) => {
  const locations = [];
  let productionUsageCount = 0;
  let internalUsageCount = 0;
  for (const file of productionFiles) {
    const source = sourceCache.get(file);
    const count = component.symbols.reduce((total, symbol) => total + countMatches(
      source,
      new RegExp(`<${symbol}(?=[\\s>/])`, 'g')
    ), 0);
    if (!count) continue;
    const relative = relativeSourcePath(file);
    const internal = relative.startsWith('ui/');
    if (internal) internalUsageCount += count;
    else productionUsageCount += count;
    locations.push({ path: relative, count, kind: internal ? 'internal' : 'product' });
  }

  const overrides = [];
  for (const file of cssFiles) {
    if (file.startsWith(`${uiRoot}${path.sep}`)) continue;
    const source = sourceCache.get(file);
    const matchedRoots = component.roots.filter((rootClass) => (
      new RegExp(`\\.${rootClass}(?![a-zA-Z0-9_-])`).test(source)
    ));
    if (matchedRoots.length) {
      overrides.push({ path: relativeSourcePath(file), roots: matchedRoots });
    }
  }

  const productLocations = locations.filter(({ kind }) => kind === 'product');
  return {
    id: component.id,
    metadataDeclared: new RegExp(
      `data-suite-control[^\\n]{0,80}['"]${component.id}['"]`
    ).test(uiSource),
    productionUsageCount,
    internalUsageCount,
    contextCount: productLocations.length,
    overrideCount: overrides.length,
    locations,
    overrides
  };
});

const nativeCandidates = [
  { id: 'button', label: 'Raw buttons', expression: /<button(?=[\s>])/g },
  { id: 'select', label: 'Raw selects', expression: /<select(?=[\s>])/g },
  { id: 'range', label: 'Raw range inputs', expression: /<input\b[^>]*\btype\s*=\s*["']range["']/g },
  { id: 'number', label: 'Raw number inputs', expression: /<input\b[^>]*\btype\s*=\s*["']number["']/g }
].map(({ id, label, expression }) => {
  const locations = [];
  for (const file of productionFiles) {
    const relative = relativeSourcePath(file);
    if (relative.startsWith('ui/')) continue;
    const count = countMatches(sourceCache.get(file), expression);
    if (count) locations.push({ path: relative, count });
  }
  return {
    id,
    label,
    count: locations.reduce((total, location) => total + location.count, 0),
    fileCount: locations.length,
    locations
  };
});

const selectorDepth = (selector) => selector
  .replace(/:where\([^)]*\)/g, ':where')
  .trim()
  .split(/\s+(?![^()]*\))|\s*>\s*|\s*\+\s*|\s*~\s*/)
  .filter(Boolean).length;

const deepSelectors = [];
for (const file of cssFiles) {
  if (file.startsWith(`${uiRoot}${path.sep}`)) continue;
  const source = sourceCache.get(file).replaceAll(/\/\*[\s\S]*?\*\//g, '');
  for (const match of source.matchAll(/(^|})([^@}{][^{}]*)\{/g)) {
    for (const rawSelector of match[2].split(',')) {
      const selector = rawSelector.trim();
      const depth = selectorDepth(selector);
      if (selector && depth >= 4) {
        deepSelectors.push({ path: relativeSourcePath(file), selector, depth });
      }
    }
  }
}
deepSelectors.sort((left, right) => right.depth - left.depth || left.selector.localeCompare(right.selector));

const inventory = {
  schema: 1,
  components,
  nativeCandidates,
  deepSelectorCount: deepSelectors.length,
  deepestSelectors: deepSelectors.slice(0, 30)
};
const serialized = `${JSON.stringify(inventory, null, 2)}\n`;

const missingMetadata = components.filter((component) => !component.metadataDeclared);
if (missingMetadata.length) {
  throw new Error(`Canonical UI controls missing runtime metadata: ${missingMetadata.map(({ id }) => id).join(', ')}`);
}

if (checkOnly) {
  const budgetViolations = [];
  for (const candidate of nativeCandidates) {
    const allowed = baseline.nativeCandidates[candidate.id] ?? {};
    for (const location of candidate.locations) {
      const maximum = allowed[location.path];
      if (maximum === undefined) {
        budgetViolations.push(`${candidate.label}: new source ${location.path} (${location.count})`);
      } else if (location.count > maximum) {
        budgetViolations.push(`${candidate.label}: ${location.path} grew ${maximum} -> ${location.count}`);
      }
    }
  }
  if (deepSelectors.length > baseline.maxDeepSelectors) {
    budgetViolations.push(`deep selectors grew ${baseline.maxDeepSelectors} -> ${deepSelectors.length}`);
  }
  const allowedOverrides = new Set(baseline.externalOverrides);
  for (const component of components) {
    for (const override of component.overrides) {
      for (const rootClass of override.roots) {
        const key = `${component.id}|${override.path}|${rootClass}`;
        if (!allowedOverrides.has(key)) budgetViolations.push(`new external override: ${key}`);
      }
    }
  }
  if (budgetViolations.length) {
    throw new Error(`UI customness budget exceeded:\n- ${budgetViolations.join('\n- ')}`);
  }
}

if (checkOnly) {
  const current = await readFile(outputPath, 'utf8').catch(() => '');
  if (current !== serialized) {
    throw new Error('UI usage inventory is stale. Run npm run generate:ui-inventory.');
  }
  console.log(`UI usage inventory is current: ${components.length} canonical controls, ${deepSelectors.length} deep selectors.`);
} else {
  await writeFile(outputPath, serialized);
  console.log(`Wrote ${path.relative(root, outputPath)} with ${components.length} canonical controls.`);
}
