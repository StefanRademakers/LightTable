import { describe, expect, it } from 'vitest';
import { MAX_BATCH_OPERATIONS, parseAtomicCommandBatch } from './atomicCommandBatchContract';

describe('atomic command batch contract', () => {
  it('accepts bounded unique ordered operations', () => {
    expect(parseAtomicCommandBatch({ name: 'Build card', operations: [
      { operationId: 'rename', command: 'layer.rename', parameters: { layerId: 'a', name: 'Card' } }
    ] })).toMatchObject({ name: 'Build card', timeoutMs: 5000 });
  });

  it('rejects duplicate IDs, unsupported commands and operation overflow', () => {
    const operation = { operationId: 'same', command: 'layer.rename', parameters: {} };
    expect(parseAtomicCommandBatch({ name: 'Bad', operations: [operation, operation] })).toBeNull();
    expect(parseAtomicCommandBatch({ name: 'Bad', operations: [{ ...operation, command: 'file.exportPng' }] })).toBeNull();
    expect(parseAtomicCommandBatch({ name: 'Bad', operations: Array.from({ length: MAX_BATCH_OPERATIONS + 1 },
      (_, index) => ({ ...operation, operationId: String(index) })) })).toBeNull();
  });
});
