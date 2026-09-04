import { Button, Dialog, Text } from '@lighttable/ui';
import React, { useEffect, useMemo, useState } from 'react';
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
  return (
    <Dialog open={Boolean(request && diagnostic)} title="Font unavailable"
      aria-label="Replace missing text font" onDismiss={onCancel}
      footer={<>
        <Button tabIndex={0} onClick={onCancel}>Cancel</Button>
        <Button tabIndex={0} onClick={onManage}>Manage</Button>
        <Button tabIndex={0} disabled={!assetId} onClick={() => onReplace(assetId)}>Replace</Button>
      </>}>
      {request && diagnostic ? <>
        <Text as="p" tone="muted">
          <strong>{diagnostic.layerName}</strong> uses a font that is not available. Its original
          Photoshop preview remains visible until you choose a replacement.
        </Text>
        <label>
          Replacement font
          <FontAssetPicker tabIndex={0} ariaLabel="Replacement font" value={assetId} fonts={sortedFonts}
            onChange={(nextAssetId) => { setAssetId(nextAssetId); onPreview(nextAssetId); }} />
        </label>
        <Text as="p" tone="muted">{metricsChanged
          ? `Metrics change: ${requestedMetrics?.weight}/${requestedMetrics?.stretch}%/${requestedMetrics?.fontStyle}`
            + ` → ${selectedFont?.weight}/${selectedFont?.stretch}%/${selectedFont?.italic ? 'italic' : 'normal'}.`
          : 'The original family, face and style request will be retained for future recovery.'}</Text>
      </> : null}
    </Dialog>
  );
};
