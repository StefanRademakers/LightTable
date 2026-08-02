import { describe, expect, it } from 'vitest';
import type { DocumentFontAsset } from '../../editor/document/documentTypes';
import {
  DocumentFontRegistry,
  fingerprintFontBytes
} from '../../text/fonts/DocumentFontRegistry';
import { hydrateDocumentFonts } from './hydrateDocumentFonts';

describe('hydrateDocumentFonts', () => {
  it('restores every face sharing one collection binary', async () => {
    const bytes = new Uint8Array([0, 1, 0, 0]);
    const fingerprintSha256 = await fingerprintFontBytes(bytes);
    const face: DocumentFontAsset = {
      assetId: 'face-0', faceIndex: 0, fingerprintSha256, source: 'document',
      container: 'sfnt', outline: 'truetype',
      embedding: { level: 'editable', noSubsetting: false, bitmapOnly: false },
      familyNames: ['Collection'], styleName: 'Regular', weight: 400,
      stretch: 100, italic: false, byteLength: bytes.byteLength
    };
    const registry = new DocumentFontRegistry({
      parser: { parse: async () => ({ glyphCount: 1, unitsPerEm: 1_000 }) }
    });

    await hydrateDocumentFonts(
      registry,
      [{ fingerprintSha256, source: new Blob([bytes]) }],
      [face, { ...face, assetId: 'face-1', faceIndex: 1, styleName: 'Bold', weight: 700 }]
    );

    expect(registry.assets.map(({ assetId }) => assetId)).toEqual(['face-0', 'face-1']);
    expect(registry.availableAssets).toHaveLength(2);
    registry.dispose();
  });
});
