import type { Rect } from '../../editor/document/documentTypes';

export interface ClipboardImageSize {
  readonly width: number;
  readonly height: number;
}

/**
 * Normal Paste preserves the clipboard's pixel dimensions. A selection is a
 * positioning hint, never a scale or clipping request.
 */
export const centerClipboardBounds = (
  size: ClipboardImageSize,
  target: Rect
): Rect => ({
  x: Math.round(target.x + (target.width - size.width) / 2),
  y: Math.round(target.y + (target.height - size.height) / 2),
  width: size.width,
  height: size.height
});

/** Returns the document-space portion currently visible inside the viewport. */
export const visibleDocumentBounds = (
  documentSize: ClipboardImageSize,
  viewportSize: ClipboardImageSize,
  imageRect: Rect
): Rect => {
  if (imageRect.width <= 0 || imageRect.height <= 0) {
    return { x: 0, y: 0, ...documentSize };
  }
  const left = Math.max(0, imageRect.x);
  const top = Math.max(0, imageRect.y);
  const right = Math.min(viewportSize.width, imageRect.x + imageRect.width);
  const bottom = Math.min(viewportSize.height, imageRect.y + imageRect.height);
  if (right <= left || bottom <= top) return { x: 0, y: 0, ...documentSize };
  const scaleX = documentSize.width / imageRect.width;
  const scaleY = documentSize.height / imageRect.height;
  return {
    x: (left - imageRect.x) * scaleX,
    y: (top - imageRect.y) * scaleY,
    width: (right - left) * scaleX,
    height: (bottom - top) * scaleY
  };
};
