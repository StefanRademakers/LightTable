import { Button } from '@lighttable/ui';
import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import { useDialogAccessibility } from '../../../ui/useDialogAccessibility';
import type { DocumentFontAsset } from '../document/documentTypes';
import type { TextFontDiagnostic } from '../../text/fonts/textLayerFontStatus';
import { textFontSourceMetrics } from '../../text/fonts/textLayerFontStatus';
import type { MissingFontRecoveryRequest } from './useEditorDialogController';
import { FontAssetPicker } from './FontAssetPicker';

export interface MissingFontRecoveryDialogProps {
  readonly request: MissingFontRecoveryRequest | null;
  readonly diagnostic: TextFontDiagnostic | null;
  readonly fonts: readonly DocumentFontAsset[];
  readonly onCancel: () => void;
  readonly onManage: () => void;
  readonly onPreview: (assetId: string) => void;
  readonly onReplace: (assetId: string) => void;
}

const fontLabel = (font: DocumentFontAsset) => {
  const family = font.familyNames[0] ?? font.postScriptName ?? 'Unknown';
  return `${family} — ${font.styleName}`;
};

export const MissingFontRecoveryDialog: React.FC<MissingFontRecoveryDialogProps> = ({
  request, diagnostic, fonts, onCancel, onManage, onPreview, onReplace
}) => {
  const { dialogRef, onDialogKeyDown } = useDialogAccessibility<HTMLElement>(Boolean(request && diagnostic), onCancel);
  const sortedFonts = useMemo(() => [...fonts].sort((left, right) =>
    fontLabel(left).localeCompare(fontLabel(right))), [fonts]);
  const [assetId, setAssetId] = useState('');
  const selectedFont = sortedFonts.find((font) => font.assetId === assetId);
  const requestedMetrics = textFontSourceMetrics(diagnostic?.sourceIdentity ?? null);
  const metricsChanged = Boolean(selectedFont && requestedMetrics && (
    selectedFont.weight !== requestedMetrics.weight
    || selectedFont.stretch !== requestedMetrics.stretch
    || selectedFont.italic !== (requestedMetrics.fontStyle !== 'normal')
  ));
  useEffect(() => {
    if (request) setAssetId(sortedFonts[0]?.assetId ?? '');
  }, [request, sortedFonts]);
  if (!request || !diagnostic) return null;

  return createPortal(
    <div className="modal-backdrop modal-backdrop--confirm lighttable-dialog-backdrop">
      <section
        ref={dialogRef}
        className="modal text-input-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Replace missing text font"
        tabIndex={-1}
        data-editor-native-tab-navigation
        onKeyDown={onDialogKeyDown}
      >
        <div className="modal__header"><h3 className="modal__title">Font unavailable</h3></div>
        <p className="muted">
          <strong>{diagnostic.layerName}</strong> uses a font that is not available. Its original
          Photoshop preview remains visible until you choose a replacement.
        </p>
        <label>
          Replacement font
          <FontAssetPicker ariaLabel="Replacement font" value={assetId} fonts={sortedFonts}
            onChange={(nextAssetId) => { setAssetId(nextAssetId); onPreview(nextAssetId); }} />
        </label>
        <p className="muted">{metricsChanged
          ? `Metrics change: ${requestedMetrics?.weight}/${requestedMetrics?.stretch}%/${requestedMetrics?.fontStyle}`
            + ` → ${selectedFont?.weight}/${selectedFont?.stretch}%/${selectedFont?.italic ? 'italic' : 'normal'}.`
          : 'The original family, face and style request will be retained for future recovery.'}</p>
        <div className="modal__footer">
          <Button tabIndex={0} data-ui-theme="dark" onClick={onCancel}>Cancel</Button>
          <Button tabIndex={0} data-ui-theme="dark" onClick={onManage}>Manage</Button>
          <Button tabIndex={0} data-ui-theme="dark" disabled={!assetId} onClick={() => onReplace(assetId)}>Replace</Button>
        </div>
      </section>
    </div>,
    document.body
  );
};
