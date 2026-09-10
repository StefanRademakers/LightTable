import { describe, expect, it } from 'vitest';
import type { DocumentSessionId, SelectionRevision, TransactionId } from './identities';
import {
  assertCommittedSelectionState,
  SelectionMutationCoordinator,
  type CommittedSelectionState,
} from './selection';

const state = (
  input: Partial<CommittedSelectionState<Uint16Array, string>> = {},
): CommittedSelectionState<Uint16Array, string> => ({
  documentSessionId: 'document-1' as DocumentSessionId,
  revision: 1 as SelectionRevision,
  canvas: { width: 100, height: 80 },
  active: true,
  coverage: new Uint16Array(100 * 80),
  supportBounds: { x: 10, y: 12, width: 30, height: 20 },
  provenance: ['rectangle'],
  ...input,
});

describe('assertCommittedSelectionState', () => {
  it('accepts one coherent active coverage value', () => {
    expect(() => assertCommittedSelectionState(state())).not.toThrow();
  });

  it('allows active off-canvas coverage but rejects incoherent inactive state', () => {
    expect(() => assertCommittedSelectionState(state({ supportBounds: null })))
      .not.toThrow();
    expect(() => assertCommittedSelectionState(state({ active: false })))
      .toThrow('inactive selection cannot');
    expect(() => assertCommittedSelectionState(state({
      active: false, supportBounds: null,
    }))).toThrow('semantic provenance');
  });

  it('rejects support bounds outside the effective canvas', () => {
    expect(() => assertCommittedSelectionState(state({
      supportBounds: { x: 90, y: 12, width: 30, height: 20 },
    }))).toThrow('effective in-canvas coverage');
  });
});

describe('SelectionMutationCoordinator', () => {
  const documentSessionId = 'document-1' as DocumentSessionId;
  const baseline: CommittedSelectionState<string, string> = {
    documentSessionId, revision: 0 as SelectionRevision,
    canvas: { width: 20, height: 10 }, active: false,
    coverage: 'before', supportBounds: null, provenance: [],
  };
  const after: CommittedSelectionState<string, string> = {
    ...baseline, revision: 1 as SelectionRevision, active: true,
    coverage: 'after', supportBounds: { x: 2, y: 2, width: 4, height: 3 },
    provenance: ['rectangle'],
  };

  it('publishes state and history around one reversible projection activation', async () => {
    let current = baseline;
    const events: string[] = [];
    const coordinator = new SelectionMutationCoordinator<string, string, string>({
      state: {
        read: () => current,
        compareAndSwap: (expected, next) => {
          events.push('state');
          if (current.revision !== expected) return false;
          current = next;
          return true;
        },
      },
      projection: {
        prepare: async () => ({
          transactionId: 'transaction-1' as TransactionId,
          baselineRevision: baseline.revision, result: after,
          activate: () => {
            events.push('activate');
            return { accept: () => events.push('accept'), rollback: () => events.push('rollback') };
          },
          dispose: () => events.push('dispose'),
        }),
        presentPreview: () => undefined, clearPreview: () => undefined,
      },
      history: {
        reserve: () => {
          events.push('reserve');
          return { commit: () => { events.push('history'); return true; },
            cancel: () => events.push('cancel') };
        },
      },
      publication: { run: (operation) => operation() },
    });
    const result = await coordinator.execute({
      target: { sessionId: documentSessionId, revision: 0 as never },
      intent: 'rectangle', transactionId: 'transaction-1' as TransactionId,
      signal: new AbortController().signal,
    });
    expect(result).toEqual({ ok: true, selection: after });
    expect(current).toBe(after);
    expect(events).toEqual(['reserve', 'state', 'activate', 'history', 'accept']);
  });

  it('never activates the renderer and cancels history on a revision conflict', async () => {
    const events: string[] = [];
    const coordinator = new SelectionMutationCoordinator<string, string, string>({
      state: { read: () => baseline, compareAndSwap: () => false },
      projection: {
        prepare: async () => ({ transactionId: 'transaction-2' as TransactionId,
          baselineRevision: baseline.revision, result: after,
          activate: () => ({ accept: () => events.push('accept'),
            rollback: () => events.push('rollback') }), dispose: () => events.push('dispose') }),
        presentPreview: () => undefined, clearPreview: () => undefined,
      },
      history: { reserve: () => ({ commit: () => true,
        cancel: () => events.push('cancel') }) },
      publication: { run: (operation) => operation() },
    });
    const result = await coordinator.execute({
      target: { sessionId: documentSessionId, revision: 0 as never }, intent: 'rectangle',
      transactionId: 'transaction-2' as TransactionId, signal: new AbortController().signal,
    });
    expect(result).toMatchObject({ ok: false, reason: 'conflict' });
    expect(events).toEqual(['dispose', 'cancel']);
  });

  it('restores canonical state when projection activation fails after CAS', async () => {
    let current = baseline;
    const events: string[] = [];
    const coordinator = new SelectionMutationCoordinator<string, string, string>({
      state: {
        read: () => current,
        compareAndSwap: (expected, next) => {
          events.push(next === after ? 'state-after' : 'state-before');
          if (current.revision !== expected) return false;
          current = next;
          return true;
        },
      },
      projection: {
        prepare: async () => ({ transactionId: 'transaction-activation' as TransactionId,
          baselineRevision: baseline.revision, result: after,
          activate: () => { events.push('activate'); throw new Error('activation failed'); },
          dispose: () => events.push('dispose') }),
        presentPreview: () => undefined, clearPreview: () => undefined,
      },
      history: { reserve: () => ({ commit: () => true,
        cancel: () => events.push('cancel') }) },
      publication: { run: (operation) => operation() },
    });
    const result = await coordinator.execute({
      target: { sessionId: documentSessionId, revision: 0 as never }, intent: 'rectangle',
      transactionId: 'transaction-activation' as TransactionId,
      signal: new AbortController().signal,
    });
    expect(result).toMatchObject({ ok: false, reason: 'prepare-failed' });
    expect(current).toBe(baseline);
    expect(events).toEqual(['state-after', 'activate', 'state-before', 'dispose', 'cancel']);
  });

  it('keeps published state and history when terminal acceptance cleanup misbehaves', async () => {
    let current = baseline;
    let historyCommitted = false;
    let rolledBack = false;
    const coordinator = new SelectionMutationCoordinator<string, string, string>({
      state: {
        read: () => current,
        compareAndSwap: (expected, next) => {
          if (current.revision !== expected) return false;
          current = next;
          return true;
        },
      },
      projection: {
        prepare: async () => ({
          transactionId: 'transaction-cleanup' as TransactionId,
          baselineRevision: baseline.revision,
          result: after,
          activate: () => ({
            accept: () => { throw new Error('cleanup failed'); },
            rollback: () => { rolledBack = true; },
          }),
          dispose: () => undefined,
        }),
        presentPreview: () => undefined,
        clearPreview: () => undefined,
      },
      history: {
        reserve: () => ({
          commit: () => { historyCommitted = true; return true; },
          cancel: () => undefined,
        }),
      },
      publication: { run: (operation) => operation() },
    });

    await expect(coordinator.execute({
      target: { sessionId: documentSessionId, revision: 0 as never },
      intent: 'rectangle',
      transactionId: 'transaction-cleanup' as TransactionId,
      signal: new AbortController().signal,
    })).resolves.toEqual({ ok: true, selection: after });
    expect(current).toBe(after);
    expect(historyCommitted).toBe(true);
    expect(rolledBack).toBe(false);
  });
});
