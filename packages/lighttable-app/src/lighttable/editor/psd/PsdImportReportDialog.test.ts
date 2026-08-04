import { describe, expect, it } from 'vitest';
import type { TextFontDiagnostic } from '../../text/fonts/textLayerFontStatus';
import {
  buildDocumentCompatibilityEntries,
  formatCompatibilityParity,
  groupMissingFontDiagnostics
} from './PsdImportReportDialog';

const diagnostic = (
  kind: 'missing' | 'substituted',
  editable = true
): TextFontDiagnostic => ({
  layerId: `layer-${kind}` as TextFontDiagnostic['layerId'],
  layerName: `${kind} headline`,
  editable,
  issue: kind === 'missing' ? 'font-missing' : 'font-substituted',
  requestedFont: 'Example-Regular',
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

  it('groups editable missing-font layers for one atomic document replacement', () => {
    const first = diagnostic('missing');
    expect(groupMissingFontDiagnostics([
      first,
      { ...first, layerId: 'layer-second' as never, layerName: 'Second headline' },
      { ...diagnostic('missing', false), layerId: 'positioned' as never },
      diagnostic('substituted')
    ])).toEqual([{
      requestedFont: 'Example-Regular',
      layerIds: ['layer-missing', 'layer-second'],
      layerNames: ['missing headline', 'Second headline']
    }]);
  });

  it('presents independent Photoshop parity axes without inventing a second status', () => {
    expect(formatCompatibilityParity({
      visual: 'raster-preview',
      semantic: 'preserved',
      structural: 'preserved',
      roundTrip: 'unsupported'
    })).toBe(
      'Visual: raster-preview · Semantic: preserved · Structural: preserved · Round-trip: unsupported'
    );
    expect(formatCompatibilityParity(undefined)).toBeNull();
  });
});
