import { describe, expect, it } from 'vitest';
import type { PsdImportCompatibilityEntry } from '../psd/psdDocumentAdapter';
import { summarizePsdCompatibility } from './useEditorDiagnosticsController';

describe('summarizePsdCompatibility', () => {
  it('reports only support categories present in the imported document', () => {
    const entries = [
      { support: 'native' },
      { support: 'native' },
      { support: 'raster-preview' },
      { support: 'preserved' }
    ] as PsdImportCompatibilityEntry[];

    expect(summarizePsdCompatibility(entries)).toBe(
      '2 native; 1 preview-backed; 1 preserved/no-op'
    );
  });
});

