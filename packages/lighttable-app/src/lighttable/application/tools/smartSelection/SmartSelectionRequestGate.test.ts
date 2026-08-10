import { describe, expect, it, vi } from 'vitest';
import { SmartSelectionRequestGate } from './SmartSelectionRequestGate';
import type {
  PreparedSmartSelectionSource,
  SmartSelectionBackend,
  SmartSelectionCandidate,
  SmartSelectionSource
} from './SmartSelectionBackend';

const source = (key: string, revision: number): SmartSelectionSource => ({
  key,
  documentRevision: revision,
  width: 2,
  height: 2,
  image: new Blob()
});

const prepared = (input: SmartSelectionSource): PreparedSmartSelectionSource => ({
  id: input.key,
  sourceKey: input.key,
  documentRevision: input.documentRevision,
  width: input.width,
  height: input.height
});

describe('SmartSelectionRequestGate', () => {
  it('discards a preparation result superseded by a newer source', async () => {
    let resolveFirst!: (value: PreparedSmartSelectionSource) => void;
    const backend = {
      prepare: vi.fn()
        .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
        .mockImplementationOnce(async (input: SmartSelectionSource) => prepared(input)),
      selectPoint: vi.fn(), selectBox: vi.fn(),
      selectSubject: vi.fn(),
      disposePreparedSource: vi.fn(), dispose: vi.fn()
    } as unknown as SmartSelectionBackend;
    const gate = new SmartSelectionRequestGate(backend);
    const stalePromise = gate.prepare(source('old', 1));
    await expect(gate.prepare(source('new', 2))).resolves.toMatchObject({ id: 'new' });
    resolveFirst(prepared(source('old', 1)));
    await expect(stalePromise).resolves.toBeNull();
    expect(backend.disposePreparedSource).toHaveBeenCalledWith(expect.objectContaining({ id: 'old' }));
  });

  it('keeps the existing hover candidate authoritative while newer inference runs', async () => {
    let resolveFirst!: (value: SmartSelectionCandidate[]) => void;
    const candidate: SmartSelectionCandidate = {
      id: 'candidate', score: 1,
      mask: { width: 2, height: 2, data: new Uint8Array([0, 255, 0, 0]) }
    };
    const backend = {
      prepare: vi.fn(async (input: SmartSelectionSource) => prepared(input)),
      selectPoint: vi.fn()
        .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
        .mockImplementationOnce(async () => [candidate]),
      selectBox: vi.fn(), disposePreparedSource: vi.fn(), dispose: vi.fn()
    } as unknown as SmartSelectionBackend;
    const gate = new SmartSelectionRequestGate(backend);
    const ready = (await gate.prepare(source('source', 1)))!;
    const stale = gate.point(ready, { x: 0, y: 0 }, { hardEdge: false });
    await expect(gate.point(ready, { x: 1, y: 1 }, { hardEdge: false })).resolves.toEqual([candidate]);
    resolveFirst([candidate]);
    await expect(stale).resolves.toBeNull();
  });
});
