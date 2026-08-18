import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const columns = [
  'create', 'import', 'edit', 'undo', 'native-save-reopen',
  'psd-export-reopen', 'visual-parity'
];
const statuses = new Set(['supported', 'partial', 'preserved', 'unavailable']);

const sourceFiles = {
  layers: 'packages/lighttable-app/src/lighttable/editor/document/documentTypes.ts',
  blends: 'packages/lighttable-app/src/lighttable/editor/document/blendModes.ts',
  styles: 'packages/lighttable-app/src/lighttable/editor/styles/layerStyleTypes.ts',
  processing: 'packages/lighttable-app/src/lighttable/processing/moduleDefinitions.ts',
  vectors: 'packages/vector-core/src/model/types.ts',
  gradients: 'packages/paint-core/src/gradient.ts'
};

const source = async (key) => readFile(path.join(workspace, sourceFiles[key]), 'utf8');
const quoted = (text) => [...text.matchAll(/'([^']+)'/g)].map((match) => match[1]);
const block = (text, start, end) => {
  const from = text.indexOf(start);
  const to = text.indexOf(end, from + start.length);
  if (from < 0 || to < 0) throw new Error(`Canonical block not found: ${start}`);
  return text.slice(from, to);
};
const unique = (values) => [...new Set(values)];

export const readCanonicalInterchangeInventory = async () => {
  const [layers, blends, styles, processing, vectors, gradients] = await Promise.all(
    Object.keys(sourceFiles).map(source)
  );
  const layerUnion = block(layers, 'export type LayerNode =', ';');
  const layerInterfaces = Object.fromEntries([...layerUnion.matchAll(/([A-Z][A-Za-z]+Layer)/g)]
    .map((match) => match[1])
    .map((name) => {
      const declarationStart = Math.max(
        layers.indexOf(`export interface ${name}`),
        layers.indexOf(`export type ${name}`)
      );
      const declarationEnd = layers.indexOf('\nexport ', declarationStart + 1);
      const declaration = layers.slice(declarationStart,
        declarationEnd < 0 ? layers.length : declarationEnd);
      const expression = /(?:readonly\s+)?type:\s*'([^']+)'/.exec(declaration);
      if (!expression) throw new Error(`Layer discriminator not found for ${name}.`);
      return [name, expression[1]];
    }));
  const blendBlock = block(blends, 'export const BLEND_MODES = [', '] as const');
  const styleBlock = block(styles, 'export type LayerStyleKind =', ';');
  const processingBlock = block(processing, 'export const CURRENT_PROCESSING_MODULES = [', '] as const');
  const liveShapeBlock = block(vectors, 'export type LiveShapeGeometry =', ';');
  const elementBlock = block(vectors, 'export type VectorElement =', ';');
  const paintBlock = block(vectors, 'export type VectorPaint =', ';');
  const gradientType = block(gradients, 'export interface GradientAsset', '}');
  return {
    sources: sourceFiles,
    layers: Object.values(layerInterfaces),
    blends: [...blendBlock.matchAll(/id:\s*'([^']+)'/g)].map((match) => match[1]),
    styles: quoted(styleBlock),
    processing: [...processingBlock.matchAll(/type:\s*'(lt\.[^']+)'/g)].map((match) => match[1]),
    vectorElements: unique([
      ...elementBlock.matchAll(/Vector(Path|LiveShape)/g)
    ].map((match) => match[1] === 'Path' ? 'path' : 'live-shape')),
    liveShapes: unique([...liveShapeBlock.matchAll(/([A-Z][A-Za-z]+)ShapeGeometry/g)]
      .map((match) => match[1].replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase())),
    vectorPaints: unique([
      ...paintBlock.includes('SolidPaint') ? ['solid'] : [],
      ...paintBlock.includes('GradientPaintInstance') ? ['gradient'] : []
    ]),
    gradientAssets: unique(quoted(gradientType).filter((value) => ['solid', 'noise'].includes(value)))
  };
};

const evidence = {
  lifecycle: {
    kind: 'test',
    command: 'npm test -w @lighttable/app -- documentCommands layeredDocumentFormat',
    proves: 'Canonical document edits, history and native serialization are executable.'
  },
  psdFocused: {
    kind: 'test',
    command: 'npm run smoke:desktop:psd-roundtrip -- D:\\TextTest.psd && npm run smoke:desktop:psd-roundtrip -- D:\\shapes.psd',
    proves: 'Photoshop-authored text/vector documents survive LightTable PSD projection and reopen.'
  },
  photoshopBridge: {
    kind: 'test',
    command: 'Photoshop.exe -r scripts/photoshop-psd-roundtrip.jsx',
    proves: 'Photoshop accepts the latest LightTable PSD and writes a PSD which LightTable can reopen.'
  },
  blends48: {
    kind: 'visual-test',
    command: 'npm run audit:psd-blend-corpus -- --root D:\\Mediavibe\\LightTableTests\\BlendColorMatrix --max-rmse 3',
    proves: 'The 48-case Photoshop color/blend corpus compares non-empty settled pixels.'
  },
  blendsAll: {
    kind: 'visual-test',
    command: 'npm run audit:psd-blend-corpus -- --root D:\\Mediavibe\\LightTableTests\\BlendModes',
    proves: 'All 26 canonical blend modes plus opacity/fill variants have settled Photoshop comparisons; matrix status owns the fidelity boundary.'
  },
  effects40: {
    kind: 'visual-test',
    command: 'npm run audit:psd-effects-corpus -- --root D:\\mediavibe\\LightTableTestFiles\\psd\\layer-effects-roundtrip --strict',
    proves: 'The 40-case layer-style corpus validates semantics, self-roundtrip and settled pixels.'
  },
  templates10: {
    kind: 'corpus',
    command: 'node scripts/audit-psd-template-corpus.mjs --root "D:\\mediavibe\\LightTableTestFiles\\psd\\templates\\Save the Date Invitation PSD 6"',
    proves: 'Ten production templates inventory dependency-sensitive and unsupported PSD constructs.'
  },
  previewFreshness: {
    kind: 'test',
    command: 'npm test -w @lighttable/app -- derivedPreview',
    proves: 'A derived preview is eligible only while its semantic dependency key is current.'
  },
  soloContext: {
    kind: 'visual-test',
    command: 'node scripts/verify-layered-interchange-evidence.mjs --check-renders',
    proves: 'Dependency-sensitive features have non-empty solo and contextual settled captures.'
  },
  explicitBoundary: {
    kind: 'reason',
    command: null,
    proves: 'No verified adapter exists; metadata/preview preservation is the release boundary.'
  }
};

const cell = (status, evidenceIds, reason) => ({ status, evidence: evidenceIds, reason });
const supported = (ids, reason) => cell('supported', ids, reason);
const partial = (ids, reason) => cell('partial', ids, reason);
const preserved = (reason) => cell('preserved', ['explicitBoundary', 'previewFreshness'], reason);
const unavailable = (reason) => cell('unavailable', ['explicitBoundary'], reason);

const lifecycleCells = (psdStatus, psdEvidence, psdReason, visualStatus = psdStatus) => ({
  create: supported(['lifecycle'], 'The canonical LightTable model can create this feature.'),
  import: psdStatus === 'supported'
    ? supported(psdEvidence, psdReason)
    : psdStatus === 'partial' ? partial(psdEvidence, psdReason) : preserved(psdReason),
  edit: supported(['lifecycle'], 'The authoritative semantic payload is editable.'),
  undo: supported(['lifecycle'], 'Edits use document history transactions.'),
  'native-save-reopen': supported(['lifecycle'], 'The native format serializes the canonical payload.'),
  'psd-export-reopen': psdStatus === 'supported'
    ? supported(psdEvidence, psdReason)
    : psdStatus === 'partial' ? partial(psdEvidence, psdReason) : preserved(psdReason),
  'visual-parity': visualStatus === 'supported'
    ? supported(psdEvidence, psdReason)
    : visualStatus === 'partial' ? partial(psdEvidence, psdReason) : preserved(psdReason)
});

const row = (id, family, capability, cells, options = {}) => ({
  id, family, capability, dependencySensitive: Boolean(options.dependencySensitive),
  evidenceViews: options.dependencySensitive ? ['solo', 'context'] : ['context'], cells
});

export const createLayeredInterchangeMatrix = async () => {
  const inventory = await readCanonicalInterchangeInventory();
  const rows = [];
  for (const kind of inventory.layers) {
    const supportedKind = kind === 'raster';
    rows.push(row(`layer:${kind}`, 'layer', kind, lifecycleCells(
      supportedKind ? 'supported' : 'partial',
      supportedKind ? ['psdFocused', 'photoshopBridge'] : ['psdFocused', 'photoshopBridge', 'soloContext'],
      supportedKind
        ? 'Raster structure and pixels are verified through both PSD directions.'
        : `${kind} semantics are native, but the verified Photoshop subset is narrower than the canonical model.`,
      supportedKind ? 'supported' : 'partial'
    ), { dependencySensitive: ['group', 'adjustment'].includes(kind) }));
  }
  rows.push(row('geometry:off-canvas', 'geometry', 'off-canvas layer bounds',
    lifecycleCells('supported', ['psdFocused', 'photoshopBridge'],
      'Layer-local bounds remain unbounded; clipping occurs only at final canvas composition.')));
  rows.push(row('mask:raster', 'mask', 'raster mask density and feather',
    lifecycleCells('partial', ['psdFocused', 'soloContext'],
      'Raster masks are editable; real/vector masks are rasterized while original descriptors remain preserved.'),
    { dependencySensitive: true }));
  rows.push(row('composition:clipping', 'composition', 'clipping chain',
    lifecycleCells('partial', ['psdFocused', 'soloContext'],
      'Clipping is semantic and editable; complex nested/group chains remain contextual parity work.'),
    { dependencySensitive: true }));
  rows.push(row('composition:fill-opacity', 'composition', 'fill opacity separate from effects',
    lifecycleCells('partial', ['effects40', 'soloContext'],
      'The model separates fill and layer opacity; effect interaction remains fixture-calibrated rather than universally exact.'),
    { dependencySensitive: true }));
  for (const mode of inventory.blends) {
    const cells = lifecycleCells('supported', ['blendsAll', 'blends48'],
      'Canonical GPU/PSD mapping is covered by the all-mode corpus; color-profile representatives also pass the 48-case corpus.');
    if (mode === 'darker-color') cells['visual-parity'] = partial(['blendsAll'],
      'Semantic mapping passes, but the settled Photoshop comparison is RMSE 3.05 and remains a declared parity gap.');
    rows.push(row(`blend:${mode}`, 'blend-mode', mode, cells));
  }
  for (const kind of inventory.styles) rows.push(row(`style:${kind}`, 'layer-style', kind,
    lifecycleCells('partial', ['effects40', 'soloContext'],
      'The style is semantic and roundtrips in the verified corpus; exact Photoshop pixels remain parameter-dependent.'),
    { dependencySensitive: true }));
  for (const type of inventory.processing) rows.push(row(`processing:${type}`, 'processing', type, {
    ...lifecycleCells('partial', ['templates10', 'soloContext'],
      'The native processing module is editable; only verified Photoshop adjustment projections are semantic.', 'partial'),
    'psd-export-reopen': partial(['templates10'],
      'PSD export emits a verified descriptor, uses an appearance-safe owner-layer bake, or blocks before publishing; unsupported free processing is never silently omitted.')
  }, { dependencySensitive: true }));
  for (const kind of inventory.vectorElements) rows.push(row(`vector-element:${kind}`, 'vector-element', kind,
    lifecycleCells('partial', ['psdFocused', 'photoshopBridge'],
      'Native vector geometry is editable; Photoshop export supports the verified common-style subset.')));
  for (const kind of inventory.liveShapes) rows.push(row(`live-shape:${kind}`, 'live-shape', kind,
    lifecycleCells('partial', ['psdFocused', 'photoshopBridge'],
      'The parametric shape is native; PSD stores realized Photoshop vector geometry and may not retain LightTable parameters.')));
  for (const kind of inventory.vectorPaints) rows.push(row(`vector-paint:${kind}`, 'vector-paint', kind,
    lifecycleCells(kind === 'solid' ? 'supported' : 'partial', ['psdFocused', 'photoshopBridge'],
      kind === 'solid' ? 'Solid fill/stroke paint is in the verified PSD subset.'
        : 'Gradient geometry is native; Photoshop gradient variants and methods are only partially mapped.')));
  for (const kind of inventory.gradientAssets) rows.push(row(`gradient-asset:${kind}`, 'gradient-asset', kind,
    lifecycleCells(kind === 'solid' ? 'partial' : 'preserved', ['psdFocused'],
      kind === 'solid' ? 'Editable stop gradients are supported with a partial Photoshop method mapping.'
        : 'Noise gradients retain source semantics/preview; there is no complete editable Photoshop mapping.')));
  rows.push(row('fallback:retained-unsupported-preview', 'fallback', 'retained unsupported semantic preview', {
    create: unavailable('Fallback previews are import artifacts, not authoring features.'),
    import: preserved('Unsupported source descriptors and a bounded preview are retained explicitly.'),
    edit: unavailable('Editing requires a native adapter or an explicit destructive rasterize action.'),
    undo: unavailable('There is no implicit edit to an unsupported payload.'),
    'native-save-reopen': supported(['previewFreshness', 'lifecycle'],
      'The native format retains source metadata and its bounded preview without making it authority.'),
    'psd-export-reopen': preserved('The original descriptor remains preservation authority where export supports it.'),
    'visual-parity': preserved('Current previews preserve appearance only while their dependency key remains current.')
  }));
  const matrix = {
    schema: 1,
    statusVocabulary: [...statuses],
    columns,
    inventory,
    evidence,
    rows
  };
  validateLayeredInterchangeMatrix(matrix);
  return matrix;
};

export const validateLayeredInterchangeMatrix = (matrix) => {
  const ids = new Set();
  for (const entry of matrix.rows) {
    if (ids.has(entry.id)) throw new Error(`Duplicate matrix row: ${entry.id}`);
    ids.add(entry.id);
    if (entry.dependencySensitive
      && JSON.stringify(entry.evidenceViews) !== JSON.stringify(['solo', 'context'])) {
      throw new Error(`${entry.id} requires solo and context evidence.`);
    }
    for (const column of columns) {
      const value = entry.cells[column];
      if (!value || !statuses.has(value.status) || !value.reason.trim() || !value.evidence.length) {
        throw new Error(`${entry.id}/${column} lacks a status, evidence or reason.`);
      }
      for (const evidenceId of value.evidence) {
        if (!matrix.evidence[evidenceId]) throw new Error(`${entry.id} cites unknown evidence ${evidenceId}.`);
      }
    }
  }
  for (const [family, values] of Object.entries({
    layer: matrix.inventory.layers,
    'blend-mode': matrix.inventory.blends,
    'layer-style': matrix.inventory.styles,
    processing: matrix.inventory.processing,
    'vector-element': matrix.inventory.vectorElements,
    'live-shape': matrix.inventory.liveShapes,
    'vector-paint': matrix.inventory.vectorPaints,
    'gradient-asset': matrix.inventory.gradientAssets
  })) {
    for (const capability of values) {
      if (!matrix.rows.some((entry) => entry.family === family && entry.capability === capability)) {
        throw new Error(`Canonical capability omitted: ${family}/${capability}`);
      }
    }
  }
  return matrix;
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outputIndex = process.argv.indexOf('--output');
  const output = path.resolve(outputIndex >= 0 && process.argv[outputIndex + 1]
    ? process.argv[outputIndex + 1]
    : 'architecture/contracts/LAYERED_INTERCHANGE_RELEASE_MATRIX.json');
  const check = process.argv.includes('--check');
  const serialized = `${JSON.stringify(await createLayeredInterchangeMatrix(), null, 2)}\n`;
  if (check) {
    const current = await readFile(output, 'utf8');
    // Git may materialize text files with CRLF on Windows even though the
    // generator intentionally emits platform-independent LF. Content checks
    // must not turn a clean detached checkout into a false stale result.
    if (current.replaceAll('\r\n', '\n') !== serialized) {
      throw new Error(`${path.relative(workspace, output)} is stale.`);
    }
  } else {
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, serialized);
    process.stdout.write(`Wrote ${path.relative(workspace, output)}\n`);
  }
}
