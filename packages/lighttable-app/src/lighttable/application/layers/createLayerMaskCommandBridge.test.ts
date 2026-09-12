import { describe, expect, it, vi } from 'vitest';
import { addLayerMask, createRasterLayer, removeLayerMask } from '../../editor/document/documentCommands';
import { createImageDocument, type ImageDocument } from '../../editor/document/documentTypes';
import type { LightTableCommandResult } from '../commands/lightTableCommandContract';
import { createLayerMaskCommandBridge } from './createLayerMaskCommandBridge';

const completed = { status: 'completed' } as unknown as LightTableCommandResult;

const setup = (initial: ImageDocument) => {
  let document: ImageDocument | null = initial;
  let resolveExecution!: (value: LightTableCommandResult) => void;
  let rejectExecution!: (reason: unknown) => void;
  const execute = vi.fn(() => new Promise<LightTableCommandResult>((resolve, reject) => {
    resolveExecution = resolve;
    rejectExecution = reject;
  }));
  const dependencies = {
    isCurrent: vi.fn(() => true),
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
    complete: (result = completed) => resolveExecution(result),
    reject: (reason: unknown) => rejectExecution(reason)
  };
};

describe('createLayerMaskCommandBridge', () => {
  it('does not publish unavailable after dispatch synchronously retires the intent', () => {
    const state = setup(createImageDocument('Mask', 16, 12, 'asset'));
    const bridge = createLayerMaskCommandBridge(() => ({ ...state.dependencies, execute: () => {
      state.dependencies.isCurrent.mockReturnValue(false); return null;
    } }));
    bridge.add();
    expect(state.dependencies.setError).not.toHaveBeenCalled();
  });
  it('uses authoritative activity even without selection operation provenance', () => {
    const state = setup(createImageDocument('Mask', 16, 12, 'asset'));
    state.dependencies.hasSelection.mockReturnValue(true);
    state.bridge.add();
    expect(state.dependencies.execute).toHaveBeenCalledWith({
      layerId: state.document()!.activeLayerId, operation: 'add', source: 'selection'
    });
  });

  it('reports unavailable authoritative selection without falling back to reveal-all', () => {
    const state = setup(createImageDocument('Mask', 16, 12, 'asset'));
    state.dependencies.hasSelection.mockImplementation(() => { throw new Error('Coverage unavailable'); });
    state.bridge.add();
    expect(state.dependencies.execute).not.toHaveBeenCalled();
    expect(state.dependencies.setError).toHaveBeenCalledExactlyOnceWith('Coverage unavailable');
  });

  it.each(['same-ID session replacement', 'renderer replacement'])(
    'does not publish a late mask result after %s', async () => {
      const state = setup(createImageDocument('Mask', 16, 12, 'asset'));
      const layerId = state.document()!.activeLayerId!;
      state.bridge.add();
      state.setDocument(addLayerMask(state.document()!, layerId));
      state.dependencies.isCurrent.mockReturnValue(false);
      state.complete();
      await Promise.resolve();
      expect(state.dependencies.setPaintTarget).not.toHaveBeenCalled();
    });

  it('rechecks scope after planning and before dispatch', () => {
    const state = setup(createImageDocument('Mask', 16, 12, 'asset'));
    state.dependencies.hasSelection.mockImplementation(() => {
      state.dependencies.isCurrent.mockReturnValue(false); return true;
    });
    state.bridge.add();
    expect(state.dependencies.execute).not.toHaveBeenCalled();
  });

  it.each([false, true])('routes asynchronous failure only to a current intent (retired=%s)', async retired => {
    const state = setup(createImageDocument('Mask', 16, 12, 'asset'));
    state.bridge.add();
    state.dependencies.isCurrent.mockReturnValue(!retired);
    state.reject(new Error('GPU mask failure'));
    await Promise.resolve(); await Promise.resolve();
    expect(state.dependencies.setError.mock.calls).toEqual(retired ? [] : [['GPU mask failure']]);
  });

  it('reports rejected semantic results exactly once', async () => {
    const state = setup(createImageDocument('Mask', 16, 12, 'asset'));
    state.bridge.add();
    state.complete({ status: 'rejected', message: 'Mask unavailable' } as LightTableCommandResult);
    await Promise.resolve();
    expect(state.dependencies.setError).toHaveBeenCalledExactlyOnceWith('Mask unavailable');
  });

  it('retains admitted callbacks instead of resolving a successor presentation owner', async () => {
    const state = setup(createImageDocument('Mask', 16, 12, 'asset'));
    const successor = { ...state.dependencies, setPaintTarget: vi.fn() };
    let dependencies = state.dependencies;
    const bridge = createLayerMaskCommandBridge(() => dependencies);
    bridge.add();
    dependencies = successor;
    state.setDocument(addLayerMask(state.document()!, state.document()!.activeLayerId!));
    state.complete(); await Promise.resolve();
    expect(state.dependencies.setPaintTarget).toHaveBeenCalledExactlyOnceWith('mask', '#000000');
    expect(successor.setPaintTarget).not.toHaveBeenCalled();
  });
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
