import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const generatedRoot = join(
  repoRoot,
  'packages',
  'lighttable-app',
  'src',
  'lighttable',
  'text',
  'wasm',
  'generated'
);
const bindings = await import(pathToFileURL(join(generatedRoot, 'text_layout_wasm.js')));
const declarations = await readFile(join(generatedRoot, 'text_layout_wasm.d.ts'), 'utf8');
const workerSource = await readFile(join(
  repoRoot, 'packages', 'lighttable-app', 'src', 'lighttable', 'text', 'wasm', 'textLayout.worker.ts'
), 'utf8');
if (declarations.includes('realize_flow_text_json') || workerSource.includes('realizeFlowTextJson')) {
  throw new Error('Text layout still exposes the removed JSON ABI.');
}
const wasmBytes = await readFile(join(generatedRoot, 'text_layout_wasm_bg.wasm'));
await bindings.default({ module_or_path: wasmBytes });
const version = bindings.text_engine_version();
if (version !== '0.1.0') {
  throw new Error(`Expected LightTable text engine 0.1.0, received ${version}.`);
}
const fixture = await readFile(join(repoRoot, 'test', 'fixtures', 'fonts', 'Anton-Regular.ttf'));
const inspection = JSON.parse(bindings.inspect_font_json(fixture, 0));
if (
  inspection.outline !== 'truetype'
  || inspection.glyphCount < 100
  || inspection.unitsPerEm < 16
) throw new Error('LightTable text WASM returned invalid font inspection metadata.');
const bundledInter = await readFile(join(
  repoRoot,
  'node_modules',
  '@fontsource',
  'inter',
  'files',
  'inter-latin-400-normal.woff2'
));
const bundledInspection = JSON.parse(bindings.inspect_font_json(bundledInter, 0));
if (
  bundledInspection.outline !== 'truetype'
  || bundledInspection.glyphCount < 100
) throw new Error('Production bundled Inter WOFF2 did not decode to a valid SFNT face.');
let rejectedMalformed = false;
try {
  bindings.inspect_font_json(new Uint8Array([0, 1, 0, 0]), 0);
} catch {
  rejectedMalformed = true;
}
if (!rejectedMalformed) throw new Error('LightTable text WASM accepted a malformed font.');
const sessionKey = 'node-runtime:1';
bindings.register_layout_font(sessionKey, 'anton', fixture);
bindings.register_layout_font(sessionKey, 'lighttable-inter-latin-regular', bundledInter);
const bundledStrings = new TextEncoder().encode('Interlighttable-inter-latin-regular');
const bundledLayout = bindings.realize_flow_text(
  sessionKey, 'runtime-bundled-inter', 'Text', 400, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 100,
  new Uint32Array([0, 4, 0, 0, 0]),
  new Float32Array([16, 400, 100, 0]),
  bundledStrings,
  new Uint32Array([0, 5, 5, bundledStrings.length])
);
const bundledGlyphs = bundledLayout.glyph_ids();
if (!bundledGlyphs.length || bundledLayout.bounds()[0] === bundledLayout.bounds()[4]) {
  throw new Error('Production bundled Inter WOFF2 did not shape through Parley.');
}
const bundledMask = bindings.rasterize_registered_glyph(
  sessionKey,
  'lighttable-inter-latin-regular',
  0,
  bundledGlyphs[0],
  16
);
if (!bundledMask.pixels().some((coverage) => coverage > 0)) {
  throw new Error('Production bundled Inter WOFF2 did not rasterize through Skrifa.');
}
bundledMask.free();
bundledLayout.free();
const layoutStartedAt = performance.now();
const layout = bindings.realize_flow_text(
  sessionKey, 'runtime-latin', 'office A😀', 400, 0, 0, 0,
  0, 0, 0, 0, 0, 0.25, 0.5, 100,
  new Uint32Array([0, 10, 0, 0, 0]),
  new Float32Array([24, 400, 100, 0]),
  new TextEncoder().encode('Antonanton'),
  new Uint32Array([0, 5, 5, 10])
);
const layoutDurationMs = performance.now() - layoutStartedAt;
const glyphIds = layout.glyph_ids();
const clusterMap = layout.cluster_map();
const graphemeStops = layout.grapheme_stops();
const bounds = layout.bounds();
if (
  layout.key !== 'runtime-latin'
  || glyphIds.length < 1
  || graphemeStops.at(-1) !== 10
  || !clusterMap.length
  || bounds[0] === bounds[4]
) throw new Error('LightTable Parley WASM returned invalid realized layout data.');
layout.free();
const paragraphLayout = bindings.realize_flow_text(
  sessionKey, 'runtime-paragraph-style', 'A\nB', 220, 1, 1, 60,
  5, 10, 20, 7, 11, 10, 20, 100,
  new Uint32Array([0, 3, 0, 0, 0]),
  new Float32Array([24, 400, 100, 0]),
  new TextEncoder().encode('Antonanton'),
  new Uint32Array([0, 5, 5, 10])
);
const paragraphLines = paragraphLayout.line_geometry();
if (
  paragraphLayout.line_meta().length !== 4
  || paragraphLines[7] - paragraphLines[0] !== 78
  || paragraphLayout.bounds()[4] !== 20
  || paragraphLayout.bounds()[7] !== 156
  || paragraphLayout.geometry()[0] <= 20
) throw new Error('LightTable uniform paragraph-layout ABI returned invalid geometry.');
paragraphLayout.free();
const glyphMask = bindings.rasterize_registered_glyph(sessionKey, 'anton', 0, 36, 24);
const glyphPixels = glyphMask.pixels();
if (
  glyphMask.width < 1 || glyphMask.height < 1
  || glyphMask.width > 256 || glyphMask.height > 256
  || glyphPixels.length !== glyphMask.width * glyphMask.height
  || !glyphPixels.some((coverage) => coverage > 0)
  || glyphMask.command_count < 1
) throw new Error('LightTable hinted glyph raster returned invalid R8 data.');
glyphMask.free();
let rejectedRasterLimit = false;
try { bindings.rasterize_registered_glyph(sessionKey, 'anton', 0, 36, 2); } catch { rejectedRasterLimit = true; }
if (!rejectedRasterLimit) throw new Error('LightTable glyph raster accepted an invalid ppem.');
for (const [label, invoke] of [
  ['malformed packed stride', () => bindings.realize_flow_text(
    sessionKey, 'bad-stride', 'A', 100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 10,
    new Uint32Array([0, 1]), new Float32Array(), new Uint8Array(), new Uint32Array()
  )],
  ['invalid family UTF-8', () => bindings.realize_flow_text(
    sessionKey, 'bad-utf8', 'A', 100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 10,
    new Uint32Array([0, 1, 0, 0, 0]), new Float32Array([12, 400, 100, 0]),
    new Uint8Array([255, 97]), new Uint32Array([0, 1, 1, 2])
  )],
  ['invalid glyph limit', () => bindings.realize_flow_text(
    sessionKey, 'bad-limit', 'A', 100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    new Uint32Array([0, 1, 0, 0, 0]), new Float32Array([12, 400, 100, 0]),
    new TextEncoder().encode('Antonanton'), new Uint32Array([0, 5, 5, 10])
  )]
]) {
  let rejected = false;
  try { invoke(); } catch { rejected = true; }
  if (!rejected) throw new Error(`LightTable text WASM accepted ${label}.`);
}
if (!bindings.drop_layout_session(sessionKey)) {
  throw new Error('LightTable Parley WASM did not release its session.');
}
const corpus = [
  ['arabic', 'NotoKufiArabic-Slice06.otf', 'Noto Kufi Arabic', 'مرحبا'],
  ['hebrew', 'NotoSansHebrew-Slice06.ttf', 'Noto Sans Hebrew', 'שלום'],
  ['devanagari', 'NotoSansDevanagari-Slice06.ttf', 'Noto Sans Devanagari', 'नमस्ते'],
  ['thai', 'NotoSansThai-Slice06.ttf', 'Noto Sans Thai', 'ภาษาไทย'],
  ['cjk', 'NotoSansCJKjp-Slice06.otf', 'Noto Sans CJK JP', '日本語中文'],
  ['emoji', 'NotoEmoji-Slice06.ttf', 'Noto Emoji', '😀']
];
const expectedCorpusHashes = new Map([
  ['arabic', 'cc2edd8aad328441e7817f31e224887d98e472452dcafadb400c54bc18ae5b71'],
  ['hebrew', 'a0527e81dd6f7fd7e66c9c333e7c7da9c10122fc184d37205e87a686640f20ba'],
  ['devanagari', '9d2fe030fd7292cbe780b44355e71cdb740ee5928b33d3b5336693e9e505317e'],
  ['thai', 'b1025b3a34a658285a61b1c36f5948b0b792e8c2a9f3784e99e8b080fc8a8f0d'],
  ['cjk', 'bc266e15ffc7d4c0a92733cc9b5217d37f7d2104eb1a2dbccfaae91ebde3ca72'],
  ['emoji', 'e61141760ad9cf26a0670f78763d959d7e91c924a90393452e8d99495b205496']
]);
const corpusSession = 'node-corpus:1';
const corpusHashes = [];
for (const [id, fileName, family, text] of corpus) {
  const bytes = await readFile(join(repoRoot, 'test', 'fixtures', 'fonts', fileName));
  bindings.register_layout_font(corpusSession, id, bytes);
  const strings = new TextEncoder().encode(family + id);
  const result = bindings.realize_flow_text(
    corpusSession, id, text, 320, 0, 0, 0,
    0, 0, 0, 0, 0, 0.25, 0.5, 1000,
    new Uint32Array([0, text.length, 0, 0, 0]),
    new Float32Array([24, 400, 100, 0]),
    strings,
    new Uint32Array([0, family.length, family.length, family.length + id.length])
  );
  const runMeta = result.run_meta();
  const glyphs = result.glyph_ids();
  const clusters = result.clusters();
  const geometry = result.geometry();
  if (!glyphs.length || runMeta[2] !== 1 || result.grapheme_stops().at(-1) !== text.length) {
    throw new Error(`Complex-script corpus failed for ${id}.`);
  }
  const structuralHash = createHash('sha256').update(JSON.stringify({
    runMeta: [...runMeta], glyphs: [...glyphs], clusters: [...clusters],
    geometry: [...geometry].map((value) => Math.round(value * 1000))
  })).digest('hex');
  if (structuralHash !== expectedCorpusHashes.get(id)) {
    throw new Error(`Structural layout golden changed for ${id}: ${structuralHash}.`);
  }
  corpusHashes.push(`${id}:${structuralHash}`);
  result.free();
}
if (!bindings.drop_layout_session(corpusSession)) {
  throw new Error('LightTable Parley WASM did not release its corpus session.');
}
console.log(
  `LightTable text WASM runtime passed: v${version}, ${inspection.glyphCount} fixture glyphs, `
  + `${glyphIds.length} shaped glyphs in ${layoutDurationMs.toFixed(2)} ms, `
  + `${bindings.text_engine_memory_bytes()} bytes WASM memory.`
);
console.log(`LightTable typography structural goldens: ${corpusHashes.join(', ')}`);
