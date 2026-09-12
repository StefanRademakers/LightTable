import { expect, it, vi } from 'vitest';
import { WebGpuEngine } from './WebGpuEngine';
import { createImageDocument } from '../editor/document/documentTypes';
import { createDefaultLayerStyle } from '../editor/styles/layerStyleDefaults';

const fixture = () => {
  let resolve!: () => void, reject!: (error: Error) => void;
  const initialization = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
  const order: string[] = [];
  const engine = Object.assign(Object.create(WebGpuEngine.prototype), {
    metadata: { width: 10, height: 10 }, imageResources: { finalTexture: {} },
    imageDocument: createImageDocument('Export', 10, 10, 'fixture'),
    documentRenderer: { waitForTextSourcesForExport: vi.fn(async () => true) },
    initializeLayerStylesIfNeeded: vi.fn(() => { order.push('initialize'); }), layerStyleInitialization: initialization,
    coreResources: { waitForAdjustmentAssets: vi.fn(async () => false) },
    adjustmentState: { current: {} }, adjustmentLayerResources: { waitForAdjustmentAssets: vi.fn(async () => false) },
    settleInteractiveRenderQuality: vi.fn(() => { order.push('quality'); }),
    renderScheduler: { flush: vi.fn(() => { order.push('render'); }) },
    device: { queue: { onSubmittedWorkDone: vi.fn(async () => { order.push('submitted'); }) } },
    exportRgba8Prepared: vi.fn(async () => { order.push('readback'); return { pixels: new Uint8Array(), width: 10, height: 10 }; })
  });
  return { engine, order, resolve, reject };
};
it('waits for actual shared style readiness before final quality, rendering and readback', async () => {
  const h = fixture(), result = h.engine.exportRgba8(); await Promise.resolve(); await Promise.resolve();
  expect(h.order).toEqual(['initialize']); expect(h.engine.exportRgba8Prepared).not.toHaveBeenCalled();
  h.resolve(); await result;
  expect(h.order).toEqual(['initialize', 'quality', 'render', 'submitted', 'readback']);
});
it('propagates pipeline failure without rendering or exporting preview pixels', async () => {
  const h = fixture(), result = h.engine.exportRgba8();
  const rejected = expect(result).rejects.toThrow('style compilation failed');
  h.reject(new Error('style compilation failed')); await rejected;
  expect(h.engine.renderScheduler.flush).not.toHaveBeenCalled(); expect(h.engine.exportRgba8Prepared).not.toHaveBeenCalled();
});
it('does not read a successor document after deferred preparation', async () => {
  const h = fixture(), result = h.engine.exportRgba8(); await Promise.resolve(); await Promise.resolve();
  h.engine.imageDocument = createImageDocument('Successor', 10, 10, 'next'); h.resolve();
  await expect(result).rejects.toThrow('Document sources changed');
  expect(h.engine.exportRgba8Prepared).not.toHaveBeenCalled();
});
it('rejects replacement during text preparation before starting successor style work', async () => {
  const h = fixture();
  h.engine.documentRenderer.waitForTextSourcesForExport.mockImplementation(async () => {
    h.engine.imageDocument = createImageDocument('Successor', 10, 10, 'next'); return true;
  });
  await expect(h.engine.exportRgba8()).rejects.toThrow('Document sources changed');
  expect(h.engine.initializeLayerStylesIfNeeded).not.toHaveBeenCalled(); h.resolve();
});
it('rejects replacement while waiting for submitted rendering before selecting a readback texture', async () => {
  const h = fixture(); h.resolve();
  h.engine.device.queue.onSubmittedWorkDone.mockImplementation(async () => {
    h.engine.imageDocument = createImageDocument('Successor', 10, 10, 'next');
  });
  await expect(h.engine.exportRgba8()).rejects.toThrow('Document sources changed during export rendering');
  expect(h.engine.exportRgba8Prepared).not.toHaveBeenCalled();
});
it('rechecks after readiness resolves before flushing a successor frame', async () => {
  const h = fixture();
  h.engine.waitForLayerFinalizationSources = async () => {
    queueMicrotask(() => { h.engine.imageDocument = createImageDocument('Successor', 10, 10, 'next'); });
    return true;
  };
  await expect(h.engine.exportRgba8()).rejects.toThrow('Document sources changed');
  expect(h.engine.renderScheduler.flush).not.toHaveBeenCalled(); h.resolve();
});
it('carries the exact source guard through the preparation-to-readback microtask handoff', async () => {
  const h = fixture(); h.resolve();
  const prepare = h.engine.prepareDocumentExport.bind(h.engine);
  h.engine.prepareDocumentExport = () => prepare().then((assertCurrent: () => void) => {
    queueMicrotask(() => { h.engine.imageDocument = createImageDocument('Successor', 10, 10, 'next'); });
    return assertCurrent;
  });
  await expect(h.engine.exportRgba8()).rejects.toThrow('Document sources changed');
  expect(h.engine.exportRgba8Prepared).not.toHaveBeenCalled();
});
it.each([false, true])('style initialization invalidates its renderer despite callback refresh (renderer replaced=%s)', async replaced => {
  let resolve!: () => void;
  const initialization = new Promise<void>(done => { resolve = done; });
  const document = createImageDocument('Styled', 10, 10, 'fixture');
  document.layers[0]!.styleStack.effects.push(createDefaultLayerStyle('drop-shadow'));
  const renderer = { initializeLayerStylePipeline: vi.fn(() => initialization) };
  const engine = Object.assign(Object.create(WebGpuEngine.prototype), {
    documentRenderer: renderer, callbacks: {}, markDocumentDirty: vi.fn(), requestRender: vi.fn()
  });
  engine.initializeLayerStylesIfNeeded(document);
  engine.callbacks = {}; if (replaced) engine.documentRenderer = {};
  resolve(); await initialization; await Promise.resolve();
  expect(engine.markDocumentDirty).toHaveBeenCalledTimes(replaced ? 0 : 1);
});
