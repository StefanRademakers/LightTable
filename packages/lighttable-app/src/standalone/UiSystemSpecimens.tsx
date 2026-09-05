import { Button, DocumentTabs, FileField as PanelFileField, Menu, type MenuOption, PanelSection, Select,
  SelectField as PanelSelectField } from '@lighttable/ui';
import React from 'react';
import { lightTableIcon } from '../assets/icons';
import { AdjustmentSlider, type AdjustmentSliderTrack } from '../ui/AdjustmentSlider';
import { LevelsTrack } from '../lighttable/editor/panels/LevelsPropertiesPanel';
import type { LayerId } from '../lighttable/editor/document/documentTypes';
import { createDefaultLayerStyleGradient } from '../lighttable/editor/styles/layerStyleDefaults';
import { GradientAssetEditor } from '../lighttable/editor/ui/LayerStyleGradientEditor';
import { LocalProcessingTreeRows } from '../lighttable/editor/ui/LocalProcessingTreeRows';
import { ToolOptionNumber, ToolOptionSelect } from '../lighttable/editor/ui/ToolOptionControls';
import { OpacitySlider } from '../ui/OpacitySlider';

const noop = () => undefined;

export const UiSliderSpecimens = () => {
  const [value, setValue] = React.useState(42);
  const [opacity, setOpacity] = React.useState(0.68);
  const [levels, setLevels] = React.useState([12, 128, 242]);
  const tracks: Array<{ label: string; track: AdjustmentSliderTrack }> = [
    { label: 'Luminance', track: 'luminance' },
    { label: 'Temperature', track: 'temperature' },
    { label: 'Tint', track: 'tint' },
    { label: 'Vibrance', track: 'vibrance' },
    { label: 'Saturation', track: 'saturation' },
    { label: 'Hue', track: 'hue' },
    { label: 'Cyan / Red', track: 'cyan-red' },
    { label: 'Magenta / Green', track: 'magenta-green' },
    { label: 'Yellow / Blue', track: 'yellow-blue' },
    { label: 'Red / Cyan', track: 'red-cyan' },
    { label: 'Green / Magenta', track: 'green-magenta' },
    { label: 'Blue / Yellow', track: 'blue-yellow' },
    { label: 'White / Black', track: 'white-black' }
  ];
  return <div className="lighttable-ui-guide__vertical-stack">
    <AdjustmentSlider label="Stacked" value={value} min={0} max={100}
      onChange={setValue} onReset={() => setValue(50)} resetValue={50} />
    <AdjustmentSlider label="Inline" layout="inline" value={value} min={0} max={100}
      onChange={setValue} onReset={() => setValue(50)} resetValue={50} />
    <div className="lighttable-ui-guide__bare-slider">
      <span>Bare track</span>
      <AdjustmentSlider label="Bare" layout="bare" value={value} min={0} max={100}
        onChange={setValue} onReset={() => setValue(50)} resetValue={50} />
    </div>
    <AdjustmentSlider label="Layer row" layout="layer-row" value={value} min={0} max={100}
      format={(current) => `${Math.round(current)}%`}
      onChange={setValue} onReset={() => setValue(50)} resetValue={50} />
    <AdjustmentSlider label="Tool bar" layout="tool-bar" value={value} min={0} max={100}
      onChange={setValue} onReset={() => setValue(50)} resetValue={50} />
    <AdjustmentSlider label="Tool panel" layout="tool-panel" value={value} min={0} max={100}
      onChange={setValue} onReset={() => setValue(50)} resetValue={50} />
    {tracks.map(({ label, track }) => (
      <AdjustmentSlider key={track} label={label} track={track} value={value}
        min={0} max={100} onChange={setValue} onReset={() => setValue(50)} />
    ))}
    <AdjustmentSlider label="Hue" value={value * 3.6} min={0} max={360}
      track="hue"
      format={(current) => `${Math.round(current)}°`}
      onChange={(next) => setValue(next / 3.6)} onReset={() => setValue(0)} />
    <OpacitySlider value={opacity} color="#5ca8ef" onChange={setOpacity} />
    <LevelsTrack label="Multi-handle / Levels" values={levels}
      ariaLabels={['Black', 'Gamma position', 'White']}
      background="linear-gradient(to right, #050607, #f2f4f6)"
      disabled={false}
      onChange={(index, next) => setLevels((current) => current.map((item, itemIndex) => (
        itemIndex === index ? next : item
      )))}
      onInteractionStart={noop} onInteractionEnd={noop} onInteractionCancel={noop} />
  </div>;
};

export const UiGradientEditorSpecimen = () => {
  const [gradient, setGradient] = React.useState(createDefaultLayerStyleGradient);
  return <GradientAssetEditor value={gradient} onChange={setGradient} />;
};

const MenuSpecimen = ({ label, options }: { label: string; options: MenuOption[] }) => {
  const [open, setOpen] = React.useState(false);
  const anchor = React.useRef<HTMLButtonElement>(null);
  return <><Button ref={anchor} onClick={() => setOpen(!open)}>{label}</Button>
    <Menu data-editor-native-tab-navigation open={open} anchor={anchor} label={label} options={options} onClose={() => setOpen(false)} /></>;
};

export const UiMenuListSpecimen = () => <MenuSpecimen label="Menu style specimen" options={[
  { value: 'selected', label: 'Selected command', selected: true, shortcut: 'P', icon: <img src={lightTableIcon('tool_pen_bezier_tool.png')} alt="" /> },
  { value: 'regular', label: 'Regular command', icon: <img src={lightTableIcon('layer_adjustment.png')} alt="" /> },
  { value: 'disabled', label: 'Disabled command', disabled: true, separatorBefore: true }
]} />;

export const UiSplitActionListSpecimen = () => <MenuSpecimen label="Split action list specimen" options={[
  { value: 'grade', label: 'Grade', icon: <img src={lightTableIcon('add_adjustment_layer.png')} alt="" />,
    trailingAction: { value: 'attach-grade', label: 'Attach Grade to selected layer', icon: <img src={lightTableIcon('link_vertical.png')} alt="" />, onClick: noop } },
  { value: 'contrast', label: 'Brightness / Contrast', separatorBefore: true, icon: <img src={lightTableIcon('layer_adjustment.png')} alt="" />,
    trailingAction: { value: 'attach-contrast', label: 'Attach Brightness / Contrast to selected layer', icon: <img src={lightTableIcon('link_vertical.png')} alt="" />, onClick: noop } }
]} />;

export const UiChoiceListSpecimen = () => <Select aria-label="Grouped choice list" searchable tabIndex={0}
  defaultValue="inter" options={[
    { value: 'inter', label: 'Inter Regular', group: 'Document fonts' },
    { value: 'source', label: 'Source Serif 4', group: 'Document fonts' },
    { value: 'segoe', label: 'Segoe UI', group: 'System fonts' }
  ]} />;

export const UiLayerTreeSpecimen = () => (
  <div className="lighttable-ui-guide__layer-tree-shell">
    <div className="lighttable-layers__list lighttable-ui-guide__layer-tree"
      role="tree" aria-label="Layer tree specimen">
      <div className="lighttable-layer lighttable-layer--active lighttable-layer--selected"
        role="treeitem" aria-selected="true">
        <button type="button" className="lighttable-layer__visibility" aria-label="Hide Black & White">
          <img src={lightTableIcon('visible.png')} alt="" />
        </button>
        <span className="lighttable-layer__thumbnail-slot">
          <button type="button" style={{ width: 32, height: 32 }}
            className="lighttable-layer__thumbnail lighttable-layer__thumbnail--active"
            aria-label="Adjustment content">
            <img className="lighttable-layer__type-icon" src={lightTableIcon('layer_adjustment.png')} alt="" />
          </button>
        </span>
        <button type="button" className="lighttable-layer__mask-link lighttable-layer__mask-link--linked"
          aria-label="Unlink layer and mask">
          <img src={lightTableIcon('link_vertical.png')} alt="" />
        </button>
        <span className="lighttable-layer__thumbnail-slot">
          <button type="button" style={{ width: 32, height: 32 }}
            className="lighttable-layer__thumbnail lighttable-layer__mask" aria-label="Layer mask" />
        </span>
        <input className="lighttable-layer__name" defaultValue="Black & White" readOnly tabIndex={-1}
          aria-label="Layer name" />
        <span className="lighttable-layer__status" />
      </div>
      <div className="lighttable-layer" role="treeitem" aria-selected="false">
        <button type="button" className="lighttable-layer__visibility" aria-label="Hide Background">
          <img src={lightTableIcon('visible.png')} alt="" />
        </button>
        <span className="lighttable-layer__thumbnail-slot">
          <button type="button" style={{ width: 40, height: 32 }}
            className="lighttable-layer__thumbnail lighttable-layer__thumbnail--transparent"
            aria-label="Background pixels">
            <img className="lighttable-layer__type-icon" src={lightTableIcon('photo.png')} alt="" />
          </button>
        </span>
        <input className="lighttable-layer__name" defaultValue="Background" readOnly tabIndex={-1}
          aria-label="Layer name" />
        <span className="lighttable-layer__status"><span className="lighttable-layer__fx-mark">fx</span></span>
        <button type="button" className="lighttable-layer__disclosure lighttable-layer__disclosure--trailing"
          aria-label="Collapse processing and effects for Background">
          <img src={lightTableIcon('chevron_layer.png')} alt="" />
        </button>
      </div>
      <div className="lighttable-layer-effects" style={{ paddingLeft: 31 }}>
        <LocalProcessingTreeRows layerId={'style-guide-background' as LayerId}
          items={[{ id: 'grade', label: 'Grade', enabled: true }]}
          onActivate={noop} onContextMenu={noop} onDragStart={noop} onEnabled={noop} />
      </div>
    </div>
  </div>
);

export const UiTabListSpecimen = () => {
  const [activeId, setActiveId] = React.useState('portrait');
  const container = React.useRef<HTMLDivElement>(null);
  return <div>
    <DocumentTabs label="Document tabs specimen" activeId={activeId} onSelect={setActiveId} overview={{ container }}
      documents={[{ id: 'portrait', title: 'portrait.psd', dirty: true }, { id: 'layout', title: 'layout.png' }]} />
    <div ref={container} style={{ position: 'relative', height: 280 }} />
  </div>;
};

export const UiContainerSpecimens = () => {
  const [expanded, setExpanded] = React.useState(true);
  const [mode, setMode] = React.useState('normal');
  return <div className="lighttable-ui-guide__vertical-stack">
    <PanelSection label="Collapsible panel section" expanded={expanded}
      onExpandedChange={setExpanded}>
      <div className="lighttable-property-stack">
        <PanelSelectField label="Mode" value={mode} onChange={setMode}
          options={[{ value: 'normal', label: 'Normal' }, { value: 'screen', label: 'Screen' }]} />
        <PanelFileField label="Asset" buttonLabel="Choose..." accept=".cube"
          onFile={noop} />
      </div>
    </PanelSection>
    <div className="lighttable-ui-guide__toolbar-group">
      <ToolOptionSelect label="Mode" value="shape" onValueChange={noop}>
        <option value="shape">Shape</option><option value="path">Path</option>
      </ToolOptionSelect>
      <ToolOptionNumber label="Weight" value={3} unit="px" onChange={noop} />
    </div>
    <div className="lighttable-ui-guide__popover-specimen">Viewport-owned popover surface</div>
  </div>;
};

const PROPERTY_PANEL_WIDTHS = [
  { label: 'Narrow · 220 px', width: 220 },
  { label: 'Standard · 260 px', width: 260 },
  { label: 'Wide · 320 px', width: 320 }
] as const;

export const UiLayoutGeometrySpecimens = () => {
  const [mode, setMode] = React.useState('normal');
  return <div className="lighttable-ui-guide__vertical-stack">
    <div className="lighttable-ui-guide__spacing-scale" aria-label="Spacing scale">
      {[2, 4, 6, 8, 10, 12, 14, 16, 18, 24].map((size) => (
        <span key={size}><i style={{ width: size, height: size }} />{size}</span>
      ))}
    </div>
    <div className="lighttable-ui-guide__property-widths">
      {PROPERTY_PANEL_WIDTHS.map(({ label, width }) => (
        <section className="lighttable-ui-guide__property-frame" style={{ width }} key={width}>
          <header>{label}</header>
          <div className="lighttable-property-stack">
            <PanelSelectField label="Mode" value={mode} onChange={setMode}
              options={[{ value: 'normal', label: 'Normal' }, { value: 'screen', label: 'Screen' }]} />
            <PanelFileField label="Asset" buttonLabel="Choose..." accept=".cube" onFile={noop} />
          </div>
        </section>
      ))}
    </div>
    <div className="lighttable-ui-guide__workspace-geometry" aria-label="Workspace bar geometry">
      <div className="lighttable-ui-guide__workspace-menubar">Menu bar <span>36 px</span></div>
      <div className="lighttable-ui-guide__workspace-toolbar">Property bar <span>38 px</span></div>
      <div className="lighttable-ui-guide__workspace-body">
        <aside>Tool rail<br /><span>38 px</span></aside>
        <main>Document workspace</main>
        <section>Standard panel<br /><span>260 px</span></section>
      </div>
      <div className="lighttable-ui-guide__workspace-status">Status bar <span>32 px</span></div>
    </div>
  </div>;
};
