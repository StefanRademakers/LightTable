import { describe, expect, it } from 'vitest';
import { createImageDocument } from '../../editor/document/documentTypes';
import { captureRendererBinding } from './rendererBindingToken';

describe('RendererBindingToken', () => {
  it('invalidates on document, revision, renderer or generation replacement', () => {
    let document = createImageDocument('First', 64, 64, 'source');
    let renderer = {};
    let generation = 3;
    const source = {
      getDocument: () => document,
      getRenderer: () => renderer,
      getRendererGeneration: () => generation
    };

    expect(captureRendererBinding(source).isCurrent()).toBe(true);
    const revisionToken = captureRendererBinding(source);
    document = { ...document, revision: document.revision + 1 };
    expect(revisionToken.isCurrent()).toBe(false);

    const rendererToken = captureRendererBinding(source);
    renderer = {};
    expect(rendererToken.isCurrent()).toBe(false);

    const generationToken = captureRendererBinding(source);
    generation += 1;
    expect(generationToken.isCurrent()).toBe(false);

    const documentToken = captureRendererBinding(source);
    document = createImageDocument('Second', 64, 64, 'other');
    expect(() => documentToken.assertCurrent('Export')).toThrow(
      'Export was canceled because the document renderer changed.'
    );
  });
});
