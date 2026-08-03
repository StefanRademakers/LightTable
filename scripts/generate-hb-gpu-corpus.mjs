import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const encoder = resolve(process.argv[2] ?? join(repoRoot, 'tmp', 'slice07-hbgpu', 'hb-gpu-fixture-encoder.exe'));
const generatedRoot = join(repoRoot, 'packages', 'lighttable-app', 'src', 'lighttable', 'text', 'wasm', 'generated');
const wasm = await import(pathToFileURL(join(generatedRoot, 'text_layout_wasm.js')));
await wasm.default({ module_or_path: readFileSync(join(generatedRoot, 'text_layout_wasm_bg.wasm')) });

const fixtures = [
  ['anton', 'Anton-Regular.ttf', 'Anton', 'office Affinity ABC'],
  ['source-serif', 'SourceSerif4-Regular.otf', 'Source Serif 4', 'A\u0301'],
  ['arabic', 'NotoKufiArabic-Slice06.otf', 'Noto Kufi Arabic', '\u0645\u0631\u062d\u0628\u0627'],
  ['hebrew', 'NotoSansHebrew-Slice06.ttf', 'Noto Sans Hebrew', '\u05e9\u05dc\u05d5\u05dd'],
  ['devanagari', 'NotoSansDevanagari-Slice06.ttf', 'Noto Sans Devanagari', '\u0928\u092e\u0938\u094d\u0924\u0947'],
  ['thai', 'NotoSansThai-Slice06.ttf', 'Noto Sans Thai', '\u0e20\u0e32\u0e29\u0e32\u0e44\u0e17\u0e22'],
  ['cjk', 'NotoSansCJKjp-Slice06.otf', 'Noto Sans CJK JP', '\u65e5\u672c\u8a9e\u4e2d\u6587'],
  ['emoji', 'NotoEmoji-Slice06.ttf', 'Noto Emoji', '\ud83d\ude00']
];
const fontRoot = join(repoRoot, 'test', 'fixtures', 'fonts');
const outputRoot = join(repoRoot, 'test', 'fixtures', 'text-renderer', 'hb-gpu');
mkdirSync(outputRoot, { recursive: true });
const manifest = [];
for (const [id, fileName, family, text] of fixtures) {
  const session = `hb-gpu-corpus:${id}`;
  const fontPath = join(fontRoot, fileName);
  const bytes = readFileSync(fontPath);
  wasm.register_layout_font(session, id, bytes);
  const strings = new TextEncoder().encode(family + id);
  const familyBytes = new TextEncoder().encode(family).byteLength;
  const result = wasm.realize_flow_text(
    session, id, text, 1024, 0, 0, 0, 0, 0, 4096,
    new Uint32Array([0, text.length, 0, 0, 0]),
    new Float32Array([24, 400, 100, 0]),
    strings,
    new Uint32Array([0, familyBytes, familyBytes, strings.byteLength])
  );
  const glyphIds = [...new Set(result.glyph_ids())].sort((left, right) => left - right);
  result.free();
  wasm.drop_layout_session(session);
  const outputPath = join(outputRoot, `${id}.lt-hbgpu`);
  execFileSync(encoder, [fontPath, outputPath, ...glyphIds.map(String)], { stdio: 'inherit' });
  const bundle = readFileSync(outputPath);
  manifest.push({
    id, fileName, glyphIds,
    bundleFile: `${id}.lt-hbgpu`,
    bundleBytes: bundle.byteLength,
    bundleSha256: createHash('sha256').update(bundle).digest('hex')
  });
}
writeFileSync(join(outputRoot, 'manifest.json'), `${JSON.stringify({
  schemaVersion: 1,
  harfbuzzRevision: 'c31bd6797a0e55c2b176a7be3a181f36814ec6aa',
  sourceFormat: 'RGBA16I (8 bytes/texel)',
  gpuFormat: 'vec4<i32> storage (16 bytes/texel)',
  fixtures: manifest
}, null, 2)}\n`);
