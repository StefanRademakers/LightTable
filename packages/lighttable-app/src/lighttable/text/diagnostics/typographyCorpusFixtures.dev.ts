import antonUrl from '../../../../../../test/fixtures/fonts/Anton-Regular.ttf?url';
import sourceSerifUrl from '../../../../../../test/fixtures/fonts/SourceSerif4-Regular.otf?url';
import arabicUrl from '../../../../../../test/fixtures/fonts/NotoKufiArabic-Slice06.otf?url';
import hebrewUrl from '../../../../../../test/fixtures/fonts/NotoSansHebrew-Slice06.ttf?url';
import devanagariUrl from '../../../../../../test/fixtures/fonts/NotoSansDevanagari-Slice06.ttf?url';
import thaiUrl from '../../../../../../test/fixtures/fonts/NotoSansThai-Slice06.ttf?url';
import cjkUrl from '../../../../../../test/fixtures/fonts/NotoSansCJKjp-Slice06.otf?url';
import emojiUrl from '../../../../../../test/fixtures/fonts/NotoEmoji-Slice06.ttf?url';

const urls: Readonly<Record<string, string>> = {
  anton: antonUrl,
  'source-serif': sourceSerifUrl,
  arabic: arabicUrl,
  hebrew: hebrewUrl,
  devanagari: devanagariUrl,
  thai: thaiUrl,
  cjk: cjkUrl,
  emoji: emojiUrl
};
export const loadTypographyCorpusFixtureBytes = async (): Promise<ReadonlyMap<string, Uint8Array>> => {
  const entries = await Promise.all(Object.entries(urls).map(async ([id, url]) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Could not load ${id} typography fixture (${response.status}).`);
    return [id, new Uint8Array(await response.arrayBuffer())] as const;
  }));
  return new Map(entries);
};
