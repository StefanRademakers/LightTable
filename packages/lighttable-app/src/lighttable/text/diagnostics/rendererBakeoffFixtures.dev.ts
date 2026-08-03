import antonBundleUrl from '../../../../../../test/fixtures/text-renderer/hb-gpu/anton.lt-hbgpu?url';
import sourceSerifBundleUrl from '../../../../../../test/fixtures/text-renderer/hb-gpu/source-serif.lt-hbgpu?url';
import arabicBundleUrl from '../../../../../../test/fixtures/text-renderer/hb-gpu/arabic.lt-hbgpu?url';
import hebrewBundleUrl from '../../../../../../test/fixtures/text-renderer/hb-gpu/hebrew.lt-hbgpu?url';
import devanagariBundleUrl from '../../../../../../test/fixtures/text-renderer/hb-gpu/devanagari.lt-hbgpu?url';
import thaiBundleUrl from '../../../../../../test/fixtures/text-renderer/hb-gpu/thai.lt-hbgpu?url';
import cjkBundleUrl from '../../../../../../test/fixtures/text-renderer/hb-gpu/cjk.lt-hbgpu?url';
import emojiBundleUrl from '../../../../../../test/fixtures/text-renderer/hb-gpu/emoji.lt-hbgpu?url';
import { loadTypographyCorpusFixtureBytes } from './typographyCorpusFixtures.dev';

const bundleUrls: Readonly<Record<string, string>> = {
  anton: antonBundleUrl,
  'source-serif': sourceSerifBundleUrl,
  arabic: arabicBundleUrl,
  hebrew: hebrewBundleUrl,
  devanagari: devanagariBundleUrl,
  thai: thaiBundleUrl,
  cjk: cjkBundleUrl,
  emoji: emojiBundleUrl
};

export const loadRendererBakeoffFixtures = async () => {
  const bundles = await Promise.all(Object.entries(bundleUrls).map(async ([id, url]) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Could not load ${id} hb-gpu bundle (${response.status}).`);
    return [id, new Uint8Array(await response.arrayBuffer())] as const;
  }));
  return { fonts: await loadTypographyCorpusFixtureBytes(), hbGpuBundles: new Map(bundles) };
};
