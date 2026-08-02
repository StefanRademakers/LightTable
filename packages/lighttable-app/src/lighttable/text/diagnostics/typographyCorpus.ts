import type { FontAssetRef } from '@lighttable/text-core';

export type TypographyScript =
  | 'latin' | 'arabic' | 'hebrew' | 'devanagari' | 'thai' | 'cjk'
  | 'combining' | 'emoji' | 'mixed-bidi';

export interface TypographyCorpusFont {
  readonly id: string;
  readonly family: string;
  readonly fileName: string;
  readonly asset: FontAssetRef;
}

export interface TypographyCorpusRun {
  readonly text: string;
  readonly fontId: string;
}

export interface TypographyCorpusCase {
  readonly id: TypographyScript;
  readonly label: string;
  readonly runs: readonly TypographyCorpusRun[];
  readonly expectedDirection?: 'ltr' | 'rtl';
}

const font = (
  id: string,
  family: string,
  fileName: string,
  fingerprintSha256: string,
  outline: FontAssetRef['outline'] = 'truetype'
): TypographyCorpusFont => ({
  id,
  family,
  fileName,
  asset: {
    assetId: `diagnostic.${id}`,
    faceIndex: 0,
    fingerprintSha256,
    source: 'bundled',
    container: 'sfnt',
    outline,
    postScriptName: family.replaceAll(' ', ''),
    embedding: { level: 'installable', noSubsetting: false, bitmapOnly: false }
  }
});

export const TYPOGRAPHY_CORPUS_FONTS: readonly TypographyCorpusFont[] = [
  font('anton', 'Anton', 'Anton-Regular.ttf', 'a4ba3a92350ebb031da0cb47630ac49eb265082ca1bc0450442f4a83ab947cab'),
  font('source-serif', 'Source Serif 4', 'SourceSerif4-Regular.otf', 'edf160d0d584deee8a3bb2c3371b2a7624ca63580fbe02c57c1f4c91e84d8787', 'cff'),
  font('arabic', 'Noto Kufi Arabic', 'NotoKufiArabic-Slice06.otf', '1012bab829f06e0fa5124ae5390fd7b83577d86bb8b5fe461801a5162491c14d', 'cff'),
  font('hebrew', 'Noto Sans Hebrew', 'NotoSansHebrew-Slice06.ttf', '26748f2d21d4a3aae5ac7f15b614252419bab4de1f40f0dfb06e0af7ef49a044'),
  font('devanagari', 'Noto Sans Devanagari', 'NotoSansDevanagari-Slice06.ttf', '8f85ebe78023ceee9baa55237929bbb5d19ee9ee87ba1045c3a1b761eb2f1752'),
  font('thai', 'Noto Sans Thai', 'NotoSansThai-Slice06.ttf', '5cbbdb5ecb6dccb6df47917671cf858321de4a44856f4a433141b9f4d7696e91'),
  font('cjk', 'Noto Sans CJK JP', 'NotoSansCJKjp-Slice06.otf', '654e1a6c16955d4b31e6e9d9bb76f4d091b7938b39c8bb7ccadb4a3b5517f104', 'cff'),
  font('emoji', 'Noto Emoji', 'NotoEmoji-Slice06.ttf', '0a5b5b9318c75fa69304062fc99dcf528db3997fbe360b47cb39e46c988d6c94')
] as const;
export const TYPOGRAPHY_CORPUS: readonly TypographyCorpusCase[] = [
  { id: 'latin', label: 'Latin ligatures', runs: [{ text: 'office Affinity', fontId: 'anton' }], expectedDirection: 'ltr' },
  { id: 'arabic', label: 'Arabic joining', runs: [{ text: 'مرحبا', fontId: 'arabic' }], expectedDirection: 'rtl' },
  { id: 'hebrew', label: 'Hebrew', runs: [{ text: 'שלום', fontId: 'hebrew' }], expectedDirection: 'rtl' },
  { id: 'devanagari', label: 'Devanagari conjuncts', runs: [{ text: 'नमस्ते', fontId: 'devanagari' }] },
  { id: 'thai', label: 'Thai marks', runs: [{ text: 'ภาษาไทย', fontId: 'thai' }] },
  { id: 'cjk', label: 'CJK', runs: [{ text: '日本語中文', fontId: 'cjk' }] },
  { id: 'combining', label: 'Combining marks', runs: [{ text: 'A\u0301', fontId: 'source-serif' }] },
  { id: 'emoji', label: 'Emoji UTF-16', runs: [{ text: '😀', fontId: 'emoji' }] },
  {
    id: 'mixed-bidi', label: 'Mixed bidi', expectedDirection: 'rtl',
    runs: [{ text: 'ABC ', fontId: 'anton' }, { text: 'שלום', fontId: 'hebrew' }]
  }
] as const;
