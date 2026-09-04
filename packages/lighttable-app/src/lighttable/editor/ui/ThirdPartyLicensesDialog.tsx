import { Button, Dialog } from '@lighttable/ui';
import React from 'react';

import { LIGHTTABLE_PRODUCT_DISCLOSURES } from '../../application/compliance/thirdPartyDisclosures.generated';

export const ThirdPartyLicensesDialog: React.FC<{
  readonly open: boolean;
  readonly onClose: () => void;
  readonly includeDesktopRuntime?: boolean;
}> = ({ open, onClose, includeDesktopRuntime = false }) => {
  const disclosures = LIGHTTABLE_PRODUCT_DISCLOSURES.filter(({ platform }) =>
    platform === 'all' || includeDesktopRuntime);
  const categories = [...new Set(disclosures.map(({ category }) => category))];

  return (
    <Dialog open={open} size="wide" title="Third-party licenses"
      description="Key libraries, runtimes, fonts and assets included with LightTable."
      onDismiss={onClose} footer={<Button tabIndex={0} onClick={onClose}>Close</Button>}>
      <div className="lighttable-third-party-licenses__content">
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
      </div>
    </Dialog>
  );
};
