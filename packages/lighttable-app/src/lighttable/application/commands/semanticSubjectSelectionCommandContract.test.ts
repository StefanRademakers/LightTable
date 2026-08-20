import { describe, expect, it } from 'vitest';
import { parseSemanticSubjectSelectionCommand } from './semanticSubjectSelectionCommandContract';

const subject = {
  kind: 'subject', sourceLayerId: 'portrait', mode: 'replace', sampleAllLayers: false
};

describe('semantic Select Subject contract', () => {
  it('accepts only the stable subject intent', () => {
    expect(parseSemanticSubjectSelectionCommand(subject)).toEqual(subject);
    expect(parseSemanticSubjectSelectionCommand({ ...subject, mode: 'add', sampleAllLayers: true }))
      .toMatchObject({ mode: 'add', sampleAllLayers: true });
  });

  it.each(['prompt', 'pointerId', 'mask', 'candidate', 'backend', 'refinementQuality'])(
    'rejects private or implementation-specific %s state', (key) => {
      expect(parseSemanticSubjectSelectionCommand({ ...subject, [key]: {} })).toHaveProperty('message');
    }
  );
});
