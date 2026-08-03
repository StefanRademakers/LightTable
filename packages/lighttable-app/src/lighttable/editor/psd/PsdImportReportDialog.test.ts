import { describe, expect, it } from 'vitest';
import type { TextFontDiagnostic } from '../../text/fonts/textLayerFontStatus';
import { buildDocumentCompatibilityEntries } from './PsdImportReportDialog';

const diagnostic = (
  kind: 'missing' | 'substituted',
  editable = true
): TextFontDiagnostic => ({
  layerId: `layer-${kind}` as TextFontDiagnostic['layerId'],
  layerName: `${kind} headline`,
  editable,
  issue: kind === 'missing' ? 'font-missing' : 'font-substituted',
  status: {
    kind,
    label: kind === 'missing' ? 'Missing font' : 'Substituted',
    detail: kind === 'missing'
      ? 'Missing font: Example; chosen=none; source=unavailable'
      : 'Example -> Inter; chosen=inter:0; source=bundled'
  }
});

describe('document compatibility report projection', () => {
  it('maps text font failures onto existing compatibility severities', () => {
    expect(buildDocumentCompatibilityEntries(null, [
      diagnostic('missing'),
      diagnostic('substituted', false)
    ])).toEqual([
      expect.objectContaining({
        feature: 'text-font', support: 'placeholder',
        layerId: 'layer-missing', editable: true
      }),
      expect.objectContaining({
        feature: 'text-font', support: 'approximate',
        layerId: 'layer-substituted', editable: false
      })
    ]);
  });

  it('keeps imported compatibility entries alongside live font diagnostics', () => {
    const imported = {
      warnings: [],
      compatibility: [{
        path: 'Layer 1', feature: 'node' as const,
        support: 'native' as const, reason: 'Native layer.'
      }]
    };
    expect(buildDocumentCompatibilityEntries(imported, [diagnostic('missing')]))
      .toHaveLength(2);
  });
});
