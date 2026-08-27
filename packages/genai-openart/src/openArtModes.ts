/** OpenArt mode names are transport vocabulary; the rest of LightTable uses stable semantic modes. */
const OPENART_TO_CANONICAL_MODE: Readonly<Record<string, string>> = {
  text2image: 'text2image',
  image2image: 'image2image',
  text2video: 'text2video',
  image2video: 'frames2video',
  element2video: 'references2video'
};

const CANONICAL_TO_OPENART_MODE: Readonly<Record<string, string>> = {
  text2image: 'text2image',
  image2image: 'image2image',
  text2video: 'text2video',
  frames2video: 'image2video',
  references2video: 'element2video'
};

export const canonicalOpenArtMode = (mode: string): string => OPENART_TO_CANONICAL_MODE[mode] ?? mode;

export const providerOpenArtMode = (mode: string): string => CANONICAL_TO_OPENART_MODE[mode] ?? mode;

