import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { brotliCompressSync, constants as zlibConstants, gzipSync } from 'node:zlib';

const workspace = path.resolve(import.meta.dirname, '..');
const baselinePath = path.join(workspace, 'architecture', 'tests', 'web-delivery-baseline.json');

export const classifyWebAsset = (name, rules) => {
  const rule = rules.find(({ pattern }) => new RegExp(pattern, 'u').test(name));
  return rule ? { loadBoundary: rule.loadBoundary, userFlow: rule.userFlow } : null;
};

export const auditWebDelivery = async ({
  dist = path.join(workspace, 'apps', 'web', 'dist'),
  output = path.join(workspace, 'tmp', 'code-quality', 'web-delivery.json')
} = {}) => {
  const baseline = JSON.parse(await readFile(baselinePath, 'utf8'));
  if (baseline.schemaVersion !== 1 || !baseline.startupGoal || !Array.isArray(baseline.assetRules)) {
    throw new Error('The web-delivery baseline is invalid.');
  }
  const html = await readFile(path.join(dist, 'index.html'), 'utf8').catch(() => {
    throw new Error('Production web build is missing. Run npm run build:web before the delivery audit.');
  });
  const initialNames = new Set([...html.matchAll(/(?:src|href)="\/assets\/([^"]+)"/gu)]
    .map((match) => match[1]));
  const assetsRoot = path.join(dist, 'assets');
  const assets = [];
  for (const entry of await readdir(assetsRoot, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const bytes = await readFile(path.join(assetsRoot, entry.name));
    const classification = classifyWebAsset(entry.name, baseline.assetRules);
    assets.push({
      name: entry.name,
      initial: initialNames.has(entry.name),
      rawBytes: bytes.byteLength,
      gzipBytes: gzipSync(bytes, { level: 9 }).byteLength,
      brotliBytes: brotliCompressSync(bytes, { params: {
        [zlibConstants.BROTLI_PARAM_QUALITY]: 6
      } }).byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      ...(classification ?? { loadBoundary: 'unclassified', userFlow: null })
    });
  }
  assets.sort((left, right) => right.rawBytes - left.rawBytes || left.name.localeCompare(right.name));
  const initialJavaScript = assets.filter(({ initial, name }) => initial && /\.(?:js|mjs)$/u.test(name));
  const initialCss = assets.filter(({ initial, name }) => initial && name.endsWith('.css'));
  const sum = (values, field) => values.reduce((total, value) => total + value[field], 0);
  const failures = [];
  for (const asset of assets.filter(({ rawBytes }) => rawBytes >= baseline.heavyAssetThresholdBytes)) {
    if (asset.loadBoundary === 'unclassified') failures.push(`heavy asset ${asset.name} has no user-flow/load-boundary owner`);
    if (asset.initial && asset.loadBoundary !== 'initial') {
      failures.push(`feature asset ${asset.name} became initial despite ${asset.userFlow ?? 'unknown ownership'}`);
    }
  }
  const initialJavaScriptRawBytes = sum(initialJavaScript, 'rawBytes');
  const initialCssRawBytes = sum(initialCss, 'rawBytes');
  if (initialJavaScriptRawBytes > baseline.baseline.initialJavaScriptRawBytes * baseline.maximumRegressionRatio) {
    failures.push(`initial JavaScript grew beyond the measured regression band: ${initialJavaScriptRawBytes} bytes`);
  }
  if (initialCssRawBytes > baseline.baseline.initialCssRawBytes * baseline.maximumRegressionRatio) {
    failures.push(`initial CSS grew beyond the measured regression band: ${initialCssRawBytes} bytes`);
  }
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    startupGoal: baseline.startupGoal,
    budgetBasis: {
      measuredAt: baseline.measuredAt,
      baseline: baseline.baseline,
      maximumRegressionRatio: baseline.maximumRegressionRatio,
      interpretation: 'Regression guard around a measured baseline, not a claim that the current payload is optimal.'
    },
    compressionMeasurement: 'gzip level 9; Brotli quality 6 for repeatable quality-gate runtime',
    initial: {
      javascript: { files: initialJavaScript.map(({ name }) => name), rawBytes: initialJavaScriptRawBytes,
        gzipBytes: sum(initialJavaScript, 'gzipBytes'), brotliBytes: sum(initialJavaScript, 'brotliBytes') },
      css: { files: initialCss.map(({ name }) => name), rawBytes: initialCssRawBytes,
        gzipBytes: sum(initialCss, 'gzipBytes'), brotliBytes: sum(initialCss, 'brotliBytes') }
    },
    heavyAssets: assets.filter(({ rawBytes }) => rawBytes >= baseline.heavyAssetThresholdBytes),
    failures
  };
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  if (failures.length > 0) throw new Error(`Web-delivery audit failed:\n- ${failures.join('\n- ')}`);
  process.stdout.write(`Web-delivery audit passed: ${(initialJavaScriptRawBytes / 1_000_000).toFixed(2)} MB initial JS, ${(initialCssRawBytes / 1_000).toFixed(1)} kB initial CSS. Report: ${output}\n`);
  return report;
};

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await auditWebDelivery({
    ...(process.argv[2] ? { output: path.resolve(process.argv[2]) } : {})
  });
}
