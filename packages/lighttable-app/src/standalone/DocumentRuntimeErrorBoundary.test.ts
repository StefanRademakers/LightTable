import { describe, expect, it } from 'vitest';
import { normalizeDocumentRuntimeError } from './DocumentRuntimeErrorBoundary';

describe('normalizeDocumentRuntimeError', () => {
  it('keeps Error identity for diagnostics', () => {
    const error = new Error('renderer failed');
    expect(normalizeDocumentRuntimeError(error)).toBe(error);
  });

  it('normalizes non-Error throws into an Error', () => {
    expect(normalizeDocumentRuntimeError('renderer failed').message)
      .toBe('renderer failed');
  });
});
