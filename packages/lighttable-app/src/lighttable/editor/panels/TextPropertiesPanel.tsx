import { Button } from '@lighttable/ui';
import React from 'react';
import type { PositionedTextRecoveryAnalysis } from '@lighttable/text-core';

import type { DocumentFontAsset } from '../document/documentTypes';
import type { TextPropertyPresentation } from '../../application/text/textPropertyPresentation';
import type { ParagraphStylePatch, TextStylePatch } from '../../application/text/flowTextFormatting';
import { MixedNumberInput } from '../ui/MixedNumberInput';
import { ToolOptionColor, ToolOptionSelect } from '../ui/ToolOptionControls';

export interface TextPropertiesPanelProps {
  readonly model: TextPropertyPresentation;
  readonly fonts: readonly DocumentFontAsset[];
  readonly onFontAsset: (assetId: string) => void;
  readonly onSize: (size: number) => void;
  readonly onFill: (fill: string) => void;
  readonly onFillEnabled: (enabled: boolean) => void;
  readonly onStrokeColor: (stroke: string) => void;
  readonly onStrokeWidth: (width: number) => void;
  readonly onTracking: (tracking: number) => void;
  readonly onStyle: (patch: TextStylePatch) => void;
  readonly onWritingMode: (writingMode: 'horizontal-tb' | 'vertical-rl' | 'vertical-lr') => void;
  readonly onParagraph: (patch: ParagraphStylePatch) => void;
  readonly onBegin: () => void;
  readonly onCommit: () => void;
  readonly onCancel: () => void;
  readonly recovery?: {
    readonly analysis: PositionedTextRecoveryAnalysis;
    readonly onRecover: () => void;
  };
}

const mixedOption = <option value="" disabled>Mixed</option>;

export const TextPropertiesPanel: React.FC<TextPropertiesPanelProps> = ({
  model, fonts, onFontAsset, onSize, onFill, onFillEnabled, onStrokeColor, onStrokeWidth,
  onTracking, onStyle, onWritingMode, onParagraph,
  onBegin, onCommit, onCancel, recovery
}) => {
  if (recovery) {
    const { analysis } = recovery;
    const preview = analysis.preview?.source;
    const messages = analysis.evidence.filter(entry => entry.severity !== 'support');
    return (
      <aside className="lighttable-panel" aria-label="Text properties">
        <section className="lighttable-group lighttable-master-group">
          <div className="lighttable-group__header">
            <div className="lighttable-master-group__label"><strong>Imported text</strong></div>
          </div>
        </section>
        <div className="lighttable-panel__controls">
          <section className="lighttable-group">
            <div className="lighttable-group__header">
              <div className="lighttable-master-group__label"><strong>Recovery preview</strong></div>
            </div>
            <div className="lighttable-group__controls lighttable-tool-options__content lighttable-tool-options__content--vertical">
              <div className="lighttable-tool-options__text">
                <p>
                  {analysis.status === 'recommended' ? 'Recommended' : analysis.status === 'available' ? 'Available' : 'Unavailable'}
                  {' · '}{Math.round(analysis.confidence * 100)}% confidence
                </p>
                {preview ? (
                  <p title={preview.text}>
                    {preview.text.length > 80 ? `${preview.text.slice(0, 77)}…` : preview.text}
                    <br />{preview.styleRuns.length} style run{preview.styleRuns.length === 1 ? '' : 's'}
                    {' · '}{preview.layout.mode} text
                  </p>
                ) : null}
                {messages.map((entry, index) => (
                  <p key={`${entry.code}:${entry.runIndex ?? ''}:${entry.glyphIndex ?? ''}:${index}`}>
                    {entry.severity === 'blocker' ? 'Blocked: ' : 'Note: '}{entry.message}
                  </p>
                ))}
                <Button
                  onClick={recovery.onRecover}
                  disabled={analysis.status === 'blocked' || !analysis.preview}
                >
                  Recover editable text
                </Button>
              </div>
            </div>
          </section>
        </div>
      </aside>
    );
  }
  const family = model.family.kind === 'value' ? model.family.value : '';
  const faces = fonts.filter((font) => font.familyNames.includes(family));
  const selectedFace = model.face.kind === 'value' ? model.face.value : '';
  const applyFamily = (nextFamily: string) => {
    const candidates = fonts.filter((font) => font.familyNames.includes(nextFamily));
    const asset = candidates.find((font) => font.styleName === 'Regular') ?? candidates[0];
    if (asset) onFontAsset(asset.assetId);
  };
  const applyParagraphDiscrete = (patch: ParagraphStylePatch) => {
    onBegin();
    onParagraph(patch);
    onCommit();
  };
  const lineHeightKind = model.lineHeight.kind === 'value' ? model.lineHeight.value.kind : '';
  const lineHeightValue = model.lineHeight.kind !== 'value'
    ? model.lineHeight
    : model.lineHeight.value.kind === 'normal'
      ? { kind: 'unavailable' as const }
      : { kind: 'value' as const, value: model.lineHeight.value.value };
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
                {([
                  ['Bundled', (font: DocumentFontAsset) => font.source === 'bundled'],
                  ['Document', (font: DocumentFontAsset) => font.source !== 'bundled' && font.source !== 'system'],
                  ['System', (font: DocumentFontAsset) => font.source === 'system']
                ] as const).map(([label, accepts]) => {
                  const families = [...new Set(fonts.filter(accepts)
                    .flatMap((font) => font.familyNames.slice(0, 1)))];
                  return families.length ? <optgroup key={label} label={label}>
                    {families.map((name) => <option key={`${label}:${name}`} value={name}>{name}</option>)}
                  </optgroup> : null;
                })}
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
                enabled={model.fillEnabled.kind === 'value' && model.fillEnabled.value}
                onEnabledChange={onFillEnabled}
                onFocus={onBegin}
                onChange={onFill}
                onBlur={onCommit}
                onCancel={onCancel}
                status={model.fill.kind !== 'value'
                  ? <em>{model.fill.kind === 'mixed' ? 'Mixed' : 'Non-solid / unsupported'}</em>
                  : null}
              />
              <ToolOptionColor
                label="Line"
                value={model.strokeColor.kind === 'value' ? model.strokeColor.value : '#000000'}
                ariaLabel="Text line"
                onFocus={onBegin}
                onChange={onStrokeColor}
                onBlur={onCommit}
                onCancel={onCancel}
                status={model.strokeColor.kind !== 'value'
                  ? <em>{model.strokeColor.kind === 'mixed' ? 'Mixed' : 'Non-solid / unsupported'}</em>
                  : null}
              />
              <MixedNumberInput label="Weight" value={model.strokeWidth} min={0}
                max={100000} step={0.5} unit="px" onBegin={onBegin}
                onPreview={onStrokeWidth} onCommit={onCommit} onCancel={onCancel} />
              <MixedNumberInput label="Tracking" value={model.tracking} min={-1000}
                max={1000} step={1} unit="1/1000 em" onBegin={onBegin}
                onPreview={onTracking} onCommit={onCommit} onCancel={onCancel} />
              <ToolOptionSelect label="Kerning"
                value={model.kerning.kind === 'value' ? model.kerning.value : ''}
                disabled={model.kerning.kind === 'unavailable'}
                onChange={(event) => {
                  onBegin(); onStyle({ kerning: event.currentTarget.value as 'auto' | 'metrics' }); onCommit();
                }}>
                {model.kerning.kind === 'mixed' ? mixedOption : null}
                <option value="auto">Auto</option>
                <option value="metrics">Metrics</option>
              </ToolOptionSelect>
              <MixedNumberInput label="Baseline" value={model.baselineShift} min={-100000}
                max={100000} step={1} unit="px" onBegin={onBegin}
                onPreview={(baselineShift) => onStyle({ baselineShift })}
                onCommit={onCommit} onCancel={onCancel} />
              <MixedNumberInput label="Horizontal scale" value={model.horizontalScale} min={1}
                max={1000} step={1} unit="%" onBegin={onBegin}
                onPreview={(horizontalScale) => onStyle({ horizontalScale })}
                onCommit={onCommit} onCancel={onCancel} />
              <MixedNumberInput label="Vertical scale" value={model.verticalScale} min={1}
                max={1000} step={1} unit="%" onBegin={onBegin}
                onPreview={(verticalScale) => onStyle({ verticalScale })}
                onCommit={onCommit} onCancel={onCancel} />
              <div className="lighttable-tool-options__color-field" aria-label="Faux character styles">
                <span>Style</span>
                {([['Bold', 'syntheticBold'], ['Italic', 'syntheticItalic'], ['Underline', 'underline']] as const)
                  .map(([label, property]) => {
                    const value = model[property];
                    return <label className="lighttable-tool-options__toggle" key={property}>
                      <input type="checkbox" aria-label={label}
                        checked={value.kind === 'value' && value.value}
                        ref={(input) => { if (input) input.indeterminate = value.kind === 'mixed'; }}
                        disabled={value.kind === 'unavailable'}
                        onChange={(event) => {
                          onBegin(); onStyle({ [property]: event.currentTarget.checked }); onCommit();
                        }} />
                      <span>{label}</span>
                    </label>;
                  })}
              </div>
              <ToolOptionSelect label="Orientation"
                value={model.writingMode.kind === 'value' ? model.writingMode.value : ''}
                disabled={model.writingMode.kind === 'unavailable'}
                onChange={(event) => onWritingMode(event.currentTarget.value as
                  'horizontal-tb' | 'vertical-rl' | 'vertical-lr')}>
                <option value="horizontal-tb">Horizontal</option>
                <option value="vertical-rl">Vertical, right to left</option>
                <option value="vertical-lr">Vertical, left to right</option>
              </ToolOptionSelect>
            </div>
          </div>
        </section>
        <section className="lighttable-group">
          <div className="lighttable-group__header">
            <div className="lighttable-master-group__label"><strong>Paragraph</strong></div>
          </div>
          <div className="lighttable-group__controls lighttable-tool-options__content lighttable-tool-options__content--vertical">
            <div className="lighttable-tool-options__text">
              <ToolOptionSelect label="Align"
                value={model.alignment.kind === 'value' ? model.alignment.value : ''}
                disabled={model.alignment.kind === 'unavailable'}
                onChange={(event) => applyParagraphDiscrete({
                  alignment: event.currentTarget.value as 'start' | 'center' | 'end' | 'justify'
                })}>
                {model.alignment.kind === 'mixed' ? mixedOption : null}
                <option value="start">Left</option><option value="center">Center</option>
                <option value="end">Right</option><option value="justify">Justify</option>
              </ToolOptionSelect>
              <ToolOptionSelect label="Leading" value={lineHeightKind}
                disabled={model.lineHeight.kind === 'unavailable'}
                onChange={(event) => {
                  const kind = event.currentTarget.value;
                  applyParagraphDiscrete({ lineHeight: kind === 'normal'
                    ? { kind: 'normal' }
                    : kind === 'multiple' ? { kind: 'multiple', value: 1.2 }
                      : { kind: 'absolute', value: model.size.kind === 'value'
                        ? Math.round(model.size.value * 1.2 * 10) / 10 : 19.2 } });
                }}>
                {model.lineHeight.kind === 'mixed' ? mixedOption : null}
                <option value="normal">Auto</option>
                <option value="absolute">Fixed</option>
                <option value="multiple">Multiple</option>
              </ToolOptionSelect>
              <MixedNumberInput label="Leading value" value={lineHeightValue} min={0.01}
                max={100000} step={lineHeightKind === 'multiple' ? 0.1 : 1}
                unit={lineHeightKind === 'multiple' ? '×' : 'px'}
                onBegin={onBegin} onPreview={(value) => onParagraph({ lineHeight: {
                  kind: lineHeightKind === 'multiple' ? 'multiple' : 'absolute', value
                } })} onCommit={onCommit} onCancel={onCancel} />
              <MixedNumberInput label="First line" value={model.firstLineIndent}
                min={-100000} max={100000} step={1} unit="px" onBegin={onBegin}
                onPreview={(firstLineIndent) => onParagraph({ firstLineIndent })}
                onCommit={onCommit} onCancel={onCancel} />
              <MixedNumberInput label="Left indent" value={model.startIndent}
                min={-100000} max={100000} step={1} unit="px" onBegin={onBegin}
                onPreview={(startIndent) => onParagraph({ startIndent })}
                onCommit={onCommit} onCancel={onCancel} />
              <MixedNumberInput label="Right indent" value={model.endIndent}
                min={-100000} max={100000} step={1} unit="px" onBegin={onBegin}
                onPreview={(endIndent) => onParagraph({ endIndent })}
                onCommit={onCommit} onCancel={onCancel} />
              <MixedNumberInput label="Space before" value={model.spaceBefore}
                min={0} max={100000} step={1} unit="px" onBegin={onBegin}
                onPreview={(spaceBefore) => onParagraph({ spaceBefore })}
                onCommit={onCommit} onCancel={onCancel} />
              <MixedNumberInput label="Space after" value={model.spaceAfter}
                min={0} max={100000} step={1} unit="px" onBegin={onBegin}
                onPreview={(spaceAfter) => onParagraph({ spaceAfter })}
                onCommit={onCommit} onCancel={onCancel} />
            </div>
          </div>
        </section>
      </div>
    </aside>
  );
};
