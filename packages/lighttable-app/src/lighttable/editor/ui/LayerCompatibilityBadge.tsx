import { ButtonBase } from '../../../ui/ButtonBase';
import React from 'react';
import type { DocumentCapabilityFinding } from '../compatibility/documentCapabilityFindings';

export const LayerCompatibilityBadge: React.FC<{
  finding: DocumentCapabilityFinding;
  onOpen?(): void;
}> = ({ finding, onOpen }) => (
  <ButtonBase type="button"
    className={`lighttable-layer__compatibility lighttable-layer__compatibility--${finding.severity}`}
    aria-label={`${finding.status}. Open document compatibility report`}
    title={`${finding.message} Open document compatibility report.`}
    onClick={(event) => {
      event.preventDefault(); event.stopPropagation(); onOpen?.();
    }}>
    {finding.status === 'preview-backed' ? 'Preview'
      : finding.status === 'approximated' ? 'Approx.'
        : finding.status === 'missing-asset' ? 'Missing' : 'Export'}
  </ButtonBase>
);
