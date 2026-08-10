import React from 'react';
import { createPortal } from 'react-dom';
import { ActionButton } from '../../../ui/ActionButton';
import { LIGHTTABLE_PRODUCT_DISCLOSURES } from '../../application/compliance/thirdPartyDisclosures.generated';
import { useDialogAccessibility } from '../../../ui/useDialogAccessibility';

export const ThirdPartyLicensesDialog: React.FC<{
  readonly open: boolean;
  readonly onClose: () => void;
  readonly includeDesktopRuntime?: boolean;
}> = ({ open, onClose, includeDesktopRuntime = false }) => {
  const { dialogRef, onDialogKeyDown } = useDialogAccessibility<HTMLElement>(open, onClose);
  if (!open) return null;
  const disclosures = LIGHTTABLE_PRODUCT_DISCLOSURES.filter(({ platform }) =>
    platform === 'all' || includeDesktopRuntime);
  const categories = [...new Set(disclosures.map(({ category }) => category))];

  return createPortal(
    <div className="lighttable-psd-report__backdrop" onMouseDown={onClose}>
      <section
        ref={dialogRef}
        className="lighttable-psd-report lighttable-third-party-licenses"
        role="dialog"
        aria-modal="true"
        aria-label="Third-party licenses"
        tabIndex={-1}
        data-editor-native-tab-navigation
        onKeyDown={onDialogKeyDown}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="lighttable-psd-report__header">
          <div>
            <h2>Third-party licenses</h2>
            <p>Key libraries, runtimes, fonts and assets included with LightTable.</p>
          </div>
          <ActionButton onClick={onClose}>Close</ActionButton>
        </header>
        <p className="lighttable-third-party-licenses__ownership">
          LightTable is proprietary software. The components listed here remain under their own licenses.
        </p>
        <div className="lighttable-third-party-licenses__groups">
          {categories.map((category) => (
            <section className="lighttable-third-party-licenses__group" key={category}>
              <h3>{category}</h3>
              <div role="list">
                {disclosures
                  .filter((entry) => entry.category === category)
                  .map((entry) => (
                    <div className="lighttable-third-party-licenses__row" role="listitem" key={`${entry.name}-${entry.version}`}>
                      <div>
                        <strong>{entry.name}</strong>
                        <p>{entry.description}</p>
                      </div>
                      <span>{entry.version}</span>
                      <span>{entry.license}</span>
                    </div>
                  ))}
              </div>
            </section>
          ))}
        </div>
      </section>
    </div>,
    document.body
  );
};
