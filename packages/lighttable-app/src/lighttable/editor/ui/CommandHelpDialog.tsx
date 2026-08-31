import { Button, SearchField } from '@lighttable/ui';
import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import { useDialogAccessibility } from '../../../ui/useDialogAccessibility';

export const LIGHTTABLE_COMMAND_HELP = [
  ['New document', 'Ctrl+N', 'File'], ['Open', 'Ctrl+O', 'File'],
  ['Save', 'Ctrl+S', 'File'], ['Save as', 'Ctrl+Shift+S', 'File'],
  ['Quick export PNG', 'Ctrl+Alt+Shift+W', 'Export'], ['Export PSD', '', 'Export'],
  ['Undo', 'Ctrl+Z', 'Edit'], ['Redo', 'Ctrl+Shift+Z', 'Edit'],
  ['Copy', 'Ctrl+C', 'Edit'], ['Paste', 'Ctrl+V', 'Edit'],
  ['Transform', 'V', 'Tools'], ['Brush', 'B', 'Tools'], ['Text', 'T', 'Tools'],
  ['Rectangle', 'U', 'Tools'], ['Zoom', 'Z', 'Tools'], ['Hand', 'H / Space', 'Tools'],
  ['Fit on screen', 'Ctrl+0', 'View'], ['Actual pixels', 'Ctrl+1', 'View'],
  ['Show/hide extras', 'Ctrl+H', 'View'], ['Show/hide rulers', 'Ctrl+R', 'View'],
  ['Enable/disable snapping', 'Ctrl+Shift+;', 'View'],
  ['Bold text', 'Ctrl+B', 'Type'], ['Italic text', 'Ctrl+I', 'Type'],
  ['Move by word', 'Ctrl+Arrow', 'Type'], ['Select by word', 'Ctrl+Shift+Arrow', 'Type']
] as const;

export const CommandHelpDialog: React.FC<{
  readonly open: boolean;
  readonly onClose: () => void;
}> = ({ open, onClose }) => {
  const [query, setQuery] = useState('');
  const { dialogRef, onDialogKeyDown } = useDialogAccessibility<HTMLElement>(open, onClose);
  const commands = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return LIGHTTABLE_COMMAND_HELP.filter((parts) => !needle
      || parts.some((part) => part.toLocaleLowerCase().includes(needle)));
  }, [query]);
  if (!open) return null;
  return createPortal(
    <div className="lighttable-psd-report__backdrop" onMouseDown={onClose}>
      <section ref={dialogRef} className="lighttable-psd-report lighttable-command-help"
        role="dialog" aria-modal="true" aria-label="Commands and shortcuts" tabIndex={-1}
        data-editor-native-tab-navigation onKeyDown={onDialogKeyDown}
        onMouseDown={(event) => event.stopPropagation()}>
        <header className="lighttable-psd-report__header">
          <div><h2>Commands and shortcuts</h2><p>Photoshop-compatible shortcuts where they match LightTable actions.</p></div>
          <Button tabIndex={0} onClick={onClose}>Close</Button>
        </header>
        <SearchField tabIndex={0} autoFocus  value={query} aria-label="Search commands"
          placeholder="Search commands or shortcuts"
          onChange={(event) => setQuery(event.currentTarget.value)} />
        <div className="lighttable-command-help__list" role="list">
          {commands.map(([name, shortcut, group]) => (
            <div key={`${group}-${name}`} className="lighttable-command-help__row" role="listitem">
              <span><small>{group}</small>{name}</span><kbd>{shortcut || 'Menu'}</kbd>
            </div>
          ))}
          {commands.length === 0 ? <p className="lighttable-command-help__empty">No matching command.</p> : null}
        </div>
      </section>
    </div>, document.body
  );
};
