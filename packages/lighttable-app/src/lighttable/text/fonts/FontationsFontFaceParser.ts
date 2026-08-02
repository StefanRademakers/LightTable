import type { FontFaceParser, ParsedFontFace } from './DocumentFontRegistry';
import { lightTableTextEngine, type TextEngineClient } from '../wasm/TextEngineClient';

/** Uses the persistent Rust/Fontations worker; no DOM or Node font API required. */
export class FontationsFontFaceParser implements FontFaceParser {
  constructor(private readonly client: TextEngineClient = lightTableTextEngine) {}

  async parse(bytes: Uint8Array, asset: Parameters<FontFaceParser['parse']>[1]): Promise<ParsedFontFace> {
    const inspection = await this.client.inspectFont(bytes, asset.faceIndex);
    if (asset.outline !== 'unknown' && inspection.outline !== asset.outline) {
      throw new Error(`Font ${asset.assetId} outline metadata does not match its bytes.`);
    }
    if (
      asset.embedding.level !== 'unknown'
      && inspection.embeddingLevel !== asset.embedding.level
    ) throw new Error(`Font ${asset.assetId} embedding metadata does not match its bytes.`);
    if (
      inspection.noSubsetting !== asset.embedding.noSubsetting
      || inspection.bitmapOnly !== asset.embedding.bitmapOnly
    ) throw new Error(`Font ${asset.assetId} embedding policy does not match its bytes.`);
    return {
      glyphCount: inspection.glyphCount,
      unitsPerEm: inspection.unitsPerEm
    };
  }
}
