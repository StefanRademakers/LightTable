import React from 'react';
import { createPortal } from 'react-dom';
import { ActionButton } from '../../../ui/ActionButton';
import { useDialogAccessibility } from '../../../ui/useDialogAccessibility';
import {
  LIGHTTABLE_FORMAT_CAPABILITIES,
  type FormatSupportLevel
} from '../../application/formats/formatCapabilities';

const supportLabel = (level: FormatSupportLevel) => ({
  supported: 'Yes', partial: 'Subset', unavailable: 'No'
})[level];

export const FormatSupportDialog: React.FC<{
  readonly open: boolean;
  readonly onClose: () => void;
}> = ({ open, onClose }) => {
  const { dialogRef, onDialogKeyDown } = useDialogAccessibility<HTMLElement>(open, onClose);
  if (!open) return null;
  return createPortal(
    <div className="lighttable-psd-report__backdrop" onMouseDown={onClose}>
      <section
        ref={dialogRef}
        className="lighttable-psd-report lighttable-format-support"
        role="dialog"
        aria-modal="true"
        aria-label="Format support"
        tabIndex={-1}
        data-editor-native-tab-navigation
        onKeyDown={onDialogKeyDown}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="lighttable-psd-report__header">
          <div>
            <h2>Format support</h2>
            <p>Current product capabilities. Subset never means full source-format parity.</p>
          </div>
          <ActionButton onClick={onClose}>Close</ActionButton>
        </header>
        <div className="lighttable-format-support__table" role="table">
          <div className="lighttable-format-support__row lighttable-format-support__row--header" role="row">
            <span>Format</span><span>Open</span><span>Editable</span><span>Export</span>
          </div>
          {LIGHTTABLE_FORMAT_CAPABILITIES.map((format) => (
            <div className="lighttable-format-support__entry" key={format.id}>
              <div className="lighttable-format-support__row" role="row">
                <strong>{format.label}<small>{format.extensions.join(', ')}</small></strong>
                {[format.open, format.editable, format.export].map((level, index) => (
                  <span className={`lighttable-format-support__level lighttable-format-support__level--${level}`} key={index}>
                    {supportLabel(level)}
                  </span>
                ))}
              </div>
              <p>{format.summary}</p>
            </div>
          ))}
        </div>
      </section>
    </div>,
    document.body
  );
};
