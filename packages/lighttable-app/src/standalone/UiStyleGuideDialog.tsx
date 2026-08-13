import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { ActionButton } from '../ui/ActionButton';
import { FormInput } from '../ui/FormInput';
import { GradientField, type GradientFieldValue } from '../ui/GradientField';
import { NumericExpressionInput } from '../ui/NumericExpressionInput';
import { SegmentedControl } from '../ui/SegmentedControl';
import { SearchField } from '../ui/SearchField';
import { SquareIconButton } from '../ui/SquareIconButton';
import { SwitchControl } from '../ui/SwitchControl';
import { useDialogAccessibility } from '../ui/useDialogAccessibility';
import { UiColorPickerPrototype } from './UiColorPickerPrototype';
import { GenAiPanel } from '../genai/ui/GenAiPanel';
import {
  PanelAdvancedDisclosure,
  PanelAngleControl,
  PanelCheckboxField,
  PanelColorSwatch,
  PanelNumberSlider,
  PanelSelectField,
  type PanelColor
} from '../lighttable/editor/ui/PanelControls';

export const UI_STYLE_GUIDE_CATEGORIES = [
  { id: 'typography', label: 'Typography' },
  { id: 'actions', label: 'Actions' },
  { id: 'inputs', label: 'Inputs' },
  { id: 'paint', label: 'Paint' },
  { id: 'panels', label: 'Panel controls' },
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

const Sample = ({ title, children }: React.PropsWithChildren<{ title: string }>) => (
  <section className="lighttable-ui-guide__sample">
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
  const [number, setNumber] = useState(50);
  const [select, setSelect] = useState('normal');
  const [color, setColor] = useState<PanelColor>({ r: 0.12, g: 0.48, b: 0.95, a: 1 });
  const [gradientExpanded, setGradientExpanded] = useState(false);
  const [slider, setSlider] = useState(30);
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
              {category === 'typography' ? <>
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
                <Sample title="Text input states">
                  <div className="lighttable-ui-guide__field-stack">
                    <label><span>Label</span><FormInput aria-label="Typography input" defaultValue="Editable value" /></label>
                    <label><span>Disabled</span><FormInput aria-label="Disabled typography input" defaultValue="Unavailable" disabled /></label>
                  </div>
                </Sample>
              </> : null}
              {category === 'actions' ? <>
                <Sample title="Action buttons">
                  <ActionButton>Regular</ActionButton>
                  <ActionButton size="compact">Compact</ActionButton>
                  <ActionButton disabled>Disabled</ActionButton>
                </Sample>
                <Sample title="Icon buttons">
                  <SquareIconButton icon="+" aria-label="Add" />
                  <SquareIconButton icon="−" active aria-label="Remove active" />
                  <SquareIconButton icon="×" disabled aria-label="Disabled" />
                </Sample>
              </> : null}
              {category === 'inputs' ? <>
                <Sample title="Standard control height · 28 px">
                  <FormInput aria-label="Aligned text field" defaultValue="Text" />
                  <NumericExpressionInput value={number} min={0} max={1000}
                    aria-label="Aligned numeric field" onValueChange={setNumber} />
                  <SegmentedControl value={segment} onChange={setSegment} ariaLabel="Aligned segmented control"
                    options={[{ value: 'new', label: 'New' }, { value: 'add', label: 'Add' },
                      { value: 'subtract', label: 'Subtract' }]} />
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
                <Sample title="Switches">
                  <SwitchControl checked={enabled} onCheckedChange={setEnabled} label="Example enabled" />
                  <SwitchControl checked={false} onCheckedChange={() => undefined} label="Example disabled" disabled />
                </Sample>
                <Sample title="Segmented control">
                  <SegmentedControl value={segment} onChange={setSegment} ariaLabel="Selection mode"
                    options={[{ value: 'new', label: 'New' }, { value: 'add', label: 'Add' },
                      { value: 'subtract', label: 'Subtract' }]} />
                </Sample>
              </> : null}
              {category === 'paint' ? <>
                <Sample title="Color swatch · 28 px">
                  <PanelColorSwatch label="Shadow color" value={color} onChange={setColor} />
                </Sample>
                <Sample title="Color picker · 28 px fields">
                  <UiColorPickerPrototype value={color} onChange={setColor} />
                </Sample>
                <Sample title="Gradient field · 28 px">
                  <GradientField value={DEMO_GRADIENT} ariaLabel="Edit gradient"
                    expanded={gradientExpanded} onClick={() => setGradientExpanded((value) => !value)} />
                </Sample>
              </> : null}
              {category === 'panels' ? <>
                <Sample title="GenAI panel states">
                  <GenAiPanel
                    providerName="OpenArt"
                    status="disconnected"
                    onConnect={() => undefined}
                  />
                </Sample>
                <Sample title="Slider">
                  <PanelNumberSlider label="Blur" value={slider} min={0} max={250}
                    suffix=" px" onChange={setSlider} />
                </Sample>
                <Sample title="Angle control">
                  <PanelAngleControl label="Angle" value={angle} onChange={setAngle} />
                </Sample>
                <Sample title="Advanced disclosure">
                  <PanelAdvancedDisclosure>
                    <PanelNumberSlider label="Advanced value" value={slider} min={0} max={100}
                      suffix="%" onChange={setSlider} />
                  </PanelAdvancedDisclosure>
                </Sample>
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
