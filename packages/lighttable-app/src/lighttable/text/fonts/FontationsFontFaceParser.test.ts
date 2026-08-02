import { describe, expect, it, vi } from 'vitest';
import type { DocumentFontAsset } from '../../editor/document/documentTypes';
import type { TextEngineClient } from '../wasm/TextEngineClient';
import { FontationsFontFaceParser } from './FontationsFontFaceParser';

const asset = (): DocumentFontAsset => ({
  assetId: 'font',
  faceIndex: 0,
  fingerprintSha256: 'a'.repeat(64),
  source: 'document',
  container: 'sfnt',
  outline: 'cff',
  embedding: { level: 'editable', noSubsetting: false, bitmapOnly: false },
  familyNames: ['Fixture'],
  styleName: 'Regular',
  weight: 400,
  stretch: 100,
  italic: false,
  byteLength: 4
});

describe('FontationsFontFaceParser', () => {
  it('maps worker inspection metadata and rejects descriptor mismatches', async () => {
    const client = {
      inspectFont: vi.fn(async () => ({
        glyphCount: 120,
        unitsPerEm: 1_000,
        axisCount: 0,
        outline: 'cff' as const,
        embeddingLevel: 'editable' as const,
        noSubsetting: false,
        bitmapOnly: false
      }))
    } as unknown as TextEngineClient;
    const parser = new FontationsFontFaceParser(client);

    await expect(parser.parse(new Uint8Array([0, 1, 0, 0]), asset())).resolves.toEqual({
      glyphCount: 120,
      unitsPerEm: 1_000
    });
    await expect(parser.parse(new Uint8Array([0, 1, 0, 0]), {
      ...asset(),
      outline: 'truetype'
    })).rejects.toThrow(/outline metadata/);
    await expect(parser.parse(new Uint8Array([0, 1, 0, 0]), {
      ...asset(),
      embedding: { level: 'editable', noSubsetting: true, bitmapOnly: false }
    })).rejects.toThrow(/embedding policy/);
  });
});
