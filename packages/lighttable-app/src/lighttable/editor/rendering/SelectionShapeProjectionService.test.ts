import { describe, expect, it, vi } from 'vitest';
import type {
  DocumentAddress,
  DocumentSessionId,
  SelectionRevision,
  TransactionId,
} from '@lighttable/editor-kernel';
import { SelectionMaskSnapshot } from '../selection/SelectionMaskSnapshot';
import type { SelectionOperation } from '../selection/selectionTypes';
import { SelectionShapeProjectionService } from './SelectionShapeProjectionService';
import { SelectionTextureStore } from './SelectionTextureStore';

const texture = () => ({ destroy: vi.fn() }) as unknown as GPUTexture;
const store = () => new SelectionTextureStore({
  createSelectionTexture: texture,
  createClipboardTexture: texture,
});
const document = {
  sessionId: 'document-1' as DocumentSessionId,
  revision: 7,
} as DocumentAddress;
const rectangle: SelectionOperation = {
  mode: 'replace',
  shape: { kind: 'rectangle', points: [{ x: 10, y: 12 }, { x: 40, y: 32 }] },
};

describe('SelectionShapeProjectionService', () => {
  it('activates the first selection when committed targets are still lazy', async () => {
    const committed = store();
    const staged = store();
    const service = new SelectionShapeProjectionService({
      committedTextures: committed,
      createStage: () => ({
        textures: staged,
        restore: () => true,
        apply: () => true,
        capture: async () => SelectionMaskSnapshot.fromRaw(
          100, 80, new Uint16Array(100 * 80).fill(0x3c00),
        ),
        measure: async () => ({
          coreBounds: { x: 10, y: 12, width: 30, height: 20 },
          supportBounds: { x: 10, y: 12, width: 30, height: 20 },
          peakCoverage: 1,
        }),
        dispose: () => staged.destroy(),
      }),
    });
    const baseline = {
      documentSessionId: document.sessionId,
      revision: 0 as SelectionRevision,
      canvas: { width: 100, height: 80 },
      active: false,
      coverage: SelectionMaskSnapshot.inactive(100, 80),
      supportBounds: null,
      provenance: [] as SelectionOperation[],
    };

    const prepared = await service.prepare(document, baseline, {
      shape: rectangle.shape, mode: 'replace', featherRadius: 0,
      antiAlias: true, provenance: rectangle,
    }, 'transaction-first' as TransactionId, new AbortController().signal);
    expect(committed.mask).toBeNull();

    prepared.activate().accept();

    expect(committed.mask).not.toBeNull();
    expect(committed.active).toBe(true);
    service.dispose();
    committed.destroy();
  });

  it('keeps prepared targets isolated and can atomically roll activation back', async () => {
    const committed = store();
    committed.ensureTargets();
    const originalMask = committed.mask;
    const staged = store();
    const dispose = vi.fn(() => staged.destroy());
    const service = new SelectionShapeProjectionService({
      committedTextures: committed,
      createStage: () => ({
        textures: staged,
        restore: vi.fn(() => true),
        apply: vi.fn(() => true),
        capture: vi.fn(async () => SelectionMaskSnapshot.fromRaw(
          100, 80, new Uint16Array(100 * 80).fill(0x3c00)
        )),
        measure: vi.fn(async () => ({
          coreBounds: { x: 10, y: 12, width: 30, height: 20 },
          supportBounds: { x: 10, y: 12, width: 30, height: 20 },
          peakCoverage: 1,
        })),
        dispose,
      }),
    });
    const baseline = {
      documentSessionId: document.sessionId,
      revision: 2 as SelectionRevision,
      canvas: { width: 100, height: 80 },
      active: false,
      coverage: SelectionMaskSnapshot.inactive(100, 80),
      supportBounds: null,
      provenance: [],
    };

    const prepared = await service.prepare(
      document,
      baseline,
      { shape: rectangle.shape, mode: 'replace', featherRadius: 0,
        antiAlias: true, provenance: rectangle },
      'transaction-1' as TransactionId,
      new AbortController().signal,
    );
    expect(committed.mask).toBe(originalMask);
    expect(prepared.result.supportBounds).toEqual({ x: 10, y: 12, width: 30, height: 20 });

    const activation = prepared.activate();
    expect(committed.mask).not.toBe(originalMask);
    activation.rollback();
    expect(committed.mask).toBe(originalMask);
    expect(dispose).toHaveBeenCalledOnce();
    service.dispose();
  });

  it('destroys staged targets when preparation is cancelled', async () => {
    const committed = store();
    committed.ensureTargets();
    const created: Array<{ destroy: ReturnType<typeof vi.fn> }> = [];
    const staged = new SelectionTextureStore({
      createSelectionTexture: () => {
        const value = { destroy: vi.fn() };
        created.push(value);
        return value as unknown as GPUTexture;
      },
      createClipboardTexture: texture,
    });
    const controller = new AbortController();
    const createStage = vi.fn(() => ({
      textures: staged,
      restore: vi.fn(() => true),
      apply: vi.fn(() => true),
      capture: vi.fn(async () => {
        controller.abort();
        return SelectionMaskSnapshot.fromRaw(100, 80, new Uint16Array(100 * 80));
      }),
      measure: vi.fn(),
      dispose: vi.fn(() => staged.destroy()),
    }));
    const service = new SelectionShapeProjectionService({ committedTextures: committed, createStage });
    await expect(service.prepare(document, {
      documentSessionId: document.sessionId,
      revision: 0 as SelectionRevision,
      canvas: { width: 100, height: 80 }, active: false,
      coverage: SelectionMaskSnapshot.inactive(100, 80), supportBounds: null, provenance: [],
    }, { shape: rectangle.shape, mode: 'replace', featherRadius: 0,
      antiAlias: false, provenance: rectangle }, 'transaction-2' as TransactionId,
    controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    service.dispose();
    expect(createStage).toHaveBeenCalledOnce();
    expect(created).toHaveLength(3);
    created.forEach((entry) => expect(entry.destroy).toHaveBeenCalledOnce());
  });

  it('normalizes an empty subtract result to one inactive committed value', async () => {
    const committed = store();
    committed.ensureTargets();
    const staged = store();
    const service = new SelectionShapeProjectionService({
      committedTextures: committed,
      createStage: () => ({
        textures: staged,
        restore: () => true,
        apply: () => true,
        capture: async () => SelectionMaskSnapshot.fromRaw(
          100, 80, new Uint16Array(100 * 80),
        ),
        measure: async () => null,
        dispose: () => staged.destroy(),
      }),
    });
    const result = await service.prepare(document, {
      documentSessionId: document.sessionId,
      revision: 3 as SelectionRevision,
      canvas: { width: 100, height: 80 }, active: true, coverage:
        SelectionMaskSnapshot.fromRaw(100, 80, new Uint16Array(100 * 80).fill(0x3c00)),
      supportBounds: { x: 0, y: 0, width: 100, height: 80 }, provenance: [rectangle],
    }, { shape: rectangle.shape, mode: 'subtract', featherRadius: 0,
      antiAlias: true, provenance: { ...rectangle, mode: 'subtract' } },
    'transaction-empty' as TransactionId, new AbortController().signal);

    expect(result.result).toMatchObject({ active: false, supportBounds: null, provenance: [] });
    expect(result.result.coverage.active).toBe(false);
    result.dispose();
    service.dispose();
  });

  it('reuses one spare target set across successive commits', async () => {
    const committed = store();
    committed.ensureTargets();
    let allocations = 0;
    const createStage = () => {
      const staged = new SelectionTextureStore({
        createSelectionTexture: () => {
          allocations += 1;
          return texture();
        },
        createClipboardTexture: texture,
      });
      return {
        textures: staged,
        restore: () => true,
        apply: () => true,
        capture: async () => SelectionMaskSnapshot.fromRaw(
          100, 80, new Uint16Array(100 * 80).fill(0x3c00),
        ),
        measure: async () => ({
          coreBounds: { x: 10, y: 12, width: 30, height: 20 },
          supportBounds: { x: 10, y: 12, width: 30, height: 20 }, peakCoverage: 1,
        }),
        dispose: () => staged.destroy(),
      };
    };
    const service = new SelectionShapeProjectionService({ committedTextures: committed, createStage });
    let baseline: Parameters<SelectionShapeProjectionService['prepare']>[1] = {
      documentSessionId: document.sessionId, revision: 0 as SelectionRevision,
      canvas: { width: 100, height: 80 }, active: false,
      coverage: SelectionMaskSnapshot.inactive(100, 80), supportBounds: null,
      provenance: [] as SelectionOperation[],
    };
    for (let index = 0; index < 2; index += 1) {
      const next = await service.prepare(document, baseline, {
        shape: rectangle.shape, mode: 'replace', featherRadius: 0,
        antiAlias: true, provenance: rectangle,
      }, `transaction-pool-${index}` as TransactionId, new AbortController().signal);
      next.activate().accept();
      baseline = next.result;
    }
    expect(allocations).toBe(3);
    service.dispose();
    committed.destroy();
  });
});
