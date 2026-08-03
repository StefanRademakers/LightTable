import { describe, expect, it } from 'vitest';
import type { PsdImportCompatibilityEntry } from '../psd/psdDocumentAdapter';
import type { LightTableDebugMessage } from '../debug/debugLog';
import {
  diagnosticMessageAlreadyRecorded,
  summarizePsdCompatibility
} from './useEditorDiagnosticsController';

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

describe('diagnostic message de-duplication', () => {
  const message: LightTableDebugMessage = {
    id: 1,
    timestamp: 1,
    severity: 'info',
    source: 'PSD comparison',
    message: '1.000% pixels differ.',
    details: 'Stable metrics.'
  };

  it('does not append an identical informational sample again', () => {
    expect(diagnosticMessageAlreadyRecorded(
      [message],
      'info',
      message.source,
      message.message,
      message.details
    )).toBe(true);
  });

  it('retains repeated warnings and changed informational samples', () => {
    expect(diagnosticMessageAlreadyRecorded(
      [message],
      'warning',
      message.source,
      message.message,
      message.details
    )).toBe(false);
    expect(diagnosticMessageAlreadyRecorded(
      [message],
      'info',
      message.source,
      '2.000% pixels differ.',
      message.details
    )).toBe(false);
  });
});
