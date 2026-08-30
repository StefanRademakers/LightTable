export interface MenuBounds { left: number; right: number; top: number; bottom: number }
export interface MenuPosition { left: number; top: number; maxHeight: number }

/** Measure intrinsic content before showing; use the viewport, not a dock's bounds. */
export function menuPosition(
  anchor: MenuBounds,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  placement: 'auto' | 'above' | 'below' | 'submenu' = 'auto',
  align: 'start' | 'end' = 'start',
  topInset = 8,
  gap = 0
): MenuPosition {
  const margin = 8;
  const maxHeight = Math.max(0, viewport.height - topInset - margin);
  const height = Math.min(size.height, maxHeight);
  const above = anchor.top - topInset - gap;
  const below = viewport.height - anchor.bottom - margin - gap;
  let left = align === 'end' ? anchor.right - size.width : anchor.left;
  let top = placement === 'above' || (placement === 'auto' && below < size.height && above > below)
    ? anchor.top - gap - height : anchor.bottom + gap;
  if (placement === 'submenu') {
    left = anchor.right + 2 + size.width <= viewport.width - margin
      ? anchor.right + 2 : anchor.left - size.width - 2;
    top = anchor.top - 6;
  }
  return {
    left: Math.max(margin, Math.min(left, viewport.width - size.width - margin)),
    top: Math.max(topInset, Math.min(top, viewport.height - height - margin)),
    maxHeight
  };
}
