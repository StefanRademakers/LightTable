import { describe, expect, it } from 'vitest';
import type { GenAiFieldDefinition } from './contracts';
import { genAiFieldPlacement } from './presentationHints';

const field = (key: string, advanced = false): GenAiFieldDefinition => ({
  key, label: key, kind: 'string', required: false, advanced, sourceSchema: {}
});

describe('GenAI presentation hints', () => {
  it('uses provider-independent semantic roles for featured controls', () => {
    expect(genAiFieldPlacement({ ...field('providerQuality'), role: 'quality' })).toBe('featured');
    expect(genAiFieldPlacement({ ...field('providerResolution'), role: 'output-size' })).toBe('featured');
    expect(genAiFieldPlacement(field('resolutionTier'))).toBe('basic');
    expect(genAiFieldPlacement(field('providerSpecific'))).toBe('basic');
    expect(genAiFieldPlacement(field('seed'))).toBe('advanced');
    expect(genAiFieldPlacement(field('autoEnhancePrompt'))).toBe('advanced');
    expect(genAiFieldPlacement(field('providerSpecific', true))).toBe('advanced');
    expect(genAiFieldPlacement({ ...field('future'), kind: 'unknown' })).toBe('advanced');
  });
});
