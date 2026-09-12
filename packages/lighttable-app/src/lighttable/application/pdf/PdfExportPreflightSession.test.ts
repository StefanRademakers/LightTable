import { describe, expect, it, vi } from 'vitest';
import { CONTRACT_FIXTURE_FONT_ASSET, TEXT_LAYOUT_SCHEMA_VERSION, createDefaultTextLayerData,
  type RealizedTextLayout } from '@lighttable/text-core';
import { createAnchor, createSubpath, createVectorPath } from '@lighttable/vector-core';
import { createImageDocument, createTextLayerNode, createVectorLayer, type DocumentFontAsset } from '../../editor/document/documentTypes';
import { DocumentSession, type DocumentSessionId } from '../documents/documentSession';
import { createPdfExportPreflightSession, type PdfExportPreflightSource } from './PdfExportPreflightSession';
import type { PdfExportServices } from './PdfExportServices';

const font: DocumentFontAsset = { ...CONTRACT_FIXTURE_FONT_ASSET, source: 'document', outline: 'truetype',
  embedding: { level: 'editable', noSubsetting: false, bitmapOnly: false }, familyNames: ['Contract Fixture'],
  styleName: 'Regular', weight: 400, stretch: 100, italic: false, byteLength: 4096 };
const layout: RealizedTextLayout = {
  schemaVersion: TEXT_LAYOUT_SCHEMA_VERSION, key: 'pdf-owned-source',
  glyphRuns: [{ font: { font, variableAxes: {}, syntheticBold: false, syntheticItalic: false }, fontSize: 20,
    fontResolution: { kind: 'flow-exact', sourceRunIndex: 0, requested: { families: ['Contract Fixture'] } },
    paint: { fill: { kind: 'solid', color: { colorSpace: 'srgb', r: 0, g: 0, b: 0, a: 1 } } },
    renderingMode: 'fill', direction: 'ltr', glyphIds: Uint32Array.of(77), clusters: Uint32Array.of(0),
    geometry: Float32Array.of(5, 30, 12, 0) }],
  lines: [{ start: 0, end: 2, baseline: 30, ascent: 16, descent: 4,
    bounds: { x: 5, y: 14, width: 12, height: 20 } }], caretStops: [], selectionGeometry: [],
  clusterMap: [{ textStart: 0, textEnd: 2, glyphStart: 0, glyphEnd: 1 }],
  inkBounds: { x: 5, y: 14, width: 12, height: 16 }, logicalBounds: { x: 5, y: 10, width: 12, height: 20 }, warnings: []
};
const deferred = <T>() => { let resolve!: (value: T) => void; let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const fixture = (kind: 'raster' | 'text' | 'vector' | 'mixed' = 'raster') => {
  const document = createImageDocument('Original', 100, 80, 'pixels');
  const data = createDefaultTextLayerData();
  if (data.source.kind !== 'flow') throw new Error('Expected flow text');
  const text = createTextLayerNode({ ...data, source: { ...data.source, text: 'fi',
    styleRuns: data.source.styleRuns.map(run => ({ ...run, start: 0, end: 2 })),
    paragraphRuns: data.source.paragraphRuns.map(run => ({ ...run, start: 0, end: 2 })) } }, 'Text');
  const vector = createVectorLayer([createVectorPath('shape', 'Shape', [createSubpath('outline', [
    createAnchor('a', { x: 0, y: 0 }), createAnchor('b', { x: 10, y: 0 }), createAnchor('c', { x: 10, y: 10 })
  ], true)])]);
  if (kind === 'text' || kind === 'mixed') document.layers.push(text);
  if (kind === 'vector' || kind === 'mixed') document.layers.push(vector);
  const session = new DocumentSession({ id: 'pdf' as DocumentSessionId,
    source: { id: 'source', name: 'Original.pdf', mediaType: 'application/pdf' } });
  session.setDocument(document); session.setReady();
  let current = true; let fonts = [font]; const delivered: File[] = [];
  const renderer = { exportPng: vi.fn(async () => new Blob(['original pixels'])),
    textEditingLayout: vi.fn(() => ({ layout }) as never) };
  const services: PdfExportServices = {
    materializeFonts: vi.fn(async () => ({ embedded: [], fallback: [], totalEmbeddedBytes: 0 })),
    writeRaster: vi.fn(async () => ({ blob: new Blob(['raster']) })),
    writeText: vi.fn(async () => ({ blob: new Blob(['native']) })),
    writeVector: vi.fn(async () => ({ blob: new Blob(['vector']) }))
  };
  const source: PdfExportPreflightSource = { session, renderer,
    fonts: { get availableAssets() { return fonts; }, bytes: vi.fn(async () => new Uint8Array([1])) },
    fileName: 'Original.pdf', isCurrent: () => current && session.getSnapshot().lifecycle === 'ready',
    prepareExport: vi.fn(async () => {}), deliver: vi.fn(async file => { delivered.push(file); }) };
  const request = createPdfExportPreflightSession(source, services);
  return { source, services, session, renderer, request, delivered, text, vector,
    retire: () => { current = false; }, replaceFonts: () => { fonts = [{ ...font }]; },
    edit: () => session.setDocument({ ...session.getSnapshot().document!, revision: document.revision + 1, name: 'Changed' }) };
};

describe('PDF export preflight session', () => {
  it.each([
    ['raster', 'exportFlattenedPage', 'Original.pdf'], ['text', 'exportNativeTextPage', 'Original-native.pdf'],
    ['vector', 'exportNativeVectorPage', 'Original-vectors.pdf'], ['mixed', 'exportNativeMixedPage', 'Original-native-mixed.pdf']
  ] as const)('preserves the %s export and existing file naming without mutating document/history', async (kind, action, name) => {
    const f = fixture(kind); const before = f.session.getSnapshot();
    expect(Object.isFrozen(f.request)).toBe(true); expect(f.request[action]).toBeTypeOf('function');
    await f.request[action]!();
    expect(f.delivered).toHaveLength(1); expect(f.delivered[0].name).toBe(name);
    expect(f.source.prepareExport).toHaveBeenCalledTimes(1); expect(f.session.getSnapshot()).toBe(before);
    if (kind === 'mixed') {
      expect(f.renderer.exportPng).toHaveBeenCalledWith({ excludedLayerIds: [f.text.id, f.vector.id] });
      expect(f.services.writeText).toHaveBeenCalledWith(expect.objectContaining({ nativeLayerOrder: [f.text.id, f.vector.id] }));
    }
  });
  it('retains the preflight text layout rather than consulting a later renderer layout', async () => {
    const f = fixture('text'); f.renderer.textEditingLayout.mockImplementation(() => { throw new Error('Late layout read'); });
    await f.request.exportNativeTextPage!();
    expect(f.services.writeText).toHaveBeenCalledWith(expect.objectContaining({
      page: expect.objectContaining({ runs: [expect.objectContaining({ glyphs: [expect.objectContaining({ glyphId: 77 })] })] })
    }));
  });
  it.each(['edit', 'fonts', 'processing', 'pixel-history'] as const)('rejects changed %s before raster export, including flattened mode', async kind => {
    const f = fixture();
    if (kind === 'edit') f.edit();
    if (kind === 'fonts') f.replaceFonts();
    if (kind === 'processing') f.session.publishProcessing({ globalGradeStrength: 60 });
    if (kind === 'pixel-history') f.session.history.record({ id: 'pixels', type: 'paint', label: 'Paint',
      documentId: f.session.id, undo() {}, redo() {} });
    await expect(f.request.exportFlattenedPage!()).rejects.toThrow('changed after PDF preflight');
    expect(f.renderer.exportPng).not.toHaveBeenCalled(); expect(f.delivered).toHaveLength(0);
  });
  it('settles newly pending edits through the file owner, then rejects the now-stale plan', async () => {
    const f = fixture(); f.source.prepareExport = async () => f.edit();
    await expect(f.request.exportFlattenedPage!()).rejects.toThrow('changed after PDF preflight');
    expect(f.renderer.exportPng).not.toHaveBeenCalled();
  });
  it.each(['font', 'raster', 'writer'] as const)('rejects retirement while waiting for %s without delivering', async stage => {
    const f = fixture(stage === 'font' ? 'text' : 'raster'); const pending = deferred<never>();
    if (stage === 'font') f.services.materializeFonts = () => pending.promise;
    if (stage === 'raster') f.renderer.exportPng.mockImplementation(() => pending.promise);
    if (stage === 'writer') f.services.writeRaster = () => pending.promise;
    const run = expect((stage === 'font' ? f.request.exportNativeTextPage! : f.request.exportFlattenedPage!)())
      .rejects.toMatchObject({ name: 'AbortError' });
    for (let i = 0; i < 12; i++) await Promise.resolve();
    f.retire(); pending.reject(new Error('Old worker failed')); await run;
    expect(f.delivered).toHaveLength(0);
  });
  it('rejects changes during successful raster readback before writing or delivering', async () => {
    const f = fixture(); f.renderer.exportPng.mockImplementation(async () => { f.edit(); return new Blob(['wrong pixels']); });
    await expect(f.request.exportFlattenedPage!()).rejects.toThrow('changed after PDF preflight');
    expect(f.services.writeRaster).not.toHaveBeenCalled(); expect(f.delivered).toHaveLength(0);
  });
  it('preserves a genuine current codec error rather than treating it as canceled', async () => {
    const f = fixture(); f.services.writeRaster = async () => { throw new Error('PDF encoding failed'); };
    await expect(f.request.exportFlattenedPage!()).rejects.toThrow('PDF encoding failed');
    expect(f.delivered).toHaveLength(0);
  });
  it('allows own lazy font byte materialization with unchanged metadata source', async () => {
    const f = fixture('text'); f.services.materializeFonts = async (_plan, source) => {
      await source.loadFontBytes(font.assetId);
      return { embedded: [], fallback: [], totalEmbeddedBytes: 4 };
    };
    await expect(f.request.validateFonts!()).resolves.toEqual({ embeddedFontCount: 0, totalEmbeddedBytes: 4 });
    expect(f.source.prepareExport).not.toHaveBeenCalled();
  });
});
