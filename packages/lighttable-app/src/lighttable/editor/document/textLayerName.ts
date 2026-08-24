import type { TextLayerData } from '@lighttable/text-core';

const TEXT_LAYER_NAME_LIMIT = 40;

/** Photoshop-style semantic layer name derived from the visible text. */
export const textLayerNameFromContent = (
  text: string,
  fallback = 'Text'
): string => {
  const normalized = text.replace(/\s+/gu, ' ').trim();
  if (!normalized) return fallback;
  return [...normalized].slice(0, TEXT_LAYER_NAME_LIMIT).join('');
};

export const textLayerNameFromData = (text: TextLayerData): string => {
  if (text.source.kind === 'flow') return textLayerNameFromContent(text.source.text);
  const content = text.source.extractedText
    ?? text.source.runs.flatMap((run) => run.glyphs.map((glyph) => glyph.unicode ?? '')).join('');
  return textLayerNameFromContent(content);
};

/**
 * Auto-naming remains active only while the current name still represents the
 * previous text. A deliberate user/API rename must survive later text edits.
 */
export const nextAutomaticTextLayerName = (
  currentName: string,
  previousText: string,
  nextText: string
): string => (
  currentName === 'Text'
  || currentName === 'Path Text'
  || currentName === textLayerNameFromContent(previousText)
)
  ? textLayerNameFromContent(nextText)
  : currentName;
