import { describe, expect, it } from 'vitest';
import type { TextFontDiagnostic } from '../../text/fonts/textLayerFontStatus';
import {
  buildDocumentCapabilityFindings,
  sanitizeCompatibilityText,
  summarizeDocumentCapabilityFindings
} from './documentCapabilityFindings';

describe('document capability findings', () => {
  it('normalizes import fidelity and safe recovery actions', () => {
    const findings = buildDocumentCapabilityFindings({ warnings: [], compatibility: [
      { path: 'Native', feature: 'node', support: 'native', reason: 'Exact.' },
      { path: 'Preview', feature: 'text', support: 'raster-preview', reason: 'Preserved.' },
      { path: 'Effect', feature: 'layer-style', support: 'preserved', reason: 'Descriptor.' },
      { path: 'Blocked', feature: 'adjustment', support: 'preserved', reason: 'Cannot write.',
        parity: { visual: 'raster-preview', semantic: 'preserved', structural: 'preserved', roundTrip: 'unsupported' } }
    ] }, []);
    expect(findings.map(({ status }) => status)).toEqual([
      'exact', 'preview-backed', 'preview-backed', 'export-blocking'
    ]);
    expect(findings[1]?.actions).toEqual(['keep-preview', 'rasterize-copy']);
    expect(findings[2]?.actions).toContain('remove-effect');
    expect(findings[3]?.actions).toEqual(['cancel-export', 'export-flattened']);
    expect(summarizeDocumentCapabilityFindings(findings)).toMatchObject({ attention: 3, exact: 1 });
  });

  it('maps missing fonts to replacement without losing preview choice', () => {
    const diagnostic = {
      layerId: 'text' as never, layerName: 'Heading', editable: true,
      issue: 'font-missing', requestedFont: 'Missing', sourceIdentity: 'missing',
      runIndices: [0], metricsChanged: false,
      status: { kind: 'missing', label: 'Missing font', detail: 'Missing font.' }
    } satisfies TextFontDiagnostic;
    expect(buildDocumentCapabilityFindings(null, [diagnostic])[0]).toMatchObject({
      status: 'missing-asset', actions: ['replace-font', 'keep-preview']
    });
  });

  it('redacts local paths, control characters and excessive diagnostics', () => {
    expect(sanitizeCompatibilityText('Failed C:\\Users\\person\\secret\\design.psd\u0000 now'))
      .toBe('Failed design.psd  now');
    const bounded = sanitizeCompatibilityText(`Detail ${'x'.repeat(600)}`);
    expect(bounded.length).toBeLessThanOrEqual(500);
    expect(bounded.endsWith('…')).toBe(true);
  });
});
