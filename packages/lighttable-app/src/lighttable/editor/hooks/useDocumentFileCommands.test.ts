import { beforeEach, expect, it, vi } from 'vitest';
import { useDocumentFileCommands, type DocumentFileCommandsOptions } from './useDocumentFileCommands';
import { createImageDocument } from '../document/documentTypes';
import { DocumentSession, type DocumentSessionId } from '../../application/documents/documentSession';
import { createDefaultAdjustments } from '../../types';
import { createAdjustmentStackFromBasicAdjustments } from '../../processing/adjustmentStack';
const encoder = vi.hoisted(() => ({ encode: vi.fn(async () => new Blob(['encoded'])), destroy: vi.fn() }));
vi.mock('react', () => ({ useRef: (current: unknown) => ({ current }), useCallback: (callback: unknown) => callback,
  useState: (initial: unknown) => [initial, vi.fn()], useEffect: vi.fn() }));
vi.mock('./useDocumentFileDelivery', () => ({ useDocumentFileDelivery: () => () => ({ deliver: vi.fn() }) }));
vi.mock('../../image-io/WasmVipsEncoder', () => ({ WasmVipsEncoder: class { encode = encoder.encode; destroy = encoder.destroy; } }));
beforeEach(() => { encoder.encode.mockReset().mockResolvedValue(new Blob(['encoded'])); encoder.destroy.mockClear(); });
const fixture = (bitDepth: 8 | 16 = 8) => {
  let document = createImageDocument('Canonical style edit', 10, 8, 'asset'), generation = 4;
  document = { ...document, revision: 42, colorSettings: { ...document.colorSettings, bitDepth } };
  const session = new DocumentSession({ id: 'A' as DocumentSessionId, source: { id: 'A', name: 'A', mediaType: 'image/png' } });
  const order: string[] = [];
  const renderer = {
    synchronizeDocumentForExport: vi.fn((_document: typeof document) => { order.push('synchronize'); }),
    exportPng: vi.fn(async () => new Blob()), exportLayerAssets: vi.fn(async () => []),
    getAdjustmentStack: () => createAdjustmentStackFromBasicAdjustments(createDefaultAdjustments()),
    exportRgba8: vi.fn(async () => { order.push('read8'); return { pixels: new Uint8Array(320), width: 10, height: 8, storage: 'u8' as const }; }),
    exportRgba16: vi.fn(async () => { order.push('read16'); return { pixels: new Uint16Array(320), width: 10, height: 8, storage: 'f16-display' as const }; })
  };
  let currentRenderer: typeof renderer | null = renderer;
  const options: DocumentFileCommandsOptions = { fileInputRef: { current: null }, advancedFileInputRef: { current: null },
    taskRegistry: session.tasks, commandHistory: session.history, effectiveSourceFileKey: 'asset', fileNameBase: 'source.png', sourceFile: null,
    hasMetadata: true, getDocument: () => document, getRenderer: () => currentRenderer, getRendererGeneration: () => generation,
    getFlatAdjustments: createDefaultAdjustments, getDocumentAdjustments: createDefaultAdjustments, getEffectiveLayeredAdjustments: createDefaultAdjustments,
    getPreservedSourceAssets: () => [], getFontAssets: () => [], hydrateLocalFile: vi.fn(), cancelAutoAlign: vi.fn(),
    onSave: vi.fn(() => ({ status: 'canceled' as const })), setLoading: vi.fn(), setError: vi.fn() };
  return { commands: useDocumentFileCommands(options), renderer, order, document: () => document,
    retire: (kind: 'document' | 'generation' | 'renderer') => {
      if (kind === 'document') document = { ...document, revision: document.revision + 1 };
      else if (kind === 'generation') generation += 1; else currentRenderer = null;
    } };
};
it.each([8, 16] as const)('synchronizes the captured canonical document before %s-bit readback with no additional read', async depth => {
  const f = fixture(depth), document = f.document();
  const file = await f.commands.exportBitmapArtifact(depth === 16 ? 'tiff' : 'png');
  expect(f.order).toEqual(['synchronize', depth === 16 ? 'read16' : 'read8']);
  expect(f.renderer.synchronizeDocumentForExport).toHaveBeenCalledExactlyOnceWith(document);
  expect(encoder.encode).toHaveBeenCalledOnce(); expect(file.name).toBe(depth === 16 ? 'source-lighttable.tif' : 'source-lighttable.png');
});
it('does not read back if synchronization itself retires the captured binding', async () => {
  const f = fixture(); f.renderer.synchronizeDocumentForExport.mockImplementation(() => f.retire('generation'));
  await expect(f.commands.exportBitmapArtifact('png')).rejects.toThrow('renderer changed');
  expect(f.renderer.exportRgba8).not.toHaveBeenCalled(); expect(encoder.encode).not.toHaveBeenCalled();
});
it.each(['document', 'generation', 'renderer'] as const)('rejects %s retirement after readback before encoding', async kind => {
  const f = fixture(); const original = f.renderer.exportRgba8.getMockImplementation()!;
  f.renderer.exportRgba8.mockImplementation(async () => { const pixels = await original(); f.retire(kind); return pixels; });
  await expect(f.commands.exportBitmapArtifact('png')).rejects.toThrow('renderer changed');
  expect(encoder.encode).not.toHaveBeenCalled();
});
it('does not return a stale artifact after asynchronous encoding', async () => {
  const f = fixture(); encoder.encode.mockImplementation(async () => { f.retire('document'); return new Blob(['stale']); });
  await expect(f.commands.exportBitmapArtifact('png')).rejects.toThrow('renderer changed');
});
