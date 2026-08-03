import {
  TEXT_RENDERER_BAKEOFF_LIMITS,
  TextRendererResourceLimitError,
  type CoverageAtlasEntry,
  type CoverageGlyphMask,
  type PackedCoverageAtlas
} from './contracts';

const assertMask = (mask: CoverageGlyphMask) => {
  if (!mask.key || mask.key.length > 1024) throw new TypeError('Coverage glyph key is invalid.');
  if (!Number.isInteger(mask.width) || !Number.isInteger(mask.height)
    || mask.width < 0 || mask.height < 0
    || mask.width > TEXT_RENDERER_BAKEOFF_LIMITS.maximumGlyphDimension
    || mask.height > TEXT_RENDERER_BAKEOFF_LIMITS.maximumGlyphDimension) {
    throw new TextRendererResourceLimitError('Coverage glyph dimensions exceed the bakeoff limit.');
  }
  if (mask.pixels.byteLength !== mask.width * mask.height) {
    throw new TypeError('Coverage glyph mask must contain one R8 byte per pixel.');
  }
  if (![mask.bearingX, mask.bearingY].every(Number.isFinite)) {
    throw new TypeError('Coverage glyph bearings must be finite.');
  }
};

export const packCoverageAtlas = (
  masks: readonly CoverageGlyphMask[],
  width = 1024,
  padding = 1
): PackedCoverageAtlas => {
  if (!Number.isInteger(width) || width <= 0 || width > TEXT_RENDERER_BAKEOFF_LIMITS.maximumAtlasDimension) {
    throw new TextRendererResourceLimitError('Coverage atlas width exceeds the bakeoff limit.');
  }
  if (!Number.isInteger(padding) || padding < 0 || padding > 8) throw new TypeError('Atlas padding must be in [0, 8].');
  if (masks.length > TEXT_RENDERER_BAKEOFF_LIMITS.maximumGlyphs) {
    throw new TextRendererResourceLimitError('Coverage atlas glyph count exceeds the bakeoff limit.');
  }
  const keys = new Set<string>();
  const placements: CoverageAtlasEntry[] = [];
  let cursorX = padding;
  let cursorY = padding;
  let rowHeight = 0;
  for (const mask of masks) {
    assertMask(mask);
    if (keys.has(mask.key)) throw new TypeError(`Duplicate coverage glyph key ${mask.key}.`);
    keys.add(mask.key);
    if (mask.width === 0 || mask.height === 0) {
      placements.push({
        key: mask.key, x: 0, y: 0, width: 0, height: 0,
        bearingX: mask.bearingX, bearingY: mask.bearingY
      });
      continue;
    }
    const paddedWidth = mask.width + padding * 2;
    const paddedHeight = mask.height + padding * 2;
    if (paddedWidth > width) throw new TextRendererResourceLimitError('Coverage glyph does not fit the atlas width.');
    if (cursorX + mask.width + padding > width) {
      cursorX = padding;
      cursorY += rowHeight;
      rowHeight = 0;
    }
    placements.push({
      key: mask.key,
      x: cursorX,
      y: cursorY,
      width: mask.width,
      height: mask.height,
      bearingX: mask.bearingX,
      bearingY: mask.bearingY
    });
    cursorX += paddedWidth;
    rowHeight = Math.max(rowHeight, paddedHeight);
  }
  const contentHeight = cursorY + rowHeight;
  const height = Math.max(1, Math.min(
    TEXT_RENDERER_BAKEOFF_LIMITS.maximumAtlasDimension,
    2 ** Math.ceil(Math.log2(Math.max(1, contentHeight)))
  ));
  const byteLength = width * height;
  if (contentHeight > height || byteLength > TEXT_RENDERER_BAKEOFF_LIMITS.maximumAtlasBytes) {
    throw new TextRendererResourceLimitError('Coverage atlas exceeds the byte or dimension limit.');
  }
  const pixels = new Uint8Array(byteLength);
  placements.forEach((entry, index) => {
    const mask = masks[index];
    for (let row = 0; row < entry.height; row += 1) {
      pixels.set(
        mask.pixels.subarray(row * entry.width, (row + 1) * entry.width),
        (entry.y + row) * width + entry.x
      );
    }
  });
  return {
    width,
    height,
    pixels,
    entries: placements,
    occupiedBytes: masks.reduce((sum, mask) => sum + mask.pixels.byteLength, 0)
  };
};
