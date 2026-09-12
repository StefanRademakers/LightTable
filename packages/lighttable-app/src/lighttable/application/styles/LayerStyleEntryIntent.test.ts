import { expect, it, vi } from 'vitest';
import { createImageDocument } from '../../editor/document/documentTypes';
import { createRasterLayer } from '../../editor/document/documentCommands';
import { executeSemanticLayerStyleCommand } from './semanticLayerStyleCommandExecutor';
import type { LightTableCommandResult } from '../commands/lightTableCommandContract';
import { LayerStyleEntryIntent } from './LayerStyleEntryIntent';

const harness = () => {
  let document = createRasterLayer(createImageDocument('A', 20, 20, 'fixture')), current = true, ticketCurrent = true;
  let complete!: (result: LightTableCommandResult) => void, reject!: (reason: unknown) => void;
  const execute = vi.fn(() => new Promise<LightTableCommandResult>((resolve, fail) => { complete = resolve; reject = fail; }));
  const openEditor = vi.fn(), show = vi.fn(), reportFailure = vi.fn();
  const owner = new LayerStyleEntryIntent(() => ({ isCurrent: () => current, getDocument: () => document,
    beginPresentation: () => ({ isCurrent: () => ticketCurrent, show }), openEditor, execute, reportFailure }));
  const add = () => {
    const value = executeSemanticLayerStyleCommand({ kind: 'add', layerId: document.activeLayerId!, effectKind: 'drop-shadow' }, {
      changeDocument: change => { document = change(document); return true; }
    });
    complete({ status: 'completed', value } as LightTableCommandResult); return value;
  };
  return { owner, execute, openEditor, show, reportFailure, add, document: () => document,
    retire: () => { current = false; }, supersede: () => { ticketCurrent = false; }, reject: (reason: unknown) => reject(reason),
    complete: (result: LightTableCommandResult) => complete(result) };
};
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
it('opens only the actual committed effect through the existing controller and inspector', async () => {
  const h = harness(); h.owner.add('drop-shadow'); const value = h.add(); await flush();
  expect(h.openEditor).toHaveBeenCalledWith(value!.layerId, value!.effectId);
  expect(h.show).toHaveBeenCalledWith({ kind: 'style', layerId: value!.layerId, effectId: value!.effectId });
});
it.each(['retire', 'supersede'] as const)('does not steal successor presentation after %s', async action => {
  const h = harness(); h.owner.add('drop-shadow'); h[action](); h.add(); await flush();
  expect(h.openEditor).not.toHaveBeenCalled(); expect(h.show).not.toHaveBeenCalled();
});
it('reports actual failures once while suppressing retired errors', async () => {
  const h = harness(); h.owner.add('drop-shadow'); h.reject(new Error('history failed')); await flush();
  expect(h.reportFailure).toHaveBeenCalledWith('history failed');
  h.owner.add('drop-shadow'); h.retire(); h.reject(new Error('retired')); await flush();
  expect(h.reportFailure).toHaveBeenCalledOnce();
});
it('does not turn an invalid command result into a plausible inspector target', async () => {
  const h = harness(); h.owner.add('drop-shadow');
  h.complete({ status: 'completed', value: { layerId: h.document().activeLayerId, effectId: 'missing' } } as LightTableCommandResult);
  await flush(); expect(h.show).not.toHaveBeenCalled(); expect(h.reportFailure).toHaveBeenCalledOnce();
});
it('keeps informational inspector entry independent of edit admission', () => {
  const h = harness(), id = h.document().activeLayerId!;
  h.owner.open(id); expect(h.openEditor).toHaveBeenCalledWith(id, undefined);
  expect(h.show).toHaveBeenCalledWith({ kind: 'style-stack', layerId: id });
});
it('does not dispatch through a retired presentation owner', () => {
  const h = harness(); h.supersede(); h.owner.add('drop-shadow'); expect(h.execute).not.toHaveBeenCalled();
});
it('does not report an old entry error over a newer inspector request', async () => {
  const h = harness(); h.owner.add('drop-shadow'); h.supersede(); h.reject(new Error('old request')); await flush();
  expect(h.reportFailure).not.toHaveBeenCalled();
});
