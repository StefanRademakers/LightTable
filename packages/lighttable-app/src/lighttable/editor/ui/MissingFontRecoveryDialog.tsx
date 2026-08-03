import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ActionButton } from '../../../ui/ActionButton';
import type { DocumentFontAsset } from '../document/documentTypes';
import type { TextFontDiagnostic } from '../../text/fonts/textLayerFontStatus';
import type { MissingFontRecoveryRequest } from './useEditorDialogController';

export interface MissingFontRecoveryDialogProps {
  readonly request: MissingFontRecoveryRequest | null;
  readonly diagnostic: TextFontDiagnostic | null;
  readonly fonts: readonly DocumentFontAsset[];
  readonly onCancel: () => void;
  readonly onManage: () => void;
  readonly onReplace: (assetId: string) => void;
}

const fontLabel = (font: DocumentFontAsset) => {
  const family = font.familyNames[0] ?? font.postScriptName ?? 'Unknown';
  return `${family} — ${font.styleName}`;
};

export const MissingFontRecoveryDialog: React.FC<MissingFontRecoveryDialogProps> = ({
  request, diagnostic, fonts, onCancel, onManage, onReplace
}) => {
  const sortedFonts = useMemo(() => [...fonts].sort((left, right) =>
    fontLabel(left).localeCompare(fontLabel(right))), [fonts]);
  const [assetId, setAssetId] = useState('');
  useEffect(() => {
    if (request) setAssetId(sortedFonts[0]?.assetId ?? '');
  }, [request, sortedFonts]);
  if (!request || !diagnostic) return null;

  return createPortal(
    <div className="modal-backdrop modal-backdrop--confirm lighttable-dialog-backdrop">
      <section
        className="modal text-input-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Replace missing text font"
      >
        <div className="modal__header"><h3 className="modal__title">Font unavailable</h3></div>
        <p className="muted">
          <strong>{diagnostic.layerName}</strong> uses a font that is not available. Its original
          Photoshop preview remains visible until you choose a replacement.
        </p>
        <label>
          Replacement font
          <select
            aria-label="Replacement font"
            value={assetId}
            onChange={(event) => setAssetId(event.currentTarget.value)}
          >
            {sortedFonts.map((font) => (
              <option key={font.assetId} value={font.assetId}>{fontLabel(font)}</option>
            ))}
          </select>
        </label>
        <div className="modal__footer">
          <ActionButton onClick={onCancel}>Cancel</ActionButton>
          <ActionButton onClick={onManage}>Manage</ActionButton>
          <ActionButton disabled={!assetId} onClick={() => onReplace(assetId)}>Replace</ActionButton>
        </div>
      </section>
    </div>,
    document.body
  );
};
