import React from 'react';
import type { DocumentFontAsset } from '../document/documentTypes';
import type { TextPropertyPresentation } from '../../application/text/textPropertyPresentation';
import { MixedNumberInput } from '../ui/MixedNumberInput';

export interface TextPropertiesPanelProps {
  readonly model: TextPropertyPresentation;
  readonly fonts: readonly DocumentFontAsset[];
  readonly onFontAsset: (assetId: string) => void;
  readonly onSize: (size: number) => void;
  readonly onFill: (fill: string) => void;
  readonly onTracking: (tracking: number) => void;
  readonly onBegin: () => void;
  readonly onCommit: () => void;
  readonly onCancel: () => void;
}

const mixedOption = <option value="" disabled>Mixed</option>;

export const TextPropertiesPanel: React.FC<TextPropertiesPanelProps> = ({
  model, fonts, onFontAsset, onSize, onFill, onTracking, onBegin, onCommit, onCancel
}) => {
  const family = model.family.kind === 'value' ? model.family.value : '';
  const faces = fonts.filter((font) => font.familyNames.includes(family));
  const selectedFace = model.face.kind === 'value' ? model.face.value : '';
  const applyFamily = (nextFamily: string) => {
    const candidates = fonts.filter((font) => font.familyNames.includes(nextFamily));
    const asset = candidates.find((font) => font.styleName === 'Regular') ?? candidates[0];
    if (asset) onFontAsset(asset.assetId);
  };
  return (
    <div className="lighttable-text-properties" aria-label="Text properties">
      <header>
        <strong>Text</strong>
        <span>{model.target === 'selection' ? 'Selection' : model.target === 'insertion' ? 'Insertion point' : 'Layer'}</span>
      </header>
      <section className="lighttable-text-properties__group">
        <h3>Character</h3>
        <label><span>Family</span><select value={family} disabled={model.family.kind === 'unavailable'}
          onChange={(event) => applyFamily(event.currentTarget.value)}>
          {model.family.kind === 'mixed' ? mixedOption : null}
          {model.family.kind === 'unavailable' ? <option value="">Unavailable</option> : null}
          {[...new Set(fonts.flatMap((font) => font.familyNames.slice(0, 1)))].map((name) => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select></label>
        <label><span>Face</span><select value={selectedFace} disabled={model.face.kind === 'unavailable'}
          onChange={(event) => onFontAsset(event.currentTarget.value)}>
          {model.face.kind === 'mixed' ? mixedOption : null}
          {model.face.kind === 'unavailable' ? <option value="">Unavailable</option> : null}
          {faces.map((font) => <option key={font.assetId} value={font.assetId}>{font.styleName}</option>)}
        </select></label>
        <MixedNumberInput label="Size" value={model.size} min={1} max={1296} step={1} unit="px"
          onBegin={onBegin} onPreview={onSize} onCommit={onCommit} onCancel={onCancel} />
        <label><span>Fill</span>
          <input
            type="color"
            value={model.fill.kind === 'value' ? model.fill.value : '#000000'}
            aria-label="Text fill"
            onFocus={onBegin}
            onChange={(event) => onFill(event.currentTarget.value)}
            onBlur={onCommit}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                onCancel();
                event.currentTarget.blur();
              }
            }}
          />
          {model.fill.kind !== 'value' ? <em>{model.fill.kind === 'mixed' ? 'Mixed' : 'Non-solid / unsupported'}</em> : null}
        </label>
        <MixedNumberInput label="Tracking" value={model.tracking} min={-1000} max={1000} step={1} unit="1/1000 em"
          onBegin={onBegin} onPreview={onTracking} onCommit={onCommit} onCancel={onCancel} />
      </section>
      <section className="lighttable-text-properties__group lighttable-text-properties__group--disabled"
        title={model.advancedUnavailableReason}>
        <h3>Advanced</h3>
        {['Baseline shift', 'Leading', 'Faux bold', 'Faux italic', 'OpenType', 'Variable axes'].map((label) => (
          <button type="button" disabled key={label}>{label}</button>
        ))}
        <p>{model.advancedUnavailableReason}</p>
      </section>
    </div>
  );
};
