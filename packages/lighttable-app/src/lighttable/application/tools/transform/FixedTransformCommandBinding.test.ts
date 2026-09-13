import { describe, expect, it, vi } from 'vitest';
import type { DocumentSession } from '../../documents/documentSession';
import { FixedTransformCommandBinding } from './FixedTransformCommandBinding';

describe('FixedTransformCommandBinding', () => {
  it('reads completion from the captured session rather than the current tab', async () => {
    let document = { id: 'document-a', revision: 4 };
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const session = { getSnapshot: () => ({ document }) } as unknown as DocumentSession;
    const owner = new FixedTransformCommandBinding({
      getSession: () => session,
      applyFixed: async () => { await pending; document = { ...document, revision: 5 }; return 'layer'; },
      recordCommitted: vi.fn()
    });

    const execution = owner.execute('flip-horizontal');
    release();

    await expect(execution).resolves.toEqual({
      operation: 'flip-horizontal', target: 'layer', documentRevision: 5
    });
  });

  it('suppresses duplicate observed layer transforms only while its semantic command runs', async () => {
    let document = { id: 'document-a', revision: 4 };
    const recordCommitted = vi.fn();
    const session = { getSnapshot: () => ({ document }) } as unknown as DocumentSession;
    let observe!: () => void;
    const owner = new FixedTransformCommandBinding({
      getSession: () => session,
      applyFixed: async () => {
        observe();
        document = { ...document, revision: 5 };
        return 'layer';
      },
      recordCommitted
    });
    observe = () => owner.observeCommitted('layer-a' as never, { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 });

    await owner.execute('rotate-180');
    observe();

    expect(recordCommitted).toHaveBeenCalledOnce();
  });
});
