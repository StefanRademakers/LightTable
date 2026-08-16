import React from 'react';
import { lightTableIcon } from '../assets/icons';
import { AdjustmentSlider, type AdjustmentSliderTrack } from '../ui/AdjustmentSlider';
import { LevelsTrack } from '../lighttable/editor/panels/LevelsPropertiesPanel';
import type { LayerId } from '../lighttable/editor/document/documentTypes';
import { createDefaultLayerStyleGradient } from '../lighttable/editor/styles/layerStyleDefaults';
import { GradientAssetEditor } from '../lighttable/editor/ui/LayerStyleGradientEditor';
import { LocalProcessingTreeRows } from '../lighttable/editor/ui/LocalProcessingTreeRows';
import { PanelFileField, PanelSelectField } from '../ui/PanelControls';
import { ToolOptionNumber, ToolOptionSelect } from '../lighttable/editor/ui/ToolOptionControls';
import { OpacitySlider } from '../ui/OpacitySlider';
import { PanelSection } from '../ui/PanelSection';

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
    { label: 'Saturation', track: 'saturation' }
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
      trackBackground="linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)"
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
      onInteractionStart={noop} onInteractionEnd={noop} />
  </div>;
};

export const UiGradientEditorSpecimen = () => {
  const [gradient, setGradient] = React.useState(createDefaultLayerStyleGradient);
  return <GradientAssetEditor value={gradient} onChange={setGradient} />;
};

export const UiMenuListSpecimen = () => (
  <div className="context-menu context-menu--specimen" role="menu" aria-label="Menu style specimen">
    <div className="context-menu__item-wrap">
      <button className="context-menu__item context-menu__item--selected" type="button" role="menuitem">
        <span className="context-menu__item-icon"><img src={lightTableIcon('tool_pen_bezier_tool.png')} alt="" /></span>
        <span className="context-menu__item-label"><span>Selected command</span></span>
        <span className="context-menu__item-shortcut">P</span>
      </button>
    </div>
    <div className="context-menu__item-wrap">
      <button className="context-menu__item" type="button" role="menuitem">
        <span className="context-menu__item-icon"><img src={lightTableIcon('layer_adjustment.png')} alt="" /></span>
        <span className="context-menu__item-label"><span>Regular command</span></span>
      </button>
    </div>
    <div className="context-menu__item-wrap">
      <div className="context-menu__separator" aria-hidden="true" />
      <button className="context-menu__item context-menu__item--disabled" type="button"
        role="menuitem" aria-disabled="true">
        <span className="context-menu__item-label"><span>Disabled command</span></span>
      </button>
    </div>
  </div>
);

export const UiSplitActionListSpecimen = () => (
  <div className="lighttable-layers__create-flyout lighttable-ui-guide__split-menu"
    role="menu" aria-label="Split action list specimen">
    <div className="lighttable-layers__create-option" role="none">
      <button className="lighttable-layers__create-layer" type="button" role="menuitem">
        <img src={lightTableIcon('add_adjustment_layer.png')} alt="" /><span>Grade</span>
      </button>
      <button className="lighttable-layers__create-attached" type="button" role="menuitem"
        aria-label="Attach Grade to selected layer">
        <img src={lightTableIcon('link_vertical.png')} alt="" />
      </button>
    </div>
    <div className="lighttable-layers__create-option lighttable-layers__create-option--section-start"
      role="none">
      <button className="lighttable-layers__create-layer" type="button" role="menuitem">
        <img src={lightTableIcon('layer_adjustment.png')} alt="" /><span>Brightness / Contrast</span>
      </button>
      <button className="lighttable-layers__create-attached" type="button" role="menuitem"
        aria-label="Attach Brightness / Contrast to selected layer">
        <img src={lightTableIcon('link_vertical.png')} alt="" />
      </button>
    </div>
    <div className="lighttable-layers__create-option" role="none">
      <button className="lighttable-layers__create-layer" type="button" role="menuitem">
        <img src={lightTableIcon('tool_gradient.png')} alt="" /><span>Gradient Fill</span>
      </button>
    </div>
  </div>
);

export const UiChoiceListSpecimen = () => (
  <div className="lighttable-ui-guide__listbox" role="listbox" aria-label="Grouped choice list">
    <div className="lighttable-font-picker__group">Document fonts</div>
    <button type="button" role="option" aria-selected="true"
      className="lighttable-font-picker__option lighttable-font-picker__option--selected">Inter Regular</button>
    <button type="button" role="option" aria-selected="false"
      className="lighttable-font-picker__option">Source Serif 4</button>
    <div className="lighttable-font-picker__group">System fonts</div>
    <button type="button" role="option" aria-selected="false"
      className="lighttable-font-picker__option">Segoe UI</button>
  </div>
);

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

export const UiTabListSpecimen = () => (
  <div className="lighttable-document-tabs lighttable-ui-guide__tabs" role="tablist" aria-label="Document tabs specimen">
    <div className="lighttable-document-tab lighttable-document-tab--active" role="tab" aria-selected="true">
      <button type="button" className="lighttable-document-tab__title">portrait.psd *</button>
    </div>
    <div className="lighttable-document-tab" role="tab" aria-selected="false">
      <button type="button" className="lighttable-document-tab__title">layout.png</button>
    </div>
  </div>
);

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
      <ToolOptionSelect label="Mode" value="shape" onChange={noop}>
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
