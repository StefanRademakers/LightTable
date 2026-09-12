import { expect, it, vi } from 'vitest';
import { DocumentSession, type DocumentSessionId } from '../documents/documentSession';
import { createImageDocument } from '../../editor/document/documentTypes';
import { createInteractionTransitionCoordinator } from './InteractionTransitionCoordinator';
import { MountedDocumentAdmission } from './MountedDocumentAdmission';
import { createAdjustmentInteractionCoordinator } from '../adjustments/AdjustmentInteractionCoordinator';

const deferred = () => { let resolve!: () => void, reject!: (reason: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const session = () => {
  const value = new DocumentSession({ id: 'same-id' as DocumentSessionId,
    source: { id: 'source', name: 'Image', mediaType: 'image/png' } });
  value.setDocument(createImageDocument('Image', 20, 10, 'pixels')); value.setReady(); return value;
};
const fixture = () => {
  let document: DocumentSession | null = session(), renderer: object | null = {}, lifecycle = {}, generation = 1;
  let image = document.getSnapshot().document;
  const report = vi.fn(), settle = vi.fn(async (_isCurrent: () => boolean) => {});
  const coordinator = createInteractionTransitionCoordinator({ settleMountedInteraction: settle, reportFailure: report });
  const owner = new MountedDocumentAdmission({ getSession: () => document, getRenderer: () => renderer,
    getImageDocument: () => image,
    captureScope: () => { const openingLifecycle = lifecycle, openingGeneration = generation;
      return { isCurrent: () => lifecycle === openingLifecycle && generation === openingGeneration }; },
    transitions: coordinator, reportFailure: report });
  return { owner, coordinator, report, settle, session: () => document!,
    renderer: () => renderer,
    rebindSuccessor: () => { document = session(); image = document.getSnapshot().document; renderer = {}; },
    mixedImage: () => { image = createImageDocument('Other', 20, 10, 'other'); },
    missingCanonical: () => { document!.setDocument(null); },
    unavailable: (kind: 'session' | 'renderer') => { if (kind === 'session') document = null; else renderer = null; },
    retire: (kind: 'session' | 'renderer' | 'lifecycle' | 'generation' | 'dispose') => {
      if (kind === 'session') document = session();
      else if (kind === 'renderer') renderer = {};
      else if (kind === 'lifecycle') lifecycle = {};
      else if (kind === 'generation') generation++;
      else document!.dispose();
    } };
};
it('keeps UI fire-and-forget and strict Promise<void> prerequisite behavior', async () => {
  const f = fixture(), action = vi.fn();
  expect(f.owner.runAfter(action)).toBeUndefined();
  await vi.waitFor(() => expect(action).toHaveBeenCalledOnce());
  await expect(f.owner.settle()).resolves.toBeUndefined(); expect(f.settle).toHaveBeenCalledTimes(2);
});
it.each(['session', 'renderer', 'lifecycle', 'generation', 'dispose'] as const)(
  'never settles a successor if %s changes before dequeue', async kind => {
    const f = fixture(), blocked = deferred(), action = vi.fn();
    f.settle.mockImplementationOnce(() => blocked.promise);
    const first = f.coordinator.request('commit-before-mutation');
    await Promise.resolve(); f.owner.runAfter(action); f.retire(kind); blocked.resolve(); await first;
    for (let index = 0; index < 8; index++) await Promise.resolve();
    expect(f.settle).toHaveBeenCalledOnce(); expect(action).not.toHaveBeenCalled(); expect(f.report).not.toHaveBeenCalled();
  });
it.each(['session', 'renderer', 'lifecycle', 'generation', 'dispose'] as const)(
  'strict settlement rejects %s retirement during its await', async kind => {
    const f = fixture(), blocked = deferred(); f.settle.mockImplementationOnce(() => blocked.promise);
    const operation = f.owner.settle(); const rejected = expect(operation).rejects.toThrow('retired');
    await Promise.resolve(); f.retire(kind); blocked.resolve(); await rejected;
    expect(f.report).not.toHaveBeenCalled();
  });
it('permits canonical revision changes authored by the admitted terminal', async () => {
  const f = fixture(), action = vi.fn(), before = f.session().getSnapshot().documentRevision;
  f.settle.mockImplementationOnce(async () => { f.session().markChanged(); });
  f.owner.runAfter(action); await vi.waitFor(() => expect(action).toHaveBeenCalledOnce());
  expect(f.session().getSnapshot().documentRevision).toBeGreaterThan(before);
});
it('reports genuine coordinator failure once and never invokes the successor', async () => {
  const f = fixture(), action = vi.fn(); f.settle.mockRejectedValueOnce(new Error('GPU terminal failed'));
  f.owner.runAfter(action); await vi.waitFor(() => expect(f.report).toHaveBeenCalledOnce());
  expect(f.report).toHaveBeenCalledWith('Could not finish the active document interaction: GPU terminal failed');
  expect(action).not.toHaveBeenCalled();
});
it('strict prerequisite propagates a genuine rejected terminal', async () => {
  const f = fixture(); f.settle.mockRejectedValueOnce(new Error('GPU terminal failed'));
  await expect(f.owner.settle()).rejects.toThrow('GPU terminal failed'); expect(f.report).toHaveBeenCalledOnce();
});
it('does not publish a late settlement failure into a successor document', async () => {
  const f = fixture(), blocked = deferred(), action = vi.fn(); f.settle.mockImplementationOnce(() => blocked.promise);
  f.owner.runAfter(action); await Promise.resolve(); f.retire('session'); blocked.reject(new Error('Old GPU failure'));
  for (let index = 0; index < 8; index++) await Promise.resolve();
  expect(action).not.toHaveBeenCalled(); expect(f.report).not.toHaveBeenCalled();
});
it.each(['sync', 'async'] as const)('reports %s successor failure while its source is current', async kind => {
  const f = fixture(); f.owner.runAfter(kind === 'sync'
    ? () => { throw new Error('Action failed'); } : async () => { throw new Error('Action failed'); });
  await vi.waitFor(() => expect(f.report).toHaveBeenCalledWith('Action failed'));
});
it('suppresses an asynchronous action failure after source retirement', async () => {
  const f = fixture(), action = deferred(), started = vi.fn(() => action.promise);
  f.owner.runAfter(started); await vi.waitFor(() => expect(started).toHaveBeenCalledOnce());
  f.retire('renderer'); action.reject(new Error('Old action failed'));
  for (let index = 0; index < 8; index++) await Promise.resolve(); expect(f.report).not.toHaveBeenCalled();
});
it.each(['session', 'renderer'] as const)('does not queue work without a ready %s', async kind => {
  const f = fixture(); f.unavailable(kind); const action = vi.fn(); f.owner.runAfter(action);
  await expect(f.owner.settle()).rejects.toThrow('unavailable');
  expect(f.settle).not.toHaveBeenCalled(); expect(action).not.toHaveBeenCalled();
  expect(f.report).toHaveBeenCalledExactlyOnceWith('The mounted document renderer is unavailable.');
});
it.each(['mixedImage', 'missingCanonical'] as const)('rejects %s before any tool settlement', async kind => {
  const f = fixture(); f[kind](); const action = vi.fn(); f.owner.runAfter(action);
  await expect(f.owner.settle()).rejects.toThrow('unavailable');
  expect(f.settle).not.toHaveBeenCalled(); expect(action).not.toHaveBeenCalled();
  expect(f.report).toHaveBeenCalledExactlyOnceWith('The mounted document renderer is unavailable.');
});
it('does not report an already disposed owner as a new current UI fault', () => {
  const f = fixture(), action = vi.fn(); f.retire('dispose'); f.owner.runAfter(action);
  expect(f.report).not.toHaveBeenCalled(); expect(action).not.toHaveBeenCalled();
});
it('offers truthful result-based admission without changing strict settlement semantics', async () => {
  const f = fixture(); expect(await f.owner.request()).toEqual({ status: 'admitted' });
  f.unavailable('renderer'); expect((await f.owner.request()).status).toBe('rejected');
  expect(f.report).toHaveBeenCalledExactlyOnceWith('The mounted document renderer is unavailable.');
});
it('the real adjustment gesture coordinator cannot settle or begin against a replaced renderer while queued', async () => {
  const f = fixture(), blocked = deferred(); f.settle.mockImplementationOnce(() => blocked.promise);
  const first = f.coordinator.request('commit-before-mutation'); await Promise.resolve();
  const controller = { active: false, begin: vi.fn(() => ({ sequence: 1 })),
    end: vi.fn(() => 'committed' as const), cancel: vi.fn(), reset: vi.fn(), changeResult: vi.fn(() => 'applied' as const) };
  const adjustments = createAdjustmentInteractionCoordinator(controller, f.owner.request,
    () => ({ isCurrent: () => true }), f.report);
  const gesture = adjustments.begin('exposure'); adjustments.change(gesture, value => ({ ...value, exposureEV: 2 }));
  f.retire('renderer'); blocked.resolve(); await first;
  for (let index = 0; index < 12; index++) await Promise.resolve();
  expect(f.settle).toHaveBeenCalledOnce(); expect(controller.begin).not.toHaveBeenCalled();
  expect(controller.changeResult).not.toHaveBeenCalled(); expect(f.report).not.toHaveBeenCalled();
});
it('a retained registered A callback cannot adopt an otherwise valid same-ID successor B', async () => {
  const f = fixture(); const registered = f.owner.bindOwner(f.session(), f.renderer(), { isCurrent: () => true });
  f.rebindSuccessor(); await expect(registered()).rejects.toThrow('unavailable');
  expect(f.settle).not.toHaveBeenCalled(); expect(f.report).not.toHaveBeenCalled();
  await expect(f.owner.settle()).resolves.toBeUndefined(); expect(f.settle).toHaveBeenCalledOnce();
});
it('a retained registration rejects a lifecycle replacement before invoking any participant', async () => {
  const f = fixture(); let registered = true;
  const settle = f.owner.bindOwner(f.session(), f.renderer(), { isCurrent: () => registered });
  registered = false; await expect(settle()).rejects.toThrow('unavailable'); expect(f.settle).not.toHaveBeenCalled();
});
