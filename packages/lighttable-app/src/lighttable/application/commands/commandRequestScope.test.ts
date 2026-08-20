import { describe, expect, it } from 'vitest';
import { commandDocumentTarget, commandScope } from './commandRequestScope';

describe('commandDocumentTarget', () => {
  it('omits a document target for workspace commands', () => {
    expect(commandDocumentTarget('document.create', 'current-document')).toEqual({});
    expect(commandDocumentTarget('file.openArtifact', 'current-document')).toEqual({});
  });

  it('uses the current document for document commands', () => {
    expect(commandScope('layer.createRaster')).toBe('document');
    expect(commandDocumentTarget('layer.createRaster', 'current-document'))
      .toEqual({ documentId: 'current-document' });
  });
});
