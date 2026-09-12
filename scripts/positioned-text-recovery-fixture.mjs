import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { rolldown } from 'rolldown';
import sharp from 'sharp';

// Author a genuine native layered file through the production codec, not a
// renderer-state injection or a raster-only PDF import.
export async function createPositionedRecoveryFixture(root, directory) {
  const load = async relative => {
    const bundle = await rolldown({ input: path.join(root, relative), platform: 'node',
      plugins: [{ name: 'metadata-only-font-urls',
        resolveId(id) { return id.endsWith('.woff2?url') ? `\0${id}` : null; },
        load(id) { return id.startsWith('\0') ? 'export default "unused-fixture-font-url";' : null; }
      }] });
    const result = await bundle.generate({ format: 'esm' });
    await bundle.close();
    const modulePath = path.join(directory, `${path.basename(relative, '.ts')}-fixture-module.mjs`);
    assert.equal(result.output.length, 1);
    await writeFile(modulePath, result.output[0].code);
    return import(pathToFileURL(modulePath));
  };
    const base = 'packages/lighttable-app/src/lighttable';
    const { createImageDocument } = await load(`${base}/editor/document/documentTypes.ts`);
    const { createTextLayer } = await load(`${base}/editor/document/documentCommands.ts`);
    const { buildLayeredDocumentFile, parseLayeredDocumentFile } = await load(`${base}/editor/persistence/layeredDocumentFormat.ts`);
    const { createDefaultAdjustments } = await load(`${base}/types.ts`);
    const { createAdjustmentStackFromBasicAdjustments } = await load(`${base}/processing/adjustmentStack.ts`);
    const { BUNDLED_TEXT_FONT_CATALOG } = await load(`${base}/text/fonts/bundledTextFont.ts`);
    const { createPositionedTextFixture, analyzePositionedTextRecovery } = await load('packages/text-core/src/index.ts');
    const font = BUNDLED_TEXT_FONT_CATALOG.find(item => item.assetId === 'lighttable-inter-latin-regular');
    assert.ok(font);
    const bytes = await readFile(path.join(root, 'node_modules/@fontsource/inter/files/inter-latin-400-normal.woff2'));
    const wasmPath = path.join(root, base, 'text/wasm/generated');
    const wasm = await import(pathToFileURL(path.join(wasmPath, 'text_layout_wasm.js')));
    await wasm.default({ module_or_path: await readFile(path.join(wasmPath, 'text_layout_wasm_bg.wasm')) });
    const key = 'positioned-recovery-fixture';
    wasm.register_layout_font(key, font.assetId, bytes);
    const strings = new TextEncoder().encode(`Inter${font.assetId}`);
    const layout = wasm.realize_flow_text(key, key, 'A', 400, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 100, new Uint32Array([0, 1, 0, 0, 0]),
      new Float32Array([64, 400, 100, 0]), strings, new Uint32Array([0, 5, 5, strings.length]));
    const glyphs = layout.glyph_ids();
    assert.equal(glyphs.length, 1);
    const glyphId = glyphs[0]; assert.ok(glyphId > 0);
    layout.free(); wasm.drop_layout_session(key);
    const text = createPositionedTextFixture();
    text.source.editability = 'recoverable';
    text.source.runs[0].font.font = font;
    text.source.runs[0].glyphs = [{ glyphId, cluster: 0, unicode: 'A', x: 0, y: 0, advanceX: 0.7, advanceY: 0 }];
    text.source.runs[0].textMatrix = [64, 0, 60, 0, 64, 120, 0, 0, 1];
    assert.notEqual(analyzePositionedTextRecovery(text.source).status, 'blocked');
    const background = createImageDocument('Positioned recovery', 320, 200, 'background');
    const document = createTextLayer(background, text, 'Imported positioned A');
    document.assets.fonts = [font];
    const pixels = new Blob([await sharp({ create: { width: 320, height: 200, channels: 4,
      background: '#f0e0c0' } }).png().toBuffer()], { type: 'image/png' });
    const file = buildLayeredDocumentFile(pixels, document,
      createAdjustmentStackFromBasicAdjustments(createDefaultAdjustments()), [
        { layerId: background.layers[0].id, pixels, mask: null },
        { fingerprintSha256: font.fingerprintSha256, source: new Blob([bytes]) }
      ], 'positioned-recovery-lighttable.png', { previewKind: 'placeholder' });
    const parsed = await parseLayeredDocumentFile(file);
    assert.deepEqual(parsed.document.layers.find(layer => layer.id === document.activeLayerId).text, text);
    const filePath = path.join(directory, file.name);
    await writeFile(filePath, Buffer.from(await file.arrayBuffer()));
    return { filePath, layerId: document.activeLayerId, text };
}
