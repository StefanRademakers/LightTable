import { describe, expect, it, vi } from 'vitest';
import { createImageDocument } from '../../editor/document/documentTypes';
import { createDocumentMutationController } from '../documents/useDocumentMutationController';
import { MountedLayerCommandAdapter, type MountedLayerCommandPorts } from './MountedLayerCommandAdapter';

const setup = () => {
  let current = true;
  const ports: MountedLayerCommandPorts = {
    assertCurrent: () => { if (!current) throw new Error('Retired layer command'); },
    settlePixels: vi.fn(async () => undefined), waitForPresentation: vi.fn(async () => undefined),
    loadMaskAsSelection: vi.fn(async () => true), mutations: { change: vi.fn(() => true) },
    pixels: {
      duplicateLayer: vi.fn(() => 'duplicate' as never),
      layerViaCopy: vi.fn(() => ({ layerId: 'copy' as never, scope: 'selection' as const })),
      addLayerMask: vi.fn(() => true), invertLayerColors: vi.fn(() => true),
      applyLayerMask: vi.fn(() => true), removeLayerMask: vi.fn(() => true)
    },
    panel: {
      deleteSelection: vi.fn(), move: vi.fn(), setOpacity: vi.fn(), setVectorAntiAlias: vi.fn(),
      setBlendMode: vi.fn(), setClipping: vi.fn(), reorder: vi.fn(), ungroupSelection: vi.fn(),
      setLock: vi.fn(), createGradientFillLayer: vi.fn(() => 'gradient' as never),
      createGroup: vi.fn(() => 'group' as never), groupSelection: vi.fn(() => 'selection-group' as never)
    }
  };
  const capture = vi.fn(() => ports);
  return { ports, capture, adapter: new MountedLayerCommandAdapter(capture), retire: () => { current = false; } };
};
const layerId = 'source' as never;

describe('mounted layer command adapter', () => {
  it('returns admitted creation IDs without querying later presentation', async () => {
    const { adapter, ports } = setup();
    await expect(adapter.execute({ kind: 'create-gradient-fill' })).resolves.toEqual({ layerId: 'gradient' });
    await expect(adapter.execute({ kind: 'create-group' })).resolves.toEqual({ layerId: 'group' });
    await expect(adapter.execute({ kind: 'group', layerIds: [layerId] }))
      .resolves.toEqual({ layerIds: [layerId], groupId: 'selection-group' });
    vi.mocked(ports.panel.createGroup).mockReturnValue(null);
    await expect(adapter.execute({ kind: 'create-group' })).resolves.toBeNull();
    expect(ports.mutations.change).not.toHaveBeenCalled();
  });

  it('delegates duplicate directly and settles copy exactly once without another history writer', async () => {
    const { adapter, ports, capture } = setup();
    await expect(adapter.execute({ kind: 'duplicate', layerId }))
      .resolves.toEqual({ sourceLayerId: layerId, layerId: 'duplicate' });
    expect(ports.settlePixels).not.toHaveBeenCalled();
    await expect(adapter.execute({ kind: 'copy-to-new-layer', layerId }))
      .resolves.toEqual({ sourceLayerId: layerId, layerId: 'copy', scope: 'selection' });
    expect(ports.settlePixels).toHaveBeenCalledTimes(1);
    expect(ports.pixels.layerViaCopy).toHaveBeenCalledWith(layerId);
    expect(capture).toHaveBeenCalledTimes(2);
    expect(ports.mutations.change).not.toHaveBeenCalled();
  });

  it('rejects retirement during copy settlement before touching pixels', async () => {
    const { adapter, ports, retire } = setup();
    vi.mocked(ports.settlePixels).mockImplementation(async () => retire());
    await expect(adapter.execute({ kind: 'copy-to-new-layer', layerId })).rejects.toThrow('Retired');
    expect(ports.pixels.layerViaCopy).not.toHaveBeenCalled();
  });

  it('rejects an already retired opening binding before model mutation', async () => {
    const { adapter, ports, retire } = setup(); retire();
    await expect(adapter.execute({ kind: 'create-group' })).rejects.toThrow('Retired');
    expect(ports.panel.createGroup).not.toHaveBeenCalled();
  });

  it('retains mask settlement and presentation ordering', async () => {
    const { adapter, ports } = setup(); const order: string[] = [];
    vi.mocked(ports.settlePixels).mockImplementation(async () => { order.push('settle'); });
    vi.mocked(ports.waitForPresentation).mockImplementation(async () => { order.push('present'); });
    vi.mocked(ports.loadMaskAsSelection).mockImplementation(async () => { order.push('mask'); return true; });
    await expect(adapter.execute({ kind: 'set-mask', layerId, operation: 'load-selection' }))
      .resolves.toEqual({ layerId, operation: 'load-selection' });
    expect(order).toEqual(['settle', 'present', 'mask']);
  });

  it('rejects retirement while waiting for mask presentation', async () => {
    const { adapter, ports, retire } = setup();
    vi.mocked(ports.waitForPresentation).mockImplementation(async () => retire());
    await expect(adapter.execute({ kind: 'set-mask', layerId, operation: 'load-selection' })).rejects.toThrow('Retired');
    expect(ports.loadMaskAsSelection).not.toHaveBeenCalled();
  });

  it('propagates owner failure without fallback or success result', async () => {
    const { adapter, ports } = setup(); const error = new Error('GPU operation failed');
    vi.mocked(ports.pixels.layerViaCopy).mockImplementation(() => { throw error; });
    await expect(adapter.execute({ kind: 'copy-to-new-layer', layerId })).rejects.toBe(error);
  });

  it('publishes transform through the existing mutation/history owner exactly once and preserves no-op', async () => {
    const { ports } = setup(); let document = createImageDocument('Image', 20, 10, 'image');
    const pushHistoryEntry = vi.fn();
    const mutations = createDocumentMutationController(() => ({
      getDocument: () => document, applySnapshot: next => { document = next; },
      previewSnapshot: () => undefined, discardPreview: () => undefined, pushHistoryEntry
    }));
    const adapter = new MountedLayerCommandAdapter(() => ({ ...ports, mutations }));
    const command = { kind: 'set-transform' as const, layerId: document.activeLayerId!,
      transform: { a: 1, b: 0, c: 0, d: 1, tx: 5, ty: 10 } };
    await expect(adapter.execute(command)).resolves.toEqual({ layerId: command.layerId, transform: command.transform });
    expect(pushHistoryEntry).toHaveBeenCalledTimes(1);
    await expect(adapter.execute(command)).resolves.toBeNull();
    expect(pushHistoryEntry).toHaveBeenCalledTimes(1);
  });
});
