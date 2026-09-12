import { afterEach, describe, expect, it, vi } from 'vitest';
import { DocumentSession, type DocumentSessionId } from '../../documents/documentSession';
import { createImageDocument } from '../../../editor/document/documentTypes';
import type { SemanticSelectionCommand } from '../../commands/semanticSelectionCommandContract';
import { createMountedSelectionCommandBinding } from './createMountedSelectionCommandBinding';

const sessions: DocumentSession[] = [];
afterEach(() => { sessions.splice(0).forEach(session => session.dispose()); });
const fixture = () => {
  const session = new DocumentSession({ id: 'same-id' as DocumentSessionId,
    source: { id: 'source', name: 'Selection', mediaType: 'image/png' } });
  session.setDocument(createImageDocument('Selection', 10, 8, 'asset')); session.setReady();
  sessions.push(session);
  const renderer = {};
  let currentSession = session, currentRenderer = renderer, projected = session.getSnapshot().document;
  let generation = 1, registered = true;
  const selection = { selectLayerTransparency: vi.fn(async () => true), selectSimilar: vi.fn(async () => true),
    feather: vi.fn(async () => true), border: vi.fn(async () => true), smooth: vi.fn(async () => true),
    morphology: vi.fn(async () => true), applyState: vi.fn(async () => true),
    applyMagicWand: vi.fn(async () => true), applyShape: vi.fn(async () => true) };
  const ports: Parameters<typeof createMountedSelectionCommandBinding>[0] = {
    session, renderer, registration: { isCurrent: () => registered },
    getSession: () => currentSession, getRenderer: () => currentRenderer, getProjectedDocument: () => projected,
    captureScope: () => { const captured = generation; return { assertCurrent: () => {
      if (generation !== captured) throw new Error('Retired generation');
    } }; },
    settle: vi.fn(async () => undefined), selection
  };
  return { session, selection, ports, execute: createMountedSelectionCommandBinding(ports),
    retire: (kind: string) => {
      if (kind === 'session') {
        currentSession = new DocumentSession({ id: session.id, source: session.getSnapshot().source });
        sessions.push(currentSession);
      }
      else if (kind === 'renderer') currentRenderer = {};
      else if (kind === 'registration') registered = false;
      else if (kind === 'generation') generation++;
      else if (kind === 'document') projected = { ...session.getSnapshot().document!, id: 'other' as never };
      else session.dispose();
    } };
};
const shape = { kind: 'rectangle' as const, points: [{ x: 1, y: 2 }, { x: 5, y: 6 }] };
const layerId = 'layer' as never;
const options = { tolerance: 20, antiAlias: false, sampleAllLayers: true, sampleSize: 3 as const, contiguous: false };
const cases: { command: SemanticSelectionCommand; method: keyof ReturnType<typeof fixture>['selection']; args: unknown[]; result: unknown }[] = [
  ...(['all', 'clear', 'invert'] as const).map(operation => ({ command: { kind: 'modify' as const, operation },
    method: 'applyState' as const, args: [operation], result: { operation } })),
  ...(['feather', 'smooth', 'expand', 'contract'] as const).map(operation => ({
    command: { kind: 'modify' as const, operation, radius: 4, applyAtCanvasBounds: true },
    method: operation === 'expand' || operation === 'contract' ? 'morphology' as const : operation,
    args: operation === 'expand' || operation === 'contract' ? [operation, 4, true] : [4, true],
    result: { operation, radius: 4, applyAtCanvasBounds: true } })),
  { command: { kind: 'modify', operation: 'border', width: 5 }, method: 'border', args: [5], result: { operation: 'border', width: 5 } },
  { command: { kind: 'modify', operation: 'load-transparency', layerId }, method: 'selectLayerTransparency', args: [layerId],
    result: { operation: 'load-transparency', layerId } },
  { command: { kind: 'modify', operation: 'similar', layerId, tolerance: 9, antiAlias: false, sampleAllLayers: true },
    method: 'selectSimilar', args: [layerId, { tolerance: 9, antiAlias: false, sampleAllLayers: true }],
    result: { operation: 'similar', layerId, tolerance: 9, antiAlias: false, sampleAllLayers: true } },
  { command: { kind: 'magic-wand', layerId, point: { x: 2, y: 3 }, mode: 'subtract', options }, method: 'applyMagicWand',
    args: [layerId, { x: 2, y: 3 }, 'subtract', options], result: { layerId, point: { x: 2, y: 3 }, mode: 'subtract', options } },
  { command: { kind: 'apply-shape', shape, mode: 'intersect', featherRadius: 2, antiAlias: false }, method: 'applyShape',
    args: [shape, 'intersect', 2, false], result: { shape, mode: 'intersect', featherRadius: 2, antiAlias: false } }
];

describe('mounted selection protocol binding', () => {
  it.each(cases)('preserves $command mapping and truthful rejection', async ({ command, method, args, result }) => {
    const state = fixture();
    expect(await state.execute(command)).toEqual(result);
    expect(state.selection[method]).toHaveBeenCalledExactlyOnceWith(...args);
    expect(state.ports.settle).toHaveBeenCalledOnce();
    state.selection[method].mockResolvedValueOnce(false);
    expect(await state.execute(command)).toBeNull();
  });
  it.each(['session', 'renderer', 'registration', 'document', 'disposed'])('rejects retired %s registration before settlement', async kind => {
    const state = fixture(); state.retire(kind);
    await expect(state.execute({ kind: 'modify', operation: 'all' })).rejects.toThrow('retired');
    expect(state.ports.settle).not.toHaveBeenCalled(); expect(state.selection.applyState).not.toHaveBeenCalled();
  });
  it.each(['session', 'renderer', 'registration', 'generation', 'document', 'disposed'])('rechecks %s lifetime after pending settlement', async kind => {
    const state = fixture(); let release!: () => void;
    state.ports.settle = () => new Promise<void>(resolve => { release = resolve; });
    const pending = state.execute({ kind: 'modify', operation: 'all' });
    state.retire(kind); release();
    await expect(pending).rejects.toThrow(/retired/i);
    expect(state.selection.applyState).not.toHaveBeenCalled();
  });
  it('accepts same-session canonical edits produced by settlement and preserves the exact lower result after retirement', async () => {
    const state = fixture(); let release!: (value: boolean) => void;
    state.ports.settle = async () => { state.session.publishProcessing({ adjustments: {
      ...state.session.getSnapshot().processing.adjustments, exposureEV: 2
    } }); };
    state.selection.applyState.mockImplementationOnce(() => new Promise<boolean>(resolve => { release = resolve; }));
    const pending = state.execute({ kind: 'modify', operation: 'clear' });
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    state.retire('session'); release(true);
    expect(await pending).toEqual({ operation: 'clear' });
  });
  it('propagates settlement and lower failures without dispatching a successor or manufacturing success', async () => {
    const state = fixture();
    state.ports.settle = async () => { throw new Error('Blocked terminal'); };
    await expect(state.execute({ kind: 'modify', operation: 'all' })).rejects.toThrow('Blocked terminal');
    expect(state.selection.applyState).not.toHaveBeenCalled();
    state.ports.settle = async () => undefined;
    state.selection.applyState.mockRejectedValueOnce(new Error('Kernel failed'));
    await expect(state.execute({ kind: 'modify', operation: 'all' })).rejects.toThrow('Kernel failed');
  });
});
