import React from 'react';
import type { DocumentFontAsset } from '../document/documentTypes';
import type { TextPropertyPresentation } from '../../application/text/textPropertyPresentation';
import { MixedNumberInput } from '../ui/MixedNumberInput';
import { ToolOptionColor, ToolOptionSelect } from '../ui/ToolOptionControls';

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
    <aside className="lighttable-panel" aria-label="Text properties">
      <section className="lighttable-group lighttable-master-group">
        <div className="lighttable-group__header">
          <div className="lighttable-master-group__label">
            <strong>{model.target === 'selection' ? 'Selection' : model.target === 'insertion' ? 'Insertion point' : 'Text layer'}</strong>
          </div>
        </div>
      </section>
      <div className="lighttable-panel__controls">
        <section className="lighttable-group">
          <div className="lighttable-group__header">
            <div className="lighttable-master-group__label"><strong>Character</strong></div>
          </div>
          <div className="lighttable-group__controls lighttable-tool-options__content lighttable-tool-options__content--vertical">
            <div className="lighttable-tool-options__text">
              <ToolOptionSelect label="Family" value={family}
                disabled={model.family.kind === 'unavailable'}
                onChange={(event) => applyFamily(event.currentTarget.value)}>
                {model.family.kind === 'mixed' ? mixedOption : null}
                {model.family.kind === 'unavailable' ? <option value="">Unavailable</option> : null}
                {[...new Set(fonts.flatMap((font) => font.familyNames.slice(0, 1)))].map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </ToolOptionSelect>
              <ToolOptionSelect label="Face" value={selectedFace}
                disabled={model.face.kind === 'unavailable'}
                onChange={(event) => onFontAsset(event.currentTarget.value)}>
                {model.face.kind === 'mixed' ? mixedOption : null}
                {model.face.kind === 'unavailable' ? <option value="">Unavailable</option> : null}
                {faces.map((font) => (
                  <option key={font.assetId} value={font.assetId}>{font.styleName}</option>
                ))}
              </ToolOptionSelect>
              <MixedNumberInput label="Size" value={model.size} min={1} max={1296}
                step={1} unit="px" onBegin={onBegin} onPreview={onSize}
                onCommit={onCommit} onCancel={onCancel} />
              <ToolOptionColor
                label="Fill"
                value={model.fill.kind === 'value' ? model.fill.value : '#000000'}
                ariaLabel="Text fill"
                onFocus={onBegin}
                onChange={onFill}
                onBlur={onCommit}
                onCancel={onCancel}
                status={model.fill.kind !== 'value'
                  ? <em>{model.fill.kind === 'mixed' ? 'Mixed' : 'Non-solid / unsupported'}</em>
                  : null}
              />
              <MixedNumberInput label="Tracking" value={model.tracking} min={-1000}
                max={1000} step={1} unit="1/1000 em" onBegin={onBegin}
                onPreview={onTracking} onCommit={onCommit} onCancel={onCancel} />
            </div>
          </div>
        </section>
      </div>
    </aside>
  );
};
