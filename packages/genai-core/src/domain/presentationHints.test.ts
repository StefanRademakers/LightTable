import { describe, expect, it } from 'vitest';
import type { GenAiFieldDefinition } from './contracts';
import { genAiFieldPlacement } from './presentationHints';

const field = (key: string, advanced = false): GenAiFieldDefinition => ({
  key, label: key, kind: 'string', required: false, advanced, sourceSchema: {}
});

describe('GenAI presentation hints', () => {
  it('keeps LightTable layout hints separate from provider schemas', () => {
    expect(genAiFieldPlacement(field('quality'))).toBe('featured');
    expect(genAiFieldPlacement(field('providerSpecific'))).toBe('basic');
    expect(genAiFieldPlacement(field('seed'))).toBe('advanced');
    expect(genAiFieldPlacement(field('autoEnhancePrompt'))).toBe('advanced');
    expect(genAiFieldPlacement(field('providerSpecific', true))).toBe('advanced');
    expect(genAiFieldPlacement({ ...field('future'), kind: 'unknown' })).toBe('advanced');
  });
});
