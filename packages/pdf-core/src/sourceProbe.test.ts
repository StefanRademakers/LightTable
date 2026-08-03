import { describe, expect, it } from 'vitest';
import { createPdfSourceDescriptor, probePdfSource } from './sourceProbe';

const bytes = (value: string) => Uint8Array.from(value, character => character.charCodeAt(0));

describe('PDF and Illustrator source probing', () => {
  it('keeps an ordinary PDF distinct from Illustrator input', () => {
    expect(probePdfSource(bytes('%PDF-1.7\n1 0 obj<</Creator(Other)>>'), 'page.pdf')).toEqual({
      kind: 'pdf', importable: true, pdfVersion: '1.7', nativeAiData: 'absent',
      evidence: ['pdf-header'], requiresOriginalSourcePreservation: true
    });
  });

  it('detects PDF-compatible AI by extension or bounded Illustrator metadata', () => {
    expect(probePdfSource(bytes('%PDF-1.6\n'), 'drawing.ai')).toMatchObject({
      kind: 'pdf-compatible-ai', evidence: ['pdf-header', 'ai-extension']
    });
    expect(probePdfSource(bytes('%PDF-1.5\n/Creator(Adobe Illustrator 29.0)'), 'drawing.pdf'))
      .toMatchObject({ kind: 'pdf-compatible-ai', evidence: ['pdf-header', 'illustrator-metadata'] });
  });

  it('records private Illustrator payloads as preserved and unsupported', () => {
    const probe = probePdfSource(bytes('%PDF-1.7\n/PieceInfo << /Illustrator << /AIPrivateData 8 0 R'), 'drawing.pdf');
    expect(probe).toMatchObject({
      kind: 'pdf-compatible-ai', nativeAiData: 'preserved-unsupported'
    });
    expect(probe.evidence).toContain('native-ai-private-data');
  });

  it('rejects native PostScript AI for semantic PDF import but preserves its source', () => {
    expect(probePdfSource(bytes('%!PS-Adobe-3.0\n%%Creator: Adobe Illustrator(R) 8.0'), 'legacy.ai'))
      .toMatchObject({
        kind: 'native-ai', importable: false, nativeAiData: 'preserved-unsupported',
        requiresOriginalSourcePreservation: true
      });
    expect(probePdfSource(bytes('opaque future Illustrator payload'), 'future.ai'))
      .toMatchObject({ kind: 'native-ai', importable: false, requiresOriginalSourcePreservation: true });
  });

  it('bounds metadata scanning to the source head and tail', () => {
    const source = bytes(`%PDF-1.7\n${'x'.repeat(64)}Adobe Illustrator${'y'.repeat(64)}`);
    expect(probePdfSource(source, 'page.pdf', { maximumMarkerScanBytes: 32 }).kind).toBe('pdf');
    const atTail = bytes(`%PDF-1.7\n${'x'.repeat(64)}Adobe Illustrator`);
    expect(probePdfSource(atTail, 'page.pdf', { maximumMarkerScanBytes: 48 }).kind)
      .toBe('pdf-compatible-ai');
  });

  it('creates a descriptor that references, rather than embeds, immutable original bytes', () => {
    const probe = probePdfSource(bytes('%PDF-2.0\n'), 'drawing.ai');
    if (!probe.importable) throw new Error('Fixture must be importable.');
    expect(createPdfSourceDescriptor(probe, {
      assetId: 'asset:original-ai', byteLength: 2048, fingerprintSha256: 'a'.repeat(64)
    })).toEqual({
      format: 'pdf-compatible-ai', originalAssetId: 'asset:original-ai', byteLength: 2048,
      fingerprintSha256: 'a'.repeat(64), pdfVersion: '2.0', nativeAiData: 'absent'
    });
  });
});
