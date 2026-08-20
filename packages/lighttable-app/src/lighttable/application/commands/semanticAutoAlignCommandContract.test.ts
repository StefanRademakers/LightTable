import { describe, expect, it } from 'vitest';
import { parseSemanticAutoAlignCommand } from './semanticAutoAlignCommandContract';

describe('semantic Auto Align command contract', () => {
  it('accepts two distinct explicit layer IDs', () => {
    expect(parseSemanticAutoAlignCommand({ referenceLayerId: 'reference', targetLayerId: 'target' }))
      .toEqual({ referenceLayerId: 'reference', targetLayerId: 'target' });
  });

  it.each([null, {}, { referenceLayerId: 'same', targetLayerId: 'same' },
    { referenceLayerId: 'reference', targetLayerId: 'target', preview: true }])('rejects %#', (value) => {
    expect(parseSemanticAutoAlignCommand(value)).toHaveProperty('message');
  });
});
