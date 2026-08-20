import { describe, expect, it } from 'vitest';
import {
  parseSemanticCopyGradeCommand,
  parseSemanticPasteGradeCommand
} from './semanticGradeClipboardCommandContract';

describe('semantic Grade clipboard command contract', () => {
  it('accepts only empty Copy parameters', () => {
    expect(parseSemanticCopyGradeCommand({})).toEqual({});
    expect(parseSemanticCopyGradeCommand({ hidden: true })).toHaveProperty('message');
    expect(parseSemanticCopyGradeCommand(null)).toHaveProperty('message');
  });

  it('accepts only one bounded Paste artifact identity', () => {
    expect(parseSemanticPasteGradeCommand({ artifactId: 'artifact-1' }))
      .toEqual({ artifactId: 'artifact-1' });
    expect(parseSemanticPasteGradeCommand({ artifactId: '' })).toHaveProperty('message');
    expect(parseSemanticPasteGradeCommand({ artifactId: 'artifact-1', settings: {} }))
      .toHaveProperty('message');
  });
});
