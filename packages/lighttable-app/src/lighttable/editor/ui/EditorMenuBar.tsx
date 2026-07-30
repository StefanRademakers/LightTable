import { useEffect, useState } from 'react';
import {
  ContextMenu,
  type ContextMenuOption
} from '../../../ui/ContextMenu';
import type { EditorMenuId } from '../menus/createEditorMenuOptions';

interface OpenEditorMenu {
  readonly id: EditorMenuId;
  readonly x: number;
  readonly y: number;
}

export interface EditorMenuBarProps {
  readonly optionsFor: (
    id: EditorMenuId
  ) => Array<ContextMenuOption<string>>;
}

const MENU_ITEMS: ReadonlyArray<{
  id: EditorMenuId;
  label: string;
}> = [
  { id: 'file', label: 'File' },
  { id: 'edit', label: 'Edit' },
  { id: 'select', label: 'Select' },
  { id: 'layer', label: 'Layer' },
  { id: 'view', label: 'View' }
];

/**
 * Owns only menu presentation state. Menu capabilities and commands remain in
 * the active document composition, so switching documents cannot leave this
 * shell bound to a stale document.
 */
export const EditorMenuBar = ({
  optionsFor
}: EditorMenuBarProps) => {
  const [openMenu, setOpenMenu] = useState<OpenEditorMenu | null>(null);
  const options = openMenu ? optionsFor(openMenu.id) : [];

  useEffect(() => {
    if (!openMenu) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setOpenMenu(null);
    };
    window.addEventListener('keydown', closeOnEscape, true);
    return () => window.removeEventListener('keydown', closeOnEscape, true);
  }, [openMenu]);

  return (
    <>
      <div
        className="shots-app-menu lighttable__app-menu"
        role="menubar"
        aria-label="LightTable menu"
      >
        {MENU_ITEMS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            className={`shots-app-menu__button${openMenu?.id === id ? ' shots-app-menu__button--active' : ''}`}
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              setOpenMenu({ id, x: rect.left, y: rect.bottom + 6 });
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <ContextMenu
        open={Boolean(openMenu)}
        x={openMenu?.x ?? 0}
        y={openMenu?.y ?? 0}
        onClose={() => setOpenMenu(null)}
        options={options}
      />
    </>
  );
};
