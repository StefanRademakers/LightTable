import { ButtonBase } from '../../../ui/ButtonBase';
import { useEffect, useRef, useState } from 'react';
import {
  ContextMenu,
  type ContextMenuOption
} from '../../../ui/ContextMenu';
import type { EditorMenuId } from '../menus/createEditorMenuOptions';
import { lightTableIcon } from '../../../assets/icons';

interface OpenEditorMenu {
  readonly id: EditorMenuId;
  readonly x: number;
  readonly y: number;
}

export interface EditorMenuBarProps {
  readonly optionsFor: (
    id: EditorMenuId
  ) => Array<ContextMenuOption<string>>;
  readonly projectName?: string;
  readonly onRevealProject?: () => void;
  readonly enabledFor?: (id: EditorMenuId) => boolean;
}

const MENU_ITEMS: ReadonlyArray<{
  id: EditorMenuId;
  label: string;
}> = [
  { id: 'file', label: 'File' },
  { id: 'edit', label: 'Edit' },
  { id: 'image', label: 'Image' },
  { id: 'layer', label: 'Layer' },
  { id: 'type', label: 'Type' },
  { id: 'select', label: 'Select' },
  { id: 'filter', label: 'Filter' },
  { id: 'ai', label: 'AI' },
  { id: 'view', label: 'View' },
  { id: 'help', label: 'Help' }
];

/**
 * Owns only menu presentation state. Menu capabilities and commands remain in
 * the active document composition, so switching documents cannot leave this
 * shell bound to a stale document.
 */
export const EditorMenuBar = ({
  optionsFor,
  projectName,
  onRevealProject,
  enabledFor = () => true
}: EditorMenuBarProps) => {
  const [openMenu, setOpenMenu] = useState<OpenEditorMenu | null>(null);
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const options = openMenu ? optionsFor(openMenu.id) : [];
  const openFromButton = (id: EditorMenuId, button: HTMLButtonElement) => {
    const rect = button.getBoundingClientRect();
    setOpenMenu({ id, x: rect.left, y: rect.bottom });
  };

  useEffect(() => {
    if (!openMenu) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setOpenMenu(null);
      const index = MENU_ITEMS.findIndex(({ id }) => id === openMenu.id);
      window.requestAnimationFrame(() => buttonRefs.current[index]?.focus());
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
        <span className="lighttable__window-icon" aria-hidden="true" />
        {MENU_ITEMS.map(({ id, label }, index) => (
          <ButtonBase
            key={id}
            ref={(node) => { buttonRefs.current[index] = node; }}
            type="button"
            role="menuitem"
            disabled={!enabledFor(id)}
            className={`shots-app-menu__button${openMenu?.id === id ? ' shots-app-menu__button--active' : ''}`}
            aria-haspopup="menu"
            aria-expanded={openMenu?.id === id}
            onClick={(event) => {
              openFromButton(id, event.currentTarget);
            }}
            onPointerEnter={(event) => {
              if (openMenu && openMenu.id !== id) openFromButton(id, event.currentTarget);
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                openFromButton(id, event.currentTarget);
                return;
              }
              if (event.key === 'Escape') {
                setOpenMenu(null);
                return;
              }
              if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home' && event.key !== 'End') return;
              event.preventDefault();
              const next = event.key === 'Home' ? 0
                : event.key === 'End' ? MENU_ITEMS.length - 1
                  : (index + (event.key === 'ArrowRight' ? 1 : -1) + MENU_ITEMS.length) % MENU_ITEMS.length;
              buttonRefs.current[next]?.focus();
              if (openMenu) {
                const nextItem = MENU_ITEMS[next];
                const nextButton = buttonRefs.current[next];
                if (nextItem && nextButton) openFromButton(nextItem.id, nextButton);
              }
            }}
          >
            {label}
          </ButtonBase>
        ))}
        {projectName ? (
          <ButtonBase type="button" className="lighttable__project-name"
            title={`Open project folder: ${projectName}`}
            aria-label={`Open project folder for ${projectName}`}
            onClick={onRevealProject}>
            <img src={lightTableIcon('folder.png')} alt="" aria-hidden />
            <span>{projectName}</span>
          </ButtonBase>
        ) : null}
      </div>
      <ContextMenu
        open={Boolean(openMenu)}
        x={openMenu?.x ?? 0}
        y={openMenu?.y ?? 0}
        onClose={() => setOpenMenu(null)}
        options={options}
        className="lighttable-editor-menu"
        backdropTop={openMenu?.y}
      />
    </>
  );
};
