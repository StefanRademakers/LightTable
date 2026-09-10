import { describe, expect, it, vi } from 'vitest';
import { addLayerMask, createRasterLayer, removeLayerMask } from '../../editor/document/documentCommands';
import { createImageDocument, type ImageDocument } from '../../editor/document/documentTypes';
import type { LightTableCommandResult } from '../commands/lightTableCommandContract';
import { createLayerMaskCommandBridge } from './createLayerMaskCommandBridge';

const completed = { status: 'completed' } as unknown as LightTableCommandResult;

const setup = (initial: ImageDocument) => {
  let document: ImageDocument | null = initial;
  let resolveExecution!: (value: LightTableCommandResult) => void;
  const execute = vi.fn(() => new Promise<LightTableCommandResult>((resolve) => {
    resolveExecution = resolve;
  }));
  const dependencies = {
    getDocument: () => document,
    hasSelection: vi.fn(() => false),
    execute,
    setPaintTarget: vi.fn(),
    setError: vi.fn()
  };
  const bridge = createLayerMaskCommandBridge(() => dependencies);
  return {
    bridge,
    dependencies,
    document: () => document,
    setDocument: (next: ImageDocument | null) => { document = next; },
    complete: () => resolveExecution(completed)
  };
};

describe('createLayerMaskCommandBridge', () => {
  it('selects the new mask only after the semantic command publishes it', async () => {
    const state = setup(createImageDocument('Mask', 16, 12, 'asset'));
    const layerId = state.document()!.activeLayerId!;
    state.bridge.add();
    expect(state.dependencies.setPaintTarget).not.toHaveBeenCalled();
    state.setDocument(addLayerMask(state.document()!, layerId));
    state.complete();
    await Promise.resolve();
    expect(state.dependencies.execute).toHaveBeenCalledWith({
      layerId, operation: 'add', source: 'reveal-all'
    });
    expect(state.dependencies.setPaintTarget).toHaveBeenCalledWith('mask', '#000000');
  });

  it('does not leak a late presentation result into another document', async () => {
    const state = setup(createImageDocument('First', 16, 12, 'first'));
    state.bridge.add();
    state.setDocument(createImageDocument('Second', 16, 12, 'second'));
    state.complete();
    await Promise.resolve();
    expect(state.dependencies.setPaintTarget).not.toHaveBeenCalled();
  });

  it('does not select a completed mask after the user switched active layers', async () => {
    const state = setup(createImageDocument('Mask', 16, 12, 'asset'));
    const layerId = state.document()!.activeLayerId!;
    state.bridge.add();
    state.setDocument(createRasterLayer(addLayerMask(state.document()!, layerId), 'Other'));
    state.complete();
    await Promise.resolve();
    expect(state.dependencies.setPaintTarget).not.toHaveBeenCalled();
  });

  it('keeps the active paint target when deleting a mask from another layer', async () => {
    const bottom = createImageDocument('Mask', 16, 12, 'asset');
    const bottomId = bottom.activeLayerId!;
    const masked = addLayerMask(bottom, bottomId);
    const state = setup(createRasterLayer(masked, 'Top'));
    state.bridge.remove(bottomId);
    state.setDocument(removeLayerMask(state.document()!, bottomId));
    state.complete();
    await Promise.resolve();
    expect(state.dependencies.setPaintTarget).not.toHaveBeenCalled();
  });

  it('returns the active layer to pixels after its mask is removed', async () => {
    const base = createImageDocument('Mask', 16, 12, 'asset');
    const layerId = base.activeLayerId!;
    const state = setup(addLayerMask(base, layerId));
    state.bridge.remove();
    state.setDocument(removeLayerMask(state.document()!, layerId));
    state.complete();
    await Promise.resolve();
    expect(state.dependencies.setPaintTarget).toHaveBeenCalledWith('pixels');
  });
});
