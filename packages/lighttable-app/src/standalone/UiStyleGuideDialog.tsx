import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { lightTableIcon } from '../assets/icons';
import { ActionButton } from '../ui/ActionButton';
import { ColorSwatchField } from '../ui/ColorSwatchField';
import { FormInput } from '../ui/FormInput';
import { GradientField, type GradientFieldValue } from '../ui/GradientField';
import { NonePaintField } from '../ui/NonePaintField';
import { NumericExpressionInput } from '../ui/NumericExpressionInput';
import { SegmentedControl } from '../ui/SegmentedControl';
import { SearchField } from '../ui/SearchField';
import { SquareIconButton } from '../ui/SquareIconButton';
import { SwitchControl } from '../ui/SwitchControl';
import { useDialogAccessibility } from '../ui/useDialogAccessibility';
import { UiColorPickerPrototype } from './UiColorPickerPrototype';
import {
  ADJUSTMENT_DIALOG_SPECIMENS,
  photoshopShortcutForCurrentPlatform
} from './AdjustmentDialogSpecimens';
import {
  UiChoiceListSpecimen,
  UiContainerSpecimens,
  UiGradientEditorSpecimen,
  UiLayerTreeSpecimen,
  UiLayoutGeometrySpecimens,
  UiMenuListSpecimen,
  UiSliderSpecimens,
  UiSplitActionListSpecimen,
  UiTabListSpecimen
} from './UiSystemSpecimens';
import {
  PanelAdvancedDisclosure,
  PanelAngleControl,
  PanelCheckboxField,
  PanelFileField,
  PanelSelectField,
  type PanelColor
} from '../ui/PanelControls';

export const UI_STYLE_GUIDE_CATEGORIES = [
  { id: 'foundations', label: 'Foundations' },
  { id: 'actions', label: 'Actions' },
  { id: 'fields', label: 'Fields' },
  { id: 'selection', label: 'Selection' },
  { id: 'sliders', label: 'Sliders' },
  { id: 'paint', label: 'Paint & color' },
  { id: 'gradients', label: 'Gradients' },
  { id: 'lists', label: 'Lists & navigation' },
  { id: 'containers', label: 'Containers' },
  { id: 'layout', label: 'Layout & geometry' },
  { id: 'feedback', label: 'Feedback' },
  { id: 'adjustments', label: 'Adjustment dialogs' },
  { id: 'dialogs', label: 'Dialogs' }
] as const;

type StyleGuideCategory = typeof UI_STYLE_GUIDE_CATEGORIES[number]['id'];

const DEMO_GRADIENT: GradientFieldValue = {
  colorStops: [
    { position: 0, color: { r: 0.08, g: 0.34, b: 0.95, a: 1 } },
    { position: 0.52, color: { r: 0.95, g: 0.2, b: 0.62, a: 1 } },
    { position: 1, color: { r: 1, g: 0.74, b: 0.08, a: 1 } }
  ],
  opacityStops: [
    { position: 0, opacity: 1 },
    { position: 1, opacity: 1 }
  ]
};

const Sample = ({ title, wide = false, children }: React.PropsWithChildren<{
  title: string;
  wide?: boolean;
}>) => (
  <section className={`lighttable-ui-guide__sample${wide ? ' lighttable-ui-guide__sample--wide' : ''}`}>
    <h5>{title}</h5>
    <div className="lighttable-ui-guide__sample-content">{children}</div>
  </section>
);

export interface UiStyleGuideDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

/** Live catalog of canonical controls; samples intentionally use production components. */
export const UiStyleGuideDialog: React.FC<UiStyleGuideDialogProps> = ({ open, onClose }) => {
  const { dialogRef, onDialogKeyDown } = useDialogAccessibility<HTMLDivElement>(open, onClose);
  const [category, setCategory] = useState<StyleGuideCategory>('actions');
  const [enabled, setEnabled] = useState(true);
  const [segment, setSegment] = useState<'new' | 'add' | 'subtract'>('new');
  const [lowAttentionSegment, setLowAttentionSegment] = useState<'ai' | 'grading' | 'photo'>('photo');
  const [number, setNumber] = useState(50);
  const [select, setSelect] = useState('normal');
  const [color, setColor] = useState<PanelColor>({ r: 0.12, g: 0.48, b: 0.95, a: 1 });
  const [colorOpacity, setColorOpacity] = useState(0.72);
  const [compactColor, setCompactColor] = useState('#1f7af2');
  const [gradientExpanded, setGradientExpanded] = useState(false);
  const [noneExpanded, setNoneExpanded] = useState(false);
  const [angle, setAngle] = useState(315);
  const [search, setSearch] = useState('');

  if (!open) return null;

  return createPortal(
    <div className="modal-backdrop lighttable-dialog-backdrop" onMouseDown={onClose}>
      <div ref={dialogRef} className="modal lighttable-preferences lighttable-ui-guide"
        role="dialog" aria-modal="true" aria-label="UI Style Guide" tabIndex={-1}
        data-editor-native-tab-navigation onKeyDown={onDialogKeyDown}
        onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal__header lighttable-preferences__header">
          <h3 className="modal__title">UI Style Guide</h3>
        </div>
        <div className="lighttable-preferences__layout">
          <nav className="lighttable-preferences__navigation" aria-label="Style Guide categories">
            {UI_STYLE_GUIDE_CATEGORIES.map((item) => (
              <button key={item.id} type="button"
                className={category === item.id ? 'is-active' : undefined}
                aria-current={category === item.id ? 'page' : undefined}
                onClick={() => setCategory(item.id)}>{item.label}</button>
            ))}
          </nav>
          <main className="lighttable-preferences__content lighttable-ui-guide__content">
            <header className="lighttable-preferences__page-title">
              <h4>{UI_STYLE_GUIDE_CATEGORIES.find((item) => item.id === category)?.label}</h4>
              <p>Live production styles and controls. Feature UI should compose these instead of restyling them.</p>
            </header>
            <div className="lighttable-ui-guide__samples">
              {category === 'foundations' ? <>
                <Sample title="Typography scale">
                  <div className="lighttable-ui-guide__type-stack">
                    <p className="lighttable-ui-guide__type-large">Large · 14 px · titles and headings</p>
                    <p className="lighttable-ui-guide__type-regular">Regular · 12 px · controls and body text</p>
                    <p className="lighttable-ui-guide__type-small">Small · 10 px · metadata and compact notes</p>
                  </div>
                </Sample>
                <Sample title="Documentation text">
                  <div className="lighttable-ui-guide__type-stack">
                    <p className="lighttable-ui-guide__type-large">Primary explanatory text for a feature or workflow.</p>
                    <p className="lighttable-ui-guide__type-regular">Normal body text for labels, instructions and supporting information.</p>
                    <p className="lighttable-ui-guide__type-small muted">Muted helper text for secondary context.</p>
                    <p className="lighttable-preferences__error">Error text explains the problem and the next action.</p>
                  </div>
                </Sample>
                <Sample title="Control geometry">
                  <div className="lighttable-ui-guide__geometry">
                    <span><i className="is-regular" />28 px control</span>
                    <span><i className="is-compact" />24 px compact</span>
                    <span><i className="is-radius" />6 px radius</span>
                  </div>
                </Sample>
                <Sample title="Surface and semantic color roles">
                  <div className="lighttable-ui-guide__swatches">
                    {['app', 'panel', 'control', 'selected', 'info', 'success', 'warning', 'danger'].map((role) => (
                      <span key={role}><i data-role={role} />{role}</span>
                    ))}
                  </div>
                </Sample>
                <Sample title="Text input states">
                  <div className="lighttable-ui-guide__field-stack">
                    <label><span>Label</span><FormInput aria-label="Typography input" defaultValue="Editable value" /></label>
                    <label><span>Disabled</span><FormInput aria-label="Disabled typography input" defaultValue="Unavailable" disabled /></label>
                  </div>
                </Sample>
              </> : null}
              {category === 'actions' ? <>
                <Sample title="One button component - density by context">
                  <ActionButton>Dialog · 36 px</ActionButton>
                  <ActionButton size="control">Control row · 28 px</ActionButton>
                  <ActionButton size="compact">Compact · 24 px</ActionButton>
                </Sample>
                <Sample title="Icon buttons">
                  <SquareIconButton icon="+" aria-label="Add" />
                  <SquareIconButton icon="−" active aria-label="Remove active" />
                  <SquareIconButton icon="×" disabled aria-label="Disabled" />
                </Sample>
                <Sample title="States - geometry does not change">
                  <ActionButton size="control">Enabled</ActionButton>
                  <ActionButton size="control" disabled>Disabled</ActionButton>
                  <ActionButton size="control" className="admin-table__danger">Destructive</ActionButton>
                </Sample>
              </> : null}
              {category === 'fields' ? <>
                <Sample title="Standard control height · 28 px">
                  <FormInput aria-label="Aligned text field" defaultValue="Text" />
                  <NumericExpressionInput value={number} min={0} max={1000}
                    aria-label="Aligned numeric field" onValueChange={setNumber} />
                  <ActionButton size="control">Control action</ActionButton>
                </Sample>
                <Sample title="Text fields">
                  <FormInput aria-label="Text example" defaultValue="Layer name" />
                  <FormInput aria-label="Disabled text example" defaultValue="Unavailable" disabled />
                </Sample>
                <Sample title="Search field">
                  <SearchField aria-label="Search example" placeholder="Search" value={search}
                    onChange={(event) => setSearch(event.currentTarget.value)} />
                </Sample>
                <Sample title="Numeric expression">
                  <NumericExpressionInput value={number} min={0} max={1000}
                    aria-label="Size" onValueChange={setNumber} />
                  <span>{number} px · accepts expressions such as 1920/2</span>
                </Sample>
                <Sample title="Select field">
                  <PanelSelectField label="Mode" value={select} onChange={setSelect}
                    options={[{ value: 'normal', label: 'Normal' },
                      { value: 'multiply', label: 'Multiply' }, { value: 'screen', label: 'Screen' }]} />
                </Sample>
                <Sample title="Checkboxes">
                  <PanelCheckboxField label="Enabled" checked={enabled} onChange={setEnabled} />
                  <PanelCheckboxField label="Optional setting" checked={false} onChange={() => undefined} />
                </Sample>
                <Sample title="File field">
                  <PanelFileField label="3D LUT" buttonLabel="Load .cube..." accept=".cube"
                    onFile={() => undefined} />
                </Sample>
              </> : null}
              {category === 'selection' ? <>
                <Sample title="Switches">
                  <SwitchControl checked={enabled} onCheckedChange={setEnabled} label="Example enabled" />
                  <SwitchControl checked={false} onCheckedChange={() => undefined} label="Example disabled" disabled />
                </Sample>
                <Sample title="Segmented control">
                  <SegmentedControl value={segment} onChange={setSegment} ariaLabel="Selection mode"
                    options={[{ value: 'new', label: 'New' }, { value: 'add', label: 'Add' },
                      { value: 'subtract', label: 'Subtract' }]} />
                </Sample>
                <Sample title="Low-attention segmented control">
                  <SegmentedControl variant="low-attention" value={lowAttentionSegment}
                    onChange={setLowAttentionSegment} ariaLabel="Low-attention navigation"
                    options={[
                      { value: 'ai', label: 'Gen AI',
                        icon: <img src={lightTableIcon('genai.png')} alt="" aria-hidden="true" /> },
                      { value: 'grading', label: 'Grading',
                        icon: <img src={lightTableIcon('add_adjustment_layer.png')} alt="" aria-hidden="true" /> },
                      { value: 'photo', label: 'Photo edit',
                        icon: <img src={lightTableIcon('photo.png')} alt="" aria-hidden="true" /> }
                    ]} />
                </Sample>
                <Sample title="Disabled segmented option">
                  <SegmentedControl value="one" onChange={() => undefined} ariaLabel="Disabled option example"
                    options={[{ value: 'one', label: 'Available' },
                      { value: 'two', label: 'Unavailable', disabled: true }]} />
                </Sample>
              </> : null}
              {category === 'sliders' ? <Sample title="Slider layouts, tracks and multi-handle" wide>
                <UiSliderSpecimens />
              </Sample> : null}
              {category === 'paint' ? <>
                <Sample title="Paint fields · 104 × 28 px">
                  <div className="lighttable-ui-guide__control-table">
                    <div className="lighttable-ui-guide__control-row">
                      <span>Color swatch</span>
                      <ColorSwatchField value={compactColor} ariaLabel="Color swatch"
                        onChange={setCompactColor} />
                    </div>
                    <div className="lighttable-ui-guide__control-row">
                      <span>Color dropdown</span>
                      <ColorSwatchField value={compactColor} accessory="chevron"
                        ariaLabel="Color dropdown" onChange={setCompactColor} />
                    </div>
                    <div className="lighttable-ui-guide__control-row">
                      <span>Gradient fill</span>
                      <GradientField value={DEMO_GRADIENT} ariaLabel="Gradient fill"
                        expanded={gradientExpanded}
                        onClick={() => setGradientExpanded((value) => !value)} />
                    </div>
                    <div className="lighttable-ui-guide__control-row">
                      <span>None</span>
                      <NonePaintField ariaLabel="No paint" expanded={noneExpanded}
                        onClick={() => setNoneExpanded((value) => !value)} />
                    </div>
                  </div>
                </Sample>
                <Sample title="Color picker · 28 px fields">
                  <UiColorPickerPrototype value={color} onChange={setColor}
                    opacity={colorOpacity} onOpacityChange={setColorOpacity} />
                </Sample>
              </> : null}
              {category === 'gradients' ? <>
                <Sample title="Gradient triggers · regular and compact">
                  <GradientField value={DEMO_GRADIENT} ariaLabel="Regular gradient trigger"
                    onClick={() => undefined} />
                  <GradientField value={DEMO_GRADIENT} size="compact"
                    ariaLabel="Compact gradient trigger" onClick={() => undefined} />
                </Sample>
                <Sample title="Complete gradient editor" wide>
                  <UiGradientEditorSpecimen />
                </Sample>
              </> : null}
              {category === 'lists' ? <>
                <Sample title="Command menu · icons, shortcut, separator and disabled">
                  <UiMenuListSpecimen />
                </Sample>
                <Sample title="Split-action creation list - create or attach">
                  <UiSplitActionListSpecimen />
                </Sample>
                <Sample title="Grouped choice listbox">
                  <UiChoiceListSpecimen />
                </Sample>
                <Sample title="Hierarchical Layers tree">
                  <UiLayerTreeSpecimen />
                </Sample>
                <Sample title="Horizontal document tabs">
                  <UiTabListSpecimen />
                </Sample>
              </> : null}
              {category === 'containers' ? <>
                <Sample title="Panel, property stack, toolbar group and popover" wide>
                  <UiContainerSpecimens />
                </Sample>
                <Sample title="Angle control">
                  <PanelAngleControl label="Angle" value={angle} onChange={setAngle} />
                </Sample>
                <Sample title="Advanced disclosure">
                  <PanelAdvancedDisclosure>
                    <PanelSelectField label="Method" value="classic" onChange={() => undefined}
                      options={[{ value: 'classic', label: 'Classic' }]} />
                  </PanelAdvancedDisclosure>
                </Sample>
              </> : null}
              {category === 'layout' ? <>
                <Sample title="Spacing scale, property widths and workspace geometry" wide>
                  <UiLayoutGeometrySpecimens />
                </Sample>
              </> : null}
              {category === 'feedback' ? <>
                <Sample title="Notices">
                  <div className="lighttable-ui-guide__feedback-stack">
                    <div className="lighttable-style-notice">Informational notice with a stable layout.</div>
                    <div className="lighttable-ui-guide__feedback lighttable-ui-guide__feedback--success">Ready · changes saved</div>
                    <div className="lighttable-ui-guide__feedback lighttable-ui-guide__feedback--warning">Approximate Photoshop compatibility</div>
                    <div className="lighttable-ui-guide__feedback lighttable-ui-guide__feedback--error">Asset could not be loaded</div>
                  </div>
                </Sample>
                <Sample title="Empty and disabled states">
                  <div className="lighttable-panel__empty">Select editable content to show properties.</div>
                  <ActionButton size="control" disabled>Unavailable action</ActionButton>
                </Sample>
              </> : null}
              {category === 'adjustments' ? <>
                {ADJUSTMENT_DIALOG_SPECIMENS.map((specimen) => (
                  <Sample title={`${specimen.name}${'shortcut' in specimen
                    ? ` - ${photoshopShortcutForCurrentPlatform(specimen.shortcut)}`
                    : ''}`} key={specimen.name}>
                    {React.createElement(specimen.Component)}
                  </Sample>
                ))}
              </> : null}
              {category === 'dialogs' ? <>
                <Sample title="Confirmation dialog">
                  <div className="modal lighttable-ui-guide__dialog-specimen">
                    <div className="modal__header"><h3 className="modal__title">Confirm action</h3></div>
                    <p>Explain what will happen in one short, concrete sentence.</p>
                    <div className="modal__footer">
                      <ActionButton>Cancel</ActionButton>
                      <ActionButton>Continue</ActionButton>
                    </div>
                  </div>
                </Sample>
                <Sample title="Form dialog">
                  <div className="modal lighttable-ui-guide__dialog-specimen">
                    <div className="modal__header"><h3 className="modal__title">Rename layer</h3></div>
                    <label className="lighttable-ui-guide__dialog-field">
                      <span>Name</span>
                      <FormInput aria-label="Dialog field example" defaultValue="Background copy" />
                    </label>
                    <div className="modal__footer">
                      <ActionButton>Cancel</ActionButton>
                      <ActionButton>Save</ActionButton>
                    </div>
                  </div>
                </Sample>
                <Sample title="Destructive confirmation">
                  <div className="modal lighttable-ui-guide__dialog-specimen">
                    <div className="modal__header"><h3 className="modal__title">Delete layer?</h3></div>
                    <p>This cannot be undone after the document is closed.</p>
                    <div className="modal__footer">
                      <ActionButton>Cancel</ActionButton>
                      <ActionButton className="admin-table__danger">Delete</ActionButton>
                    </div>
                  </div>
                </Sample>
                <Sample title="Information dialog">
                  <div className="modal lighttable-ui-guide__dialog-specimen">
                    <div className="modal__header"><div><h3 className="modal__title">Application</h3><p className="muted">Release and update status</p></div></div>
                    <dl className="lighttable-ui-guide__definition-list">
                      <div><dt>Version</dt><dd>0.1.0</dd></div>
                      <div><dt>Channel</dt><dd>Development</dd></div>
                    </dl>
                    <div className="modal__footer lighttable-ui-guide__split-footer">
                      <ActionButton>Check for updates</ActionButton>
                      <ActionButton>Close</ActionButton>
                    </div>
                  </div>
                </Sample>
              </> : null}
            </div>
          </main>
        </div>
        <footer className="modal__footer lighttable-preferences__footer">
          <ActionButton onClick={onClose}>Close</ActionButton>
        </footer>
      </div>
    </div>,
    document.body
  );
};
