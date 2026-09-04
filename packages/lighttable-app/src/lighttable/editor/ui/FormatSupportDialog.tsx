import { Button, Dialog } from '@lighttable/ui';
import React from 'react';
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
  return (
    <Dialog open={open} size="wide" title="Format support"
      description="Current product capabilities. Subset never means full source-format parity."
      onDismiss={onClose} footer={<Button tabIndex={0} onClick={onClose}>Close</Button>}>
      <div className="lighttable-format-support__content">
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
      </div>
    </Dialog>
  );
};
