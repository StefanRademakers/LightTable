import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import agPsd from 'ag-psd';

const workspaceRoot = path.resolve(import.meta.dirname, '..');
const defaultCorpusRoot = 'D:\\mediavibe\\LightTableTestFiles\\psd\\templates\\Save the Date Invitation PSD 6';
const defaultOutput = path.join(
  workspaceRoot,
  'work',
  'done',
  'task_049_psd_template_corpus_feature_audit',
  'corpus-inventory.json'
);
const argument = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};
const corpusRoot = path.resolve(argument('root', defaultCorpusRoot));
const outputFile = path.resolve(argument('output', defaultOutput));
const colorModes = {
  0: 'bitmap', 1: 'grayscale', 2: 'indexed', 3: 'rgb', 4: 'cmyk',
  7: 'multichannel', 8: 'duotone', 9: 'lab'
};
const effectProperties = [
  ['dropShadow', 'drop-shadow'],
  ['innerShadow', 'inner-shadow'],
  ['outerGlow', 'outer-glow'],
  ['innerGlow', 'inner-glow'],
  ['bevel', 'bevel-emboss'],
  ['solidFill', 'color-overlay'],
  ['satin', 'satin'],
  ['stroke', 'stroke'],
  ['gradientOverlay', 'gradient-overlay'],
  ['patternOverlay', 'pattern-overlay']
];

const filesBelow = async (root) => {
  const result = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) result.push(...await filesBelow(absolute));
    else result.push(absolute);
  }
  return result;
};

const layerType = (layer) => {
  if (layer.children) return 'group';
  if (layer.adjustment) return 'adjustment';
  if (layer.text) return 'text';
  if (layer.placedLayer) return 'smart-object';
  if (layer.vectorFill || layer.vectorMask || layer.vectorStroke) return 'vector';
  return 'raster';
};

const effectInstances = (effects) => {
  if (!effects) return [];
  const instances = [];
  for (const [property, kind] of effectProperties) {
    const raw = effects[property];
    const values = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
    values.forEach((descriptor, instance) => {
      const enabled = !(effects.disabled ?? false)
        && descriptor?.present !== false
        && descriptor?.enabled !== false;
      instances.push({
        kind,
        instance,
        enabled,
        present: descriptor?.present ?? null,
        fillType: descriptor?.fillType ?? null,
        gradientType: descriptor?.gradient?.type ?? null,
        position: descriptor?.position ?? null
      });
    });
  }
  return instances;
};

const textFonts = (text) => {
  const names = new Set();
  if (text?.style?.font?.name) names.add(text.style.font.name);
  text?.styleRuns?.forEach((run) => {
    if (run.style?.font?.name) names.add(run.style.font.name);
  });
  return [...names].sort();
};

const finiteBounds = (layer) => {
  const left = Number(layer.left ?? 0);
  const top = Number(layer.top ?? 0);
  const right = Number(layer.right ?? left);
  const bottom = Number(layer.bottom ?? top);
  return { left, top, right, bottom, width: right - left, height: bottom - top };
};

const summarizeLayer = (layer, document, depth, address, parentAddress) => {
  const type = layerType(layer);
  const bounds = finiteBounds(layer);
  const effects = effectInstances(layer.effects);
  const fonts = textFonts(layer.text);
  const transform = layer.text?.transform ?? layer.placedLayer?.transform ?? null;
  return {
    address,
    parentAddress,
    sourceId: layer.id ?? null,
    depth,
    name: layer.name?.trim() || 'Layer',
    type,
    visible: !layer.hidden,
    bounds,
    outsideCanvas: bounds.left < 0 || bounds.top < 0
      || bounds.right > document.width || bounds.bottom > document.height,
    largerThanCanvas: bounds.width > document.width || bounds.height > document.height,
    blendMode: layer.blendMode ?? 'normal',
    opacity: layer.opacity ?? 1,
    fillOpacity: layer.fillOpacity ?? 1,
    clipping: Boolean(layer.clipping),
    groupCompositing: type === 'group'
      ? layer.blendMode === 'pass through' ? 'pass-through' : 'isolated'
      : null,
    masks: {
      user: Boolean(layer.mask),
      real: Boolean(layer.realMask),
      vector: Boolean(layer.vectorMask),
      densityOrFeather: Boolean(
        layer.mask?.userMaskDensity !== undefined
        || layer.mask?.userMaskFeather !== undefined
        || layer.mask?.vectorMaskDensity !== undefined
        || layer.mask?.vectorMaskFeather !== undefined
      )
    },
    effects,
    activeEffects: effects.filter(({ enabled }) => enabled).map(({ kind }) => kind),
    dormantEffects: effects.filter(({ enabled }) => !enabled).map(({ kind }) => kind),
    adjustment: layer.adjustment?.type ?? null,
    vector: type === 'vector' ? {
      fillType: layer.vectorFill?.type ?? (layer.vectorFill ? 'descriptor' : null),
      hasStroke: Boolean(layer.vectorStroke),
      hasPath: Boolean(layer.vectorMask),
      originations: layer.vectorOrigination?.keyDescriptorList?.length ?? 0
    } : null,
    text: type === 'text' ? {
      characters: layer.text?.text?.length ?? 0,
      fonts,
      shapeType: layer.text?.shapeType ?? null,
      orientation: layer.text?.orientation ?? null,
      hasPath: Boolean(layer.text?.textPath?.bezierCurve?.controlPoints?.length),
      hasWarp: Boolean(layer.text?.warp && layer.text.warp.style !== 'none'),
      transform,
      runCount: layer.text?.styleRuns?.length ?? 0
    } : null,
    smartObject: type === 'smart-object' ? {
      kind: layer.placedLayer?.type ?? 'unknown',
      placed: layer.placedLayer?.placed ?? null,
      hasNonAffineTransform: Boolean(layer.placedLayer?.nonAffineTransform),
      hasWarp: Boolean(layer.placedLayer?.warp && layer.placedLayer.warp.style !== 'none'),
      hasFilters: Boolean(layer.placedLayer?.filter?.list?.length)
    } : null,
    sourceKeys: Object.keys(layer).sort()
  };
};

const inspectDocument = async (psdFile, allFiles) => {
  const warnings = [];
  const bytes = await readFile(psdFile);
  const psd = agPsd.readPsd(bytes, {
    skipLayerImageData: true,
    skipCompositeImageData: true,
    skipThumbnail: true,
    skipLinkedFilesData: true,
    logMissingFeatures: true,
    log: (message) => warnings.push(String(message))
  });
  const layers = [];
  const walk = (nodes, depth = 0, parentAddress = null) => {
    nodes?.forEach((layer, index) => {
      const address = parentAddress === null ? `${index}` : `${parentAddress}.${index}`;
      layers.push(summarizeLayer(layer, psd, depth, address, parentAddress));
      walk(layer.children, depth + 1, address);
    });
  };
  walk(psd.children);
  const stem = path.basename(psdFile, path.extname(psdFile));
  const reference = allFiles.find((candidate) => (
    path.dirname(candidate) === path.dirname(psdFile)
    && /\.(jpe?g|png)$/i.test(candidate)
    && path.basename(candidate, path.extname(candidate)).startsWith(stem)
  )) ?? null;
  return {
    id: stem,
    source: psdFile,
    sourceBytes: (await stat(psdFile)).size,
    reference,
    width: psd.width,
    height: psd.height,
    bitsPerChannel: psd.bitsPerChannel ?? 8,
    colorMode: colorModes[psd.colorMode] ?? `unknown-${psd.colorMode}`,
    layerCount: layers.length,
    maximumDepth: Math.max(0, ...layers.map(({ depth }) => depth)),
    warnings: [...new Set(warnings)].sort(),
    layers
  };
};

const featureDefinitions = [
  ['groups', (layer) => layer.type === 'group'],
  ['pass-through groups', (layer) => layer.groupCompositing === 'pass-through'],
  ['clipping layers', (layer) => layer.clipping],
  ['user/real raster masks', (layer) => layer.masks.user || layer.masks.real],
  ['vector masks', (layer) => layer.masks.vector],
  ['off-canvas bounds', (layer) => layer.outsideCanvas],
  ['layers larger than canvas', (layer) => layer.largerThanCanvas],
  ['non-normal blend modes', (layer) => !['normal', 'pass through'].includes(layer.blendMode)],
  ['partial opacity', (layer) => layer.opacity !== 1],
  ['partial fill opacity', (layer) => layer.fillOpacity !== 1],
  ['active layer styles', (layer) => layer.activeEffects.length > 0],
  ['dormant layer-style descriptors', (layer) => layer.dormantEffects.length > 0],
  ['vector shape layers', (layer) => layer.type === 'vector'],
  ['vector strokes', (layer) => layer.vector?.hasStroke],
  ['gradient vector fills', (layer) => /gradient/i.test(layer.vector?.fillType ?? '')],
  ['pattern vector fills', (layer) => /pattern/i.test(layer.vector?.fillType ?? '')],
  ['adjustment layers', (layer) => layer.type === 'adjustment'],
  ['text layers', (layer) => layer.type === 'text'],
  ['text on path', (layer) => layer.text?.hasPath],
  ['warped text', (layer) => layer.text?.hasWarp],
  ['smart objects', (layer) => layer.type === 'smart-object'],
  ['non-affine/warped smart objects', (layer) => (
    layer.smartObject?.hasNonAffineTransform || layer.smartObject?.hasWarp
  )],
  ['smart filters', (layer) => layer.smartObject?.hasFilters]
];

const allFiles = await filesBelow(corpusRoot);
const psdFiles = allFiles.filter((file) => /\.psd$/i.test(file)).sort();
const documents = [];
for (const psdFile of psdFiles) documents.push(await inspectDocument(psdFile, allFiles));
const featureMatrix = featureDefinitions.map(([feature, predicate]) => {
  const affected = documents.map((document) => ({
    document: document.id,
    layers: document.layers.filter(predicate).map(({ address, name }) => ({ address, name }))
  })).filter(({ layers }) => layers.length > 0);
  return {
    feature,
    documentCount: affected.length,
    layerCount: affected.reduce((count, entry) => count + entry.layers.length, 0),
    documents: affected
  };
});
const distinct = (selector) => [...new Set(documents.flatMap(({ layers }) => layers.flatMap(selector)))].sort();
const report = {
  schema: 1,
  generatedAt: new Date().toISOString(),
  corpusRoot,
  documentCount: documents.length,
  totals: {
    layers: documents.reduce((count, document) => count + document.layerCount, 0),
    parserWarnings: documents.reduce((count, document) => count + document.warnings.length, 0)
  },
  distinct: {
    layerTypes: distinct((layer) => [layer.type]),
    blendModes: distinct((layer) => [layer.blendMode]),
    adjustmentTypes: distinct((layer) => layer.adjustment ? [layer.adjustment] : []),
    activeEffectTypes: distinct((layer) => layer.activeEffects),
    dormantEffectTypes: distinct((layer) => layer.dormantEffects),
    fonts: distinct((layer) => layer.text?.fonts ?? []),
    vectorFillTypes: distinct((layer) => layer.vector?.fillType ? [layer.vector.fillType] : [])
  },
  featureMatrix,
  documents
};
await writeFile(outputFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify({ outputFile, documents: documents.length, layers: report.totals.layers })}\n`);
