import { describe, expect, it, vi } from 'vitest';
import { createImageDocument, type LayerId } from '../../../editor/document/documentTypes';
import { TransformCanvasPickIntent } from './TransformCanvasPickIntent';

const deferred = <T>() => {
  let resolve!: (value: T) => void; let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const tick = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const fixture = () => {
  const original = createImageDocument('Pick', 100, 100, 'asset');
  const top = createImageDocument('Top', 100, 100, 'top').layers[0];
  let document = { ...original, layers: [...original.layers, top] };
  let selected = [original.activeLayerId!]; let current = true; let tool = 'transform';
  let picker = { pickTopLayerAtPoint: vi.fn(async () => top.id as LayerId | null) };
  const ports = {
    read: () => ({ document, selectedLayerIds: selected, tool, autoSelect: true, historyBusy: false }),
    getPicker: () => picker, captureScope: () => ({ isCurrent: () => current }),
    commitTransform: vi.fn(async (): Promise<void> => undefined),
    publishSelection: vi.fn((ids: readonly LayerId[]) => { selected = [...ids]; }),
    selectLayer: vi.fn(async (id: LayerId, isCurrent: () => boolean, onSelected: () => void) => {
      if (!isCurrent()) return false;
      document = { ...document, activeLayerId: id }; onSelected(); return true;
    }),
    activateTransform: vi.fn(), reportError: vi.fn()
  };
  const owner = new TransformCanvasPickIntent(() => ports);
  return { owner, ports, top, original, get picker() { return picker; },
    retire: () => { current = false; }, changeTool: () => { tool = 'brush'; },
    replaceRenderer: () => { picker = { pickTopLayerAtPoint: vi.fn(async () => top.id) }; },
    deleteTarget: () => { document = { ...document, layers: original.layers }; } };
};

describe('TransformCanvasPickIntent', () => {
  it('reuses the picker and shift-selection policy, then activates only the accepted selection', async () => {
    const f = fixture();
    await expect(f.owner.request({ x: 10, y: 20 }, true)).resolves.toBe(true);
    expect(f.ports.publishSelection).toHaveBeenCalledExactlyOnceWith([f.original.activeLayerId, f.top.id]);
    expect(f.ports.commitTransform).toHaveBeenCalledOnce();
    expect(f.ports.selectLayer).toHaveBeenCalledWith(f.top.id, expect.any(Function), expect.any(Function));
    expect(f.ports.activateTransform).toHaveBeenCalledOnce();
  });
  it('drops a delayed hit superseded by another canvas request', async () => {
    const f = fixture(); const first = deferred<LayerId | null>(); const second = deferred<LayerId | null>();
    f.picker.pickTopLayerAtPoint.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
    const a = f.owner.request({ x: 10, y: 20 }); const b = f.owner.request({ x: 12, y: 20 });
    second.resolve(f.top.id); expect(await b).toBe(true);
    first.resolve(f.original.activeLayerId); expect(await a).toBe(false);
    expect(f.ports.selectLayer).toHaveBeenCalledOnce(); expect(f.ports.activateTransform).toHaveBeenCalledOnce();
  });
  it.each(['cancel', 'scope', 'renderer', 'tool'] as const)('rejects %s retirement while committing the preceding preview', async reason => {
    const f = fixture(); const commit = deferred<void>(); f.ports.commitTransform.mockImplementationOnce(() => commit.promise);
    const request = f.owner.request({ x: 10, y: 20 }); await tick();
    expect(f.ports.commitTransform).toHaveBeenCalledOnce();
    if (reason === 'cancel') f.owner.cancel();
    else if (reason === 'scope') f.retire();
    else if (reason === 'renderer') f.replaceRenderer();
    else f.changeTool();
    commit.resolve(); expect(await request).toBe(false);
    expect(f.ports.publishSelection).not.toHaveBeenCalled();
    expect(f.ports.selectLayer).not.toHaveBeenCalled(); expect(f.ports.activateTransform).not.toHaveBeenCalled();
  });
  it('passes the same lease into delayed layer selection and cannot activate after supersession', async () => {
    const f = fixture(); const selecting = deferred<void>(); let admitted = false;
    f.ports.selectLayer.mockImplementationOnce(async (_id, isCurrent) => {
      await selecting.promise; admitted = isCurrent(); return admitted;
    });
    const request = f.owner.request({ x: 10, y: 20 }); await tick();
    expect(f.ports.selectLayer).toHaveBeenCalledOnce();
    f.owner.cancel(); selecting.resolve();
    expect(await request).toBe(false); expect(admitted).toBe(false);
    expect(f.ports.activateTransform).not.toHaveBeenCalled();
  });
  it('does not select a layer removed by transform settlement', async () => {
    const f = fixture(); f.ports.commitTransform.mockImplementationOnce(async () => { f.deleteTarget(); });
    expect(await f.owner.request({ x: 10, y: 20 })).toBe(false);
    expect(f.ports.publishSelection).not.toHaveBeenCalled(); expect(f.ports.activateTransform).not.toHaveBeenCalled();
  });
  it.each(['rejected', 'failed'] as const)('does not publish row chrome for %s layer selection', async reason => {
    const f = fixture();
    f.ports.selectLayer.mockImplementationOnce(async () => {
      if (reason === 'failed') throw new Error('Selection preparation failed');
      return false;
    });
    expect(await f.owner.request({ x: 10, y: 20 })).toBe(false);
    expect(f.ports.publishSelection).not.toHaveBeenCalled(); expect(f.ports.activateTransform).not.toHaveBeenCalled();
    if (reason === 'failed') expect(f.ports.reportError).toHaveBeenCalledWith('Selection preparation failed');
  });
  it('keeps real current errors visible without publishing a retired request error into the successor', async () => {
    const f = fixture(); f.picker.pickTopLayerAtPoint.mockRejectedValueOnce(new Error('GPU alpha read failed'));
    expect(await f.owner.request({ x: 10, y: 20 })).toBe(false);
    expect(f.ports.reportError).toHaveBeenCalledExactlyOnceWith('GPU alpha read failed');
    const late = deferred<LayerId | null>(); f.picker.pickTopLayerAtPoint.mockImplementationOnce(() => late.promise);
    const pending = f.owner.request({ x: 10, y: 20 }); f.retire(); late.reject(new Error('Retired GPU error'));
    expect(await pending).toBe(false); expect(f.ports.reportError).toHaveBeenCalledOnce();
  });
  it('does not query disabled auto-select or busy history', async () => {
    const f = fixture(); const read = f.ports.read;
    f.ports.read = () => ({ ...read(), autoSelect: false });
    expect(await f.owner.request({ x: 10, y: 20 })).toBe(false);
    f.ports.read = () => ({ ...read(), historyBusy: true });
    expect(await f.owner.request({ x: 10, y: 20 })).toBe(false);
    expect(f.picker.pickTopLayerAtPoint).not.toHaveBeenCalled();
  });
});
