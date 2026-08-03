import type { FontAssetRef } from '@lighttable/text-core';
import antonUrl from '../../../../../../test/fixtures/fonts/Anton-Regular.ttf?url';

const font = Object.freeze<FontAssetRef>({
  assetId: 'development.canvas-text-fixture.anton',
  faceIndex: 0,
  fingerprintSha256: 'a4ba3a92350ebb031da0cb47630ac49eb265082ca1bc0450442f4a83ab947cab',
  source: 'bundled',
  container: 'sfnt',
  outline: 'truetype',
  postScriptName: 'Anton-Regular',
  embedding: { level: 'installable', noSubsetting: false, bitmapOnly: false }
});

export const loadDevelopmentTextCanvasFixture = async () => {
  const response = await fetch(antonUrl);
  if (!response.ok) throw new Error(`Could not load canvas text fixture (${response.status}).`);
  return {
    family: 'Anton',
    font,
    bytes: new Uint8Array(await response.arrayBuffer())
  } as const;
};
