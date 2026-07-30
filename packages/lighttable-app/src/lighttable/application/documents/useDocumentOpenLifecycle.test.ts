import { describe, expect, it } from 'vitest';
import { createDocumentOpenGenerationGuard } from './useDocumentOpenLifecycle';

describe('createDocumentOpenGenerationGuard', () => {
  it('invalidates every callback sharing the document generation', () => {
    const guard = createDocumentOpenGenerationGuard();
    const firstConsumer = guard.context.isCurrent;
    const secondConsumer = guard.context.isCurrent;

    expect(firstConsumer()).toBe(true);
    expect(secondConsumer()).toBe(true);
    guard.invalidate();
    expect(firstConsumer()).toBe(false);
    expect(secondConsumer()).toBe(false);
  });
});
