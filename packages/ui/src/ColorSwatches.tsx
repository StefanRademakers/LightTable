import React from 'react';
import { IconButton } from './IconButton';
import { Menu } from './Menu';

export interface ColorSwatch { color: string; title?: string }
export interface ColorSwatchesProps {
  colors: readonly ColorSwatch[];
  label?: string;
  onSelect: (color: string) => void;
  onAdd?: () => void;
  onRemove?: (color: string) => void;
  tabIndex?: number;
}
export function ColorSwatches({ colors, label = 'Palette', onSelect, onAdd, onRemove, tabIndex = -1 }: ColorSwatchesProps) {
  const [menu, setMenu] = React.useState<{ color: string; x: number; y: number }>();
  return <div className="ui-color-swatches" data-ui-component="color-swatches" role="group" aria-label={label}>
    {colors.map(({ color, title }, index) => <button key={`${index}:${color}`} type="button" tabIndex={tabIndex}
      className="ui-color-swatches__swatch" style={{ backgroundColor: color }} title={title ?? color}
      aria-label={`Use ${label.toLowerCase()} color ${color}`} onClick={() => onSelect(color)}
      onContextMenu={onRemove ? event => {
        event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect();
        setMenu({ color, x: event.clientX || rect.left, y: event.clientY || rect.bottom });
      } : undefined} />)}
    {onAdd && <IconButton icon="+" aria-label="Add current color to palette" tabIndex={tabIndex} onClick={onAdd} />}
    <Menu<'remove'> open={Boolean(menu && onRemove)} x={menu?.x ?? 0} y={menu?.y ?? 0}
      onClose={() => setMenu(undefined)} options={menu && onRemove ? [{ value: 'remove', label: 'Remove',
        onClick: () => onRemove(menu.color) }] : []} />
  </div>;
}
