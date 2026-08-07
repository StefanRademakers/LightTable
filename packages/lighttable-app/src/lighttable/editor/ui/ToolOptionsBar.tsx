import React from 'react';
import { navigateFontPicker } from './fontPickerKeyboard';
import { createPortal } from 'react-dom';
import { lightTableIcon } from '../../../assets/icons';
import { AdjustmentSlider } from '../../AdjustmentSlider';
import { SegmentedControl } from '../../../ui/SegmentedControl';
import type {
  BrushSettings,
  EditorSession,
  TextToolSettings,
  ToolId,
  VectorToolStyleSettings
} from '../session/editorSession';
import { WarpToolOptions } from '../../application/tools/warp/WarpToolOptions';
import { toolDefinition } from '../tools/toolRegistry';
import { isSelectionTool } from '../tools/toolCapabilities';
import type { SelectionCombineMode } from '../selection/selectionTypes';
import { ZOOM_PRESETS_PERCENT } from '../tools/zoom/zoomLevels';
import type { DocumentFontAsset } from '../document/documentTypes';
import type { TextPropertyPresentation } from '../../application/text/textPropertyPresentation';
import { MixedNumberInput } from './MixedNumberInput';
import { ToolOptionColor, ToolOptionNumber, ToolOptionSelect } from './ToolOptionControls';
import { GradientAssetEditor } from './LayerStyleGradientEditor';
import type { GradientPaintInstance } from '@lighttable/paint-core';
import { AnchoredGradientPopover } from './AnchoredGradientPopover';
import { VectorStyleToolOptions } from './VectorStyleToolOptions';
import type { TextPaint, TextWarp, TextWarpStyle } from '@lighttable/text-core';
import type { AffineMatrix, TransformSessionState } from '../tools/transform/transformTypes';
import {
  aroundPoint,
  multiplyMatrices,
  rotationMatrix,
  scaleMatrix,
  transformedBounds,
  translationMatrix
} from '../tools/transform/affine';

export interface ToolOptionsProps {
  activeTool: ToolId;
  brush: BrushSettings;
  gradient: EditorSession['gradient'];
  shape: EditorSession['shape'];
  pen: EditorSession['pen'];
  warp: EditorSession['warp'];
  vectorStyle: VectorToolStyleSettings;
  text: TextToolSettings;
  textFonts: readonly DocumentFontAsset[];
  textProperties?: TextPropertyPresentation | null;
  textLayoutMode?: 'point' | 'paragraph' | null;
  selectedVectorStyle?: VectorToolStyleSettings | null;
  selectedShape?: EditorSession['shape'] | null;
  selectedShapeKind?: 'rectangle' | 'ellipse' | 'line' | null;
  selectionPixelSnap: boolean;
  selectionCombineMode: SelectionCombineMode;
  selectionRowHeight: number;
  selectionColumnWidth: number;
  zoomPercent: number;
  transformState?: TransformSessionState | null;
  /** Undefined for non-text transforms; null is editable text without a warp. */
  textWarp?: TextWarp | null;
  onBrushChange: (change: Partial<BrushSettings>) => void;
  onGradientChange: (change: Partial<EditorSession['gradient']>) => void;
  onShapeChange: (change: Partial<EditorSession['shape']>) => void;
  onPenChange: (change: Partial<EditorSession['pen']>) => void;
  onWarpChange: (change: Partial<EditorSession['warp']>) => void;
  onVectorStyleChange: (change: Partial<VectorToolStyleSettings>) => void;
  onTextChange: (change: Partial<TextToolSettings>) => void;
  onTextFontAssetChange?: (assetId: string) => void;
  onTextSizeChange?: (size: number) => void;
  onTextFillChange?: (fill: string) => void;
  onTextFillPaintChange?: (fill: TextPaint) => void;
  onTextFillEnabledChange?: (enabled: boolean) => void;
  onTextStrokeColorChange?: (stroke: string) => void;
  onTextStrokeWidthChange?: (width: number) => void;
  onTextAlignmentChange?: (alignment: TextToolSettings['alignment']) => void;
  onTextWritingModeChange?: (writingMode: 'horizontal-tb' | 'vertical-rl' | 'vertical-lr') => void;
  onTextPropertyBegin?: () => void;
  onTextPropertyCommit?: () => void;
  onTextPropertyCancel?: () => void;
  onTextLayoutModeChange?: (mode: 'point' | 'paragraph') => void;
  onSelectedVectorStyleChange?: (change: Partial<VectorToolStyleSettings>) => void;
  onSelectedShapeChange?: (change: Partial<EditorSession['shape']>) => void;
  onWarpReset: () => void;
  onSelectionPixelSnapChange: (enabled: boolean) => void;
  onSelectionCombineModeChange: (mode: SelectionCombineMode) => void;
  onSelectionRowHeightChange: (height: number) => void;
  onSelectionColumnWidthChange: (width: number) => void;
  onZoomPreset: (percent: number) => void;
  onZoomFit: () => void;
  onTransformChange?: (matrix: AffineMatrix) => void;
  onTransformCommit?: () => void;
  onTransformCancel?: () => void;
  onTextWarpChange?: (warp: TextWarp | null) => void;
  onTextWarpBegin?: () => void;
  onTextWarpCommit?: () => void;
  onTextWarpCancel?: () => void;
}

const TOOL_LABELS: Record<ToolId, string> = {
  transform: 'Transform',
  warp: 'Warp',
  'select-rectangle': 'Rectangular selection',
  'select-ellipse': 'Elliptical selection',
  'select-horizontal': 'Horizontal selection',
  'select-vertical': 'Vertical selection',
  'select-free': 'Free selection',
  'select-polygonal': 'Polygonal selection',
  gradient: 'Gradient',
  fill: 'Paint bucket',
  brush: 'Brush',
  erase: 'Erase',
  view: 'Move canvas',
  zoom: 'Zoom',
  'vector-select': 'Path selection',
  'vector-direct-select': 'Direct selection',
  'vector-pen': 'Pen',
  'vector-add-anchor': 'Add anchor point',
  'vector-delete-anchor': 'Delete anchor point',
  'vector-convert-anchor': 'Convert anchor point',
  'shape-rectangle': 'Rectangle',
  'shape-ellipse': 'Ellipse',
  'shape-triangle': 'Triangle',
  'shape-line': 'Line',
  'text-point': 'Type tool',
  'text-paragraph': 'Paragraph text',
  'text-vertical': 'Vertical type tool',
  'text-path': 'Path text'
};

const TextFontPicker: React.FC<{
  readonly value: string;
  readonly fonts: readonly DocumentFontAsset[];
  readonly disabled?: boolean;
  readonly placeholder?: string;
  readonly onChange: (family: string) => void;
}> = ({ value, fonts, disabled = false, placeholder, onChange }) => {
  const anchorRef = React.useRef<HTMLButtonElement>(null);
  const searchRef = React.useRef<HTMLInputElement>(null);
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [position, setPosition] = React.useState({ left: 0, top: 0 });
  const groups = React.useMemo(() => ([
    ['Bundled', (font: DocumentFontAsset) => font.source === 'bundled'],
    ['Document', (font: DocumentFontAsset) => font.source !== 'bundled' && font.source !== 'system'],
    ['System', (font: DocumentFontAsset) => font.source === 'system']
  ] as const).map(([label, accepts]) => ({
    label,
    families: [...new Set(fonts.filter(accepts)
      .flatMap(({ familyNames }) => familyNames.slice(0, 1)))]
      .filter((family) => family.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  })).filter(({ families }) => families.length > 0), [fonts, query]);

  React.useLayoutEffect(() => {
    if (!open) return undefined;
    const update = () => {
      const bounds = anchorRef.current?.getBoundingClientRect();
      if (!bounds) return;
      setPosition({
        left: Math.max(8, Math.min(bounds.left, window.innerWidth - 252)),
        top: bounds.bottom + 3
      });
    };
    update();
    searchRef.current?.focus({ preventScroll: true });
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [open]);

  React.useEffect(() => {
    if (!open) return undefined;
    const close = (event: PointerEvent) => {
      const target = event.target as Node;
      if (anchorRef.current?.contains(target)
        || document.querySelector('.lighttable-font-picker__menu')?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  return <div className="lighttable-tool-options__field lighttable-tool-options__font-field">
    <span>Font</span>
    <button ref={anchorRef} type="button" className="lighttable-font-picker__trigger"
      disabled={disabled} aria-haspopup="listbox" aria-expanded={open}
      title={placeholder ?? value}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={() => { setQuery(''); setOpen((current) => !current); }}>
      <span>{placeholder ?? value}</span><span aria-hidden="true">▾</span>
    </button>
    {open ? createPortal(
      <div className="lighttable-font-picker__menu" style={position}
        data-editor-native-tab-navigation
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault(); setOpen(false); anchorRef.current?.focus();
            return;
          }
          navigateFontPicker(event);
        }}>
        <input ref={searchRef} type="search" value={query} placeholder="Search fonts"
          aria-label="Search fonts" onChange={(event) => setQuery(event.currentTarget.value)} />
        <div className="lighttable-font-picker__options" role="listbox" aria-label="Fonts">
          {groups.map((group) => <React.Fragment key={group.label}>
            <div className="lighttable-font-picker__group">{group.label}</div>
            {group.families.map((family) => <button key={`${group.label}:${family}`}
              type="button" role="option" aria-selected={family === value}
              className={family === value ? 'lighttable-font-picker__option lighttable-font-picker__option--selected'
                : 'lighttable-font-picker__option'}
              onClick={() => { onChange(family); setOpen(false); anchorRef.current?.focus(); }}>
              {family}
            </button>)}
          </React.Fragment>)}
          {groups.length === 0 ? <div className="lighttable-font-picker__empty">No matching fonts</div> : null}
        </div>
      </div>, document.body
    ) : null}
  </div>;
};

const TransformToolOptions: React.FC<{
  state: TransformSessionState;
  proportionsLinked: boolean;
  onProportionsLinkedChange: (linked: boolean) => void;
  onChange: (matrix: AffineMatrix) => void;
  onCommit?: () => void;
  onCancel?: () => void;
  textWarp?: TextWarp | null;
  onTextWarpChange?: (warp: TextWarp | null) => void;
  onTextWarpBegin?: () => void;
  onTextWarpCommit?: () => void;
  onTextWarpCancel?: () => void;
}> = ({
  state,
  proportionsLinked,
  onProportionsLinkedChange,
  onChange,
  onCommit,
  onCancel,
  textWarp,
  onTextWarpChange,
  onTextWarpBegin,
  onTextWarpCommit,
  onTextWarpCancel
}) => {
  const [referencePoint, setReferencePoint] = React.useState('center');
  const [skew, setSkew] = React.useState({ x: 0, y: 0 });
  const [customWarpPoint, setCustomWarpPoint] = React.useState(0);
  const bounds = transformedBounds(state.matrix, state.sourceBounds);
  const referenceColumn = referencePoint.endsWith('left') ? 0
    : referencePoint.endsWith('right') ? 1 : 0.5;
  const referenceRow = referencePoint.startsWith('top') ? 0
    : referencePoint.startsWith('bottom') ? 1 : 0.5;
  const reference = {
    x: bounds.x + bounds.width * referenceColumn,
    y: bounds.y + bounds.height * referenceRow
  };
  const scaleXPercent = Math.hypot(state.matrix.a, state.matrix.b) * 100;
  const scaleYPercent = Math.hypot(state.matrix.c, state.matrix.d) * 100;
  const rotationDegrees = Math.atan2(state.matrix.b, state.matrix.a) * 180 / Math.PI;
  const moveAxis = (axis: 'x' | 'y', value: number) => onChange(multiplyMatrices(
    translationMatrix(axis === 'x' ? value - bounds.x : 0, axis === 'y' ? value - bounds.y : 0),
    state.matrix
  ));
  const setScale = (axis: 'x' | 'y', percent: number) => {
    const requested = Math.max(0.01, Math.abs(percent || 0.01));
    const current = axis === 'x' ? scaleXPercent : scaleYPercent;
    const ratio = requested / Math.max(0.01, current);
    onChange(multiplyMatrices(
      aroundPoint(scaleMatrix(
        axis === 'x' || proportionsLinked ? ratio : 1,
        axis === 'y' || proportionsLinked ? ratio : 1
      ), reference),
      state.matrix
    ));
  };
  const setSkewAxis = (axis: 'x' | 'y', degrees: number) => {
    const previous = skew[axis];
    const delta = (degrees - previous) * Math.PI / 180;
    const shear: AffineMatrix = axis === 'x'
      ? { a: 1, b: 0, c: Math.tan(delta), d: 1, tx: 0, ty: 0 }
      : { a: 1, b: Math.tan(delta), c: 0, d: 1, tx: 0, ty: 0 };
    setSkew((current) => ({ ...current, [axis]: degrees }));
    onChange(multiplyMatrices(aroundPoint(shear, reference), state.matrix));
  };
  const setWarpStyle = (style: 'none' | TextWarpStyle) => {
    if (!onTextWarpChange) return;
    if (style === 'none') { onTextWarpChange(null); return; }
    if (textWarp?.style === style) return;
    const source = state.sourceContentBounds;
    onTextWarpChange({
      style, bend: textWarp?.bend ?? 0,
      horizontalDistortion: textWarp?.horizontalDistortion ?? 0,
      verticalDistortion: textWarp?.verticalDistortion ?? 0,
      orientation: textWarp?.orientation ?? 'horizontal',
      bounds: textWarp?.bounds ?? { ...source },
      ...(style === 'custom' ? { mesh: textWarp?.mesh ?? {
        rows: 2, columns: 2, points: [
          { x: source.x, y: source.y }, { x: source.x + source.width, y: source.y },
          { x: source.x, y: source.y + source.height },
          { x: source.x + source.width, y: source.y + source.height }
        ]
      } } : {})
    });
  };
  const patchWarp = (patch: Partial<TextWarp>) => {
    if (textWarp && onTextWarpChange) onTextWarpChange({ ...textWarp, ...patch });
  };
  const patchCustomWarpPoint = (axis: 'x' | 'y', value: number) => {
    if (textWarp?.style !== 'custom' || !textWarp.mesh) return;
    const index = Math.max(0, Math.min(textWarp.mesh.points.length - 1, customWarpPoint));
    const points = textWarp.mesh.points.map((point, pointIndex) => pointIndex === index
      ? { ...point, [axis]: value }
      : point);
    patchWarp({ mesh: { ...textWarp.mesh, points } });
  };
  const warpNumberGesture = {
    onFocus: onTextWarpBegin,
    onBlur: onTextWarpCommit,
    onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onTextWarpCancel?.();
      event.currentTarget.blur();
    }
  };
  return (
    <div className="lighttable-tool-options__vector-style" aria-label="Free Transform properties">
      <ToolOptionSelect label="Reference" value={referencePoint} aria-label="Transform reference point"
        onChange={(event) => setReferencePoint(event.currentTarget.value)}>
        <option value="top-left">Top left</option>
        <option value="top-center">Top center</option>
        <option value="top-right">Top right</option>
        <option value="middle-left">Middle left</option>
        <option value="center">Center</option>
        <option value="middle-right">Middle right</option>
        <option value="bottom-left">Bottom left</option>
        <option value="bottom-center">Bottom center</option>
        <option value="bottom-right">Bottom right</option>
      </ToolOptionSelect>
      <ToolOptionNumber label="X" unit="px" step={1} value={Number(bounds.x.toFixed(2))}
        onChange={(value) => moveAxis('x', value)} />
      <ToolOptionNumber label="Y" unit="px" step={1} value={Number(bounds.y.toFixed(2))}
        onChange={(value) => moveAxis('y', value)} />
      <ToolOptionNumber label="W" unit="%" min={0.01} step={0.1}
        value={Number(scaleXPercent.toFixed(2))} onChange={(value) => setScale('x', value)} />
      <label className="lighttable-tool-options__toggle" title="Link width and height">
        <input type="checkbox" checked={proportionsLinked}
          aria-label="Link transform proportions"
          onChange={(event) => onProportionsLinkedChange(event.currentTarget.checked)} />
        <span>Link</span>
      </label>
      <ToolOptionNumber label="H" unit="%" min={0.01} step={0.1}
        value={Number(scaleYPercent.toFixed(2))} onChange={(value) => setScale('y', value)} />
      <ToolOptionNumber label="Angle" unit="deg" step={0.1}
        value={Number(rotationDegrees.toFixed(2))}
        onChange={(value) => onChange(multiplyMatrices(
          aroundPoint(rotationMatrix((value - rotationDegrees) * Math.PI / 180), reference),
          state.matrix
        ))} />
      <ToolOptionNumber label="Skew X" unit="deg" step={0.1} value={skew.x}
        onChange={(value) => setSkewAxis('x', value)} />
      <ToolOptionNumber label="Skew Y" unit="deg" step={0.1} value={skew.y}
        onChange={(value) => setSkewAxis('y', value)} />
      <ToolOptionSelect label="Interpolation" defaultValue="automatic"
        aria-label="Transform interpolation" disabled={state.previewKind === 'semantic'}>
        <option value="automatic">Automatic</option>
      </ToolOptionSelect>
      {textWarp !== undefined ? <>
        <ToolOptionSelect label="Warp" value={textWarp?.style ?? 'none'} aria-label="Text warp preset"
          onChange={(event) => setWarpStyle(event.currentTarget.value as 'none' | TextWarpStyle)}>
          <option value="none">None</option>
          {([
            ['arc', 'Arc'], ['arc-lower', 'Arc Lower'], ['arc-upper', 'Arc Upper'], ['arch', 'Arch'],
            ['bulge', 'Bulge'], ['shell-lower', 'Shell Lower'], ['shell-upper', 'Shell Upper'],
            ['flag', 'Flag'], ['wave', 'Wave'], ['fish', 'Fish'], ['rise', 'Rise'],
            ['fisheye', 'Fisheye'], ['inflate', 'Inflate'], ['squeeze', 'Squeeze'],
            ['twist', 'Twist'], ['cylinder', 'Cylinder'], ['custom', 'Custom grid']
          ] as const).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </ToolOptionSelect>
        {textWarp ? <>
          <ToolOptionNumber label="Bend" unit="%" min={-100} max={100} step={1}
            {...warpNumberGesture} value={textWarp.bend} onChange={(bend) => patchWarp({ bend })} />
          <ToolOptionNumber label="Warp H" unit="%" min={-100} max={100} step={1}
            {...warpNumberGesture}
            value={textWarp.horizontalDistortion}
            onChange={(horizontalDistortion) => patchWarp({ horizontalDistortion })} />
          <ToolOptionNumber label="Warp V" unit="%" min={-100} max={100} step={1}
            {...warpNumberGesture}
            value={textWarp.verticalDistortion}
            onChange={(verticalDistortion) => patchWarp({ verticalDistortion })} />
          <ToolOptionSelect label="Warp orientation" value={textWarp.orientation}
            onChange={(event) => patchWarp({ orientation: event.currentTarget.value as 'horizontal' | 'vertical' })}>
            <option value="horizontal">Horizontal</option><option value="vertical">Vertical</option>
          </ToolOptionSelect>
          {textWarp.style === 'custom' && textWarp.mesh ? <>
            <ToolOptionNumber label="Grid point" min={1} max={textWarp.mesh.points.length} step={1}
              value={Math.min(customWarpPoint, textWarp.mesh.points.length - 1) + 1}
              onChange={(value) => setCustomWarpPoint(Math.max(0, Math.min(
                textWarp.mesh!.points.length - 1, Math.round(value) - 1
              )))} />
            <ToolOptionNumber label="Point X" unit="px" step={0.1}
              {...warpNumberGesture}
              value={textWarp.mesh.points[Math.min(customWarpPoint, textWarp.mesh.points.length - 1)]?.x ?? 0}
              onChange={(value) => patchCustomWarpPoint('x', value)} />
            <ToolOptionNumber label="Point Y" unit="px" step={0.1}
              {...warpNumberGesture}
              value={textWarp.mesh.points[Math.min(customWarpPoint, textWarp.mesh.points.length - 1)]?.y ?? 0}
              onChange={(value) => patchCustomWarpPoint('y', value)} />
          </> : null}
        </> : null}
      </> : null}
      <button type="button" className="lighttable-tool-options__preset" onClick={onCommit}>Apply</button>
      <button type="button" className="lighttable-tool-options__preset" onClick={onCancel}>Cancel</button>
    </div>
  );
};

export const ToolOptionsContent: React.FC<ToolOptionsProps & {
  orientation?: 'horizontal' | 'vertical';
}> = ({
  activeTool,
  brush,
  gradient,
  shape,
  pen,
  warp,
  vectorStyle,
  text,
  textFonts,
  textProperties,
  textLayoutMode,
  selectedVectorStyle,
  selectedShape,
  selectedShapeKind,
  selectionPixelSnap,
  selectionCombineMode,
  selectionRowHeight,
  selectionColumnWidth,
  zoomPercent,
  transformState,
  textWarp,
  onBrushChange,
  onGradientChange,
  onShapeChange,
  onPenChange,
  onWarpChange,
  onVectorStyleChange,
  onTextChange,
  onTextFontAssetChange,
  onTextSizeChange,
  onTextFillChange,
  onTextFillPaintChange,
  onTextFillEnabledChange,
  onTextStrokeColorChange,
  onTextStrokeWidthChange,
  onTextAlignmentChange,
  onTextWritingModeChange,
  onTextPropertyBegin,
  onTextPropertyCommit,
  onTextPropertyCancel,
  onTextLayoutModeChange,
  onSelectedVectorStyleChange,
  onSelectedShapeChange,
  onWarpReset,
  onSelectionPixelSnapChange,
  onSelectionCombineModeChange,
  onSelectionRowHeightChange,
  onSelectionColumnWidthChange,
  onZoomPreset,
  onZoomFit,
  onTransformChange,
  onTransformCommit,
  onTransformCancel,
  onTextWarpChange,
  onTextWarpBegin,
  onTextWarpCommit,
  onTextWarpCancel,
  orientation = 'horizontal'
}) => {
  const activeToolDefinition = toolDefinition(activeTool);
  const vectorStyleToolActive = activeTool.startsWith('vector-') || activeTool.startsWith('shape-');
  const editsVectorSelection = vectorStyleToolActive && Boolean(selectedVectorStyle);
  const presentedVectorStyle = editsVectorSelection ? selectedVectorStyle! : vectorStyle;
  const presentedShape = selectedShape ?? shape;
  const changeShape = selectedShape && onSelectedShapeChange
    ? onSelectedShapeChange : onShapeChange;
  const shapeGeometryActive = activeTool === 'shape-rectangle'
    || activeTool === 'shape-ellipse'
    || activeTool === 'shape-line'
    || (activeTool !== 'gradient' && Boolean(selectedShapeKind));
  const rectangleGeometryActive = selectedShapeKind
    ? selectedShapeKind === 'rectangle' : activeTool === 'shape-rectangle';
  const [gradientEditorOpen, setGradientEditorOpen] = React.useState(false);
  const gradientButtonRef = React.useRef<HTMLButtonElement>(null);
  const presentedTextGradient = textProperties?.fillPaint?.kind === 'value'
    && textProperties.fillPaint.value?.kind === 'gradient'
    ? textProperties.fillPaint.value : null;
  const [textGradientEditorOpen, setTextGradientEditorOpen] = React.useState(false);
  const [transformProportionsLinked, setTransformProportionsLinked] = React.useState(true);
  const textGradientButtonRef = React.useRef<HTMLButtonElement>(null);
  const changeVectorStyle = editsVectorSelection
    ? onSelectedVectorStyleChange ?? onVectorStyleChange
    : onVectorStyleChange;
  const presentedTextFamily = textProperties?.family.kind === 'value'
    ? textProperties.family.value : text.family;

  const releaseCompletedSelect = (event: React.ChangeEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement)) return;

    // A tool-mode choice is a completed command, not an ongoing text-editing
    // session. Returning focus immediately keeps document shortcuts such as
    // the shared brush-size [ / ] bindings available after the choice.
    target.blur();
  };

  return (
    <div
      className={`lighttable-tool-options__content lighttable-tool-options__content--${orientation}`}
      onChange={releaseCompletedSelect}
    >
      <div className="lighttable-tool-options__identity">
        <img src={lightTableIcon(activeToolDefinition.iconName)} alt="" aria-hidden="true" />
        <strong>{activeTool === 'warp'
          ? `Warp - ${warp.mode === 'twirl-cw'
            ? 'Twirl clockwise'
            : warp.mode === 'twirl-ccw'
              ? 'Twirl counter-clockwise'
              : warp.mode[0]!.toUpperCase() + warp.mode.slice(1)}`
          : TOOL_LABELS[activeTool]}</strong>
      </div>
      {isSelectionTool(activeTool) ? (
        <SegmentedControl
          className="lighttable-tool-options__selection-mode"
          ariaLabel="Selection combine mode"
          value={selectionCombineMode}
          onChange={onSelectionCombineModeChange}
          options={[
            { value: 'replace', label: 'New', title: 'New selection' },
            { value: 'add', label: 'Add', title: 'Add to selection' },
            { value: 'subtract', label: 'Subtract', title: 'Subtract from selection' },
            { value: 'intersect', label: 'Intersect', title: 'Intersect with selection' }
          ]}
        />
      ) : null}
      {activeTool === 'transform' && transformState && onTransformChange ? (
        <TransformToolOptions
          state={transformState}
          proportionsLinked={transformProportionsLinked}
          onProportionsLinkedChange={setTransformProportionsLinked}
          onChange={onTransformChange}
          onCommit={onTransformCommit}
          onCancel={onTransformCancel}
          textWarp={textWarp}
          onTextWarpChange={onTextWarpChange}
          onTextWarpBegin={onTextWarpBegin}
          onTextWarpCommit={onTextWarpCommit}
          onTextWarpCancel={onTextWarpCancel}
        />
      ) : null}
      {activeTool === 'vector-pen' ? (
        <div className="lighttable-tool-options__vector-style" aria-label="Pen settings">
          <label className="lighttable-tool-options__toggle">
            <input type="checkbox" checked={pen.autoAddDelete}
              onChange={(event) => onPenChange({ autoAddDelete: event.currentTarget.checked })} />
            <span>Auto Add/Delete</span>
          </label>
          <label className="lighttable-tool-options__toggle">
            <input type="checkbox" checked={pen.rubberBand}
              onChange={(event) => onPenChange({ rubberBand: event.currentTarget.checked })} />
            <span>Rubber Band</span>
          </label>
        </div>
      ) : null}
      {activeTool === 'select-rectangle' || activeTool === 'select-ellipse' ? (
        <label className="lighttable-tool-options__toggle">
          <input
            type="checkbox"
            checked={selectionPixelSnap}
            onChange={(event) => onSelectionPixelSnapChange(event.currentTarget.checked)}
          />
          Snap to pixels
        </label>
      ) : null}
      {activeTool === 'select-horizontal' || activeTool === 'select-vertical' ? (
        <label className="lighttable-tool-options__weight-field">
          <span>{activeTool === 'select-horizontal' ? 'Height' : 'Width'}</span>
          <input
            type="number"
            min={1}
            max={10000}
            step={1}
            value={activeTool === 'select-horizontal'
              ? selectionRowHeight
              : selectionColumnWidth}
            onChange={(event) => {
              const size = Math.max(1, Math.round(Number(event.currentTarget.value) || 1));
              if (activeTool === 'select-horizontal') onSelectionRowHeightChange(size);
              else onSelectionColumnWidthChange(size);
            }}
          />
          <span>px</span>
        </label>
      ) : null}
      {activeTool === 'gradient' ? (
        <div className="lighttable-tool-options__vector-style" aria-label="Gradient settings">
          <ToolOptionSelect label="Apply" value={gradient.application}
            aria-label="Gradient application"
            onChange={(event) => onGradientChange({
              application: event.currentTarget.value as EditorSession['gradient']['application']
            })}>
            <option value="fill-layer">Fill layer</option>
            <option value="pixels">Pixels</option>
          </ToolOptionSelect>
          <button
            ref={gradientButtonRef}
            type="button"
            className="lighttable-tool-options__gradient-button"
            aria-label="Edit gradient"
            title="Edit gradient"
            onClick={() => setGradientEditorOpen((open) => !open)}
          >Gradient</button>
          {gradientEditorOpen ? (
            <AnchoredGradientPopover anchor={gradientButtonRef} ariaLabel="Gradient editor">
              <div className="lighttable-tool-options__gradient-header">
                <strong>Gradient</strong>
                <button type="button" aria-label="Close gradient"
                  onClick={() => setGradientEditorOpen(false)}>×</button>
              </div>
              <GradientAssetEditor
                value={gradient.paint.asset}
                onChange={(asset) => onGradientChange({
                  paint: { ...gradient.paint, asset }
                })}
              />
            </AnchoredGradientPopover>
          ) : null}
          <ToolOptionSelect label="Type" value={gradient.paint.shape}
            aria-label="Gradient type"
            onChange={(event) => onGradientChange({ paint: {
              ...gradient.paint,
              shape: event.currentTarget.value as GradientPaintInstance['shape']
            } })}>
            <option value="linear">Linear</option>
            <option value="radial">Radial</option>
            <option value="angle">Angle</option>
            <option value="reflected">Reflected</option>
            <option value="diamond">Diamond</option>
          </ToolOptionSelect>
          <label className="lighttable-tool-options__toggle">
            <input type="checkbox" checked={gradient.paint.reverse}
              aria-label="Reverse gradient"
              onChange={(event) => onGradientChange({ paint: {
                ...gradient.paint, reverse: event.currentTarget.checked
              } })} />
            <span>Reverse</span>
          </label>
          <label className="lighttable-tool-options__toggle">
            <input type="checkbox" checked={gradient.paint.dither}
              aria-label="Dither gradient"
              onChange={(event) => onGradientChange({ paint: {
                ...gradient.paint, dither: event.currentTarget.checked
              } })} />
            <span>Dither</span>
          </label>
          <ToolOptionSelect label="Method" value={gradient.paint.interpolation}
            aria-label="Gradient interpolation"
            onChange={(event) => onGradientChange({ paint: {
              ...gradient.paint,
              interpolation: event.currentTarget.value as GradientPaintInstance['interpolation']
            } })}>
            <option value="perceptual">Perceptual</option>
            <option value="linear">Linear</option>
            <option value="classic">Classic</option>
            <option value="smooth">Smooth</option>
          </ToolOptionSelect>
        </div>
      ) : null}
      {shapeGeometryActive ? (
        <div className="lighttable-tool-options__vector-style" aria-label="Shape geometry">
          <ToolOptionSelect label="Mode" value={shape.mode}
            aria-label="Shape application mode"
            onChange={(event) => onShapeChange({
              mode: event.currentTarget.value as EditorSession['shape']['mode']
            })}>
            <option value="shape">Shape</option>
            <option value="pixels">Pixels</option>
          </ToolOptionSelect>
          <ToolOptionSelect label="Geometry" value={presentedShape.geometry}
            aria-label="Shape geometry mode"
            onChange={(event) => changeShape({
              geometry: event.currentTarget.value as EditorSession['shape']['geometry']
            })}>
            <option value="unrestricted">Unrestricted</option>
            <option value="fixed">Fixed size</option>
            <option value="proportional">Proportional</option>
          </ToolOptionSelect>
          <ToolOptionNumber label="W" unit="px" min={0.01} max={100000} step={1}
            value={presentedShape.width}
            onChange={(width) => changeShape({ width: Math.max(0.01, width || 0.01) })} />
          <ToolOptionNumber label="H" unit="px" min={0.01} max={100000} step={1}
            value={presentedShape.height}
            onChange={(height) => changeShape({ height: Math.max(0.01, height || 0.01) })} />
          <label className="lighttable-tool-options__toggle">
            <input type="checkbox" checked={presentedShape.fromCenter}
              onChange={(event) => changeShape({ fromCenter: event.currentTarget.checked })} />
            <span>From center</span>
          </label>
          <label className="lighttable-tool-options__toggle">
            <input type="checkbox" checked={presentedShape.snapToPixels}
              onChange={(event) => changeShape({ snapToPixels: event.currentTarget.checked })} />
            <span>Snap pixels</span>
          </label>
          {rectangleGeometryActive ? (
            <>
              <label className="lighttable-tool-options__toggle">
                <input type="checkbox" checked={presentedShape.linkedCorners}
                  aria-label="Link rectangle corners"
                  onChange={(event) => changeShape({ linkedCorners: event.currentTarget.checked })} />
                <span>Link corners</span>
              </label>
              {presentedShape.rectangleCornerRadii.map((radius, index) => presentedShape.linkedCorners && index > 0 ? null : (
                <ToolOptionNumber key={index} label={presentedShape.linkedCorners ? 'Radius' : `R${index + 1}`}
                  unit="px" min={0} max={100000} step={1} value={radius}
                  onChange={(value) => {
                    const next = Math.max(0, value || 0);
                    changeShape({ rectangleCornerRadii: presentedShape.linkedCorners
                      ? [next, next, next, next]
                      : presentedShape.rectangleCornerRadii.map((current, corner) => (
                          corner === index ? next : current
                        )) as [number, number, number, number] });
                  }} />
              ))}
            </>
          ) : null}
          {(selectedShapeKind ? selectedShapeKind === 'line' : activeTool === 'shape-line') ? (
            <>
              <ToolOptionNumber label="Angle" unit="deg" min={-360} max={360} step={1}
                value={presentedShape.lineRotationDegrees}
                onChange={(lineRotationDegrees) => changeShape({ lineRotationDegrees })} />
              <div className="lighttable-tool-options__line-ends" role="group" aria-label="Arrowheads">
                <button type="button" aria-label="Start arrowhead"
                  aria-pressed={presentedShape.lineStartArrow}
                  onClick={() => changeShape({ lineStartArrow: !presentedShape.lineStartArrow })}>
                  <img src={lightTableIcon('arrow-left.png')} alt="" aria-hidden />
                </button>
                <button type="button" aria-label="No arrowheads"
                  aria-pressed={!presentedShape.lineStartArrow && !presentedShape.lineEndArrow}
                  onClick={() => changeShape({ lineStartArrow: false, lineEndArrow: false })}>
                  <img src={lightTableIcon('horizontal-line.png')} alt="" aria-hidden />
                </button>
                <button type="button" aria-label="End arrowhead"
                  aria-pressed={presentedShape.lineEndArrow}
                  onClick={() => changeShape({ lineEndArrow: !presentedShape.lineEndArrow })}>
                  <img src={lightTableIcon('arrow-right.png')} alt="" aria-hidden />
                </button>
              </div>
              <ToolOptionNumber label="Arrow W" unit="px" min={0} max={10000} step={1}
                value={presentedShape.lineArrowWidth}
                onChange={(lineArrowWidth) => changeShape({ lineArrowWidth: Math.max(0, lineArrowWidth) })} />
              <ToolOptionNumber label="Arrow L" unit="px" min={0} max={10000} step={1}
                value={presentedShape.lineArrowLength}
                onChange={(lineArrowLength) => changeShape({ lineArrowLength: Math.max(0, lineArrowLength) })} />
            </>
          ) : null}
        </div>
      ) : null}
      {activeTool === 'zoom' ? (
        <div className="lighttable-tool-options__zoom-presets" aria-label="Zoom presets">
          {ZOOM_PRESETS_PERCENT.map((percent) => (
            <button
              key={percent}
              type="button"
              className={
                Math.abs(zoomPercent - percent) < 0.01
                  ? 'lighttable-tool-options__preset lighttable-tool-options__preset--active'
                  : 'lighttable-tool-options__preset'
              }
              onClick={() => onZoomPreset(percent)}
            >
              {percent}%
            </button>
          ))}
          <button
            type="button"
            className="lighttable-tool-options__preset"
            onClick={onZoomFit}
          >
            Fit screen
          </button>
        </div>
      ) : null}
      {activeTool === 'warp' ? (
        <WarpToolOptions
          warp={warp}
          onChange={onWarpChange}
          onReset={onWarpReset}
        />
      ) : null}
      {activeTool === 'text-point' || activeTool === 'text-paragraph'
        || activeTool === 'text-vertical' || activeTool === 'text-path' ? (
        <div className="lighttable-tool-options__text" aria-label="Text settings">
          {textLayoutMode && onTextLayoutModeChange ? (
            <SegmentedControl
              className="lighttable-tool-options__text-layout-mode"
              ariaLabel="Text layout mode"
              value={textLayoutMode}
              onChange={onTextLayoutModeChange}
              options={[
                { value: 'point', label: 'Point', title: 'Convert to point text' },
                { value: 'paragraph', label: 'Paragraph', title: 'Convert to paragraph text' }
              ]}
            />
          ) : null}
          {textProperties && onTextWritingModeChange ? (
            <ToolOptionSelect label="Orientation"
              value={textProperties.writingMode.kind === 'value'
                ? textProperties.writingMode.value : ''}
              disabled={textProperties.writingMode.kind === 'unavailable'}
              onChange={(event) => onTextWritingModeChange(event.currentTarget.value as
                'horizontal-tb' | 'vertical-rl' | 'vertical-lr')}>
              <option value="horizontal-tb">Horizontal</option>
              <option value="vertical-rl">Vertical</option>
              <option value="vertical-lr">Vertical LTR</option>
            </ToolOptionSelect>
          ) : null}
          <TextFontPicker
            value={presentedTextFamily}
            fonts={textFonts}
            placeholder={textProperties?.family.kind === 'mixed' ? 'Mixed'
              : textProperties?.family.kind === 'unavailable' ? 'Unavailable' : undefined}
            disabled={textProperties?.family.kind === 'unavailable'}
            onChange={(family) => {
              if (!textProperties || !onTextFontAssetChange) {
                onTextChange({ family }); return;
              }
              const matches = textFonts.filter((font) => font.familyNames.includes(family));
              const asset = matches.find((font) => font.styleName === 'Regular') ?? matches[0];
              if (asset) onTextFontAssetChange(asset.assetId);
            }}
          />
          <ToolOptionSelect
            label="Style"
            value={textProperties?.face.kind === 'mixed' ? ''
              : textProperties?.face.kind === 'unavailable' ? ''
                : textProperties?.face.kind === 'value' ? textProperties.face.value : text.style}
            disabled={textProperties?.face.kind === 'unavailable'}
            onChange={(event) => {
              if (!textProperties || !onTextFontAssetChange) {
                onTextChange({ style: event.currentTarget.value }); return;
              }
              onTextFontAssetChange(event.currentTarget.value);
            }}
          >
            {textProperties?.face.kind === 'mixed' ? <option value="" disabled>Mixed</option> : null}
            {textProperties?.face.kind === 'unavailable' ? <option value="">Unavailable</option> : null}
            {[...new Set(textFonts
              .filter(({ familyNames }) => familyNames.includes(presentedTextFamily))
              .map(({ assetId }) => assetId))]
              .map((assetId) => {
                const font = textFonts.find((entry) => entry.assetId === assetId)!;
                return <option key={assetId} value={assetId}>{font.styleName}</option>;
              })}
          </ToolOptionSelect>
          {textProperties && onTextSizeChange && onTextPropertyBegin
            && onTextPropertyCommit && onTextPropertyCancel ? (
            <MixedNumberInput label="Size" value={textProperties.size} min={1} max={1296}
              step={1} unit="px" onBegin={onTextPropertyBegin} onPreview={onTextSizeChange}
              onCommit={onTextPropertyCommit} onCancel={onTextPropertyCancel} />
          ) : <ToolOptionNumber
            label="Size"
            min={1}
            max={1296}
            step={1}
            value={text.size}
            onChange={(value) => onTextChange({
              size: Math.max(1, Math.min(1296, value || 1))
            })}
            unit="px"
          />}
          {onTextFillChange ? (
            <ToolOptionColor
              label="Fill"
              value={textProperties?.fill.kind === 'value'
                ? textProperties.fill.value
                : textProperties ? '#000000' : brush.color}
              onFocus={onTextPropertyBegin}
              enabled={textProperties?.fillEnabled.kind === 'value'
                ? textProperties.fillEnabled.value : text.fillEnabled}
              onEnabledChange={onTextFillEnabledChange}
              onChange={onTextFillChange}
              onBlur={onTextPropertyCommit}
              onCancel={onTextPropertyCancel}
              status={presentedTextGradient ? (
                <button ref={textGradientButtonRef} type="button" className="lighttable-tool-options__gradient-button"
                  aria-label="Edit text fill gradient" title="Edit text fill gradient"
                  onClick={() => setTextGradientEditorOpen((open) => !open)}>Gradient</button>
              ) : textProperties && textProperties.fill.kind !== 'value' ? (
                <em>{textProperties.fill.kind === 'mixed' ? 'Mixed' : 'Non-solid / unsupported'}</em>
              ) : null}
            />
          ) : null}
          {presentedTextGradient && textGradientEditorOpen && onTextFillPaintChange ? (
            <AnchoredGradientPopover anchor={textGradientButtonRef} ariaLabel="Text fill gradient"
              onPointerDownCapture={() => onTextPropertyBegin?.()}
              onPointerUpCapture={() => onTextPropertyCommit?.()}>
              <div className="lighttable-tool-options__gradient-header">
                <strong>Text fill gradient</strong>
                <button type="button" aria-label="Close text fill gradient"
                  onClick={() => setTextGradientEditorOpen(false)}>×</button>
              </div>
              <GradientAssetEditor value={presentedTextGradient.asset}
                onChange={(asset) => onTextFillPaintChange({ ...presentedTextGradient, asset })} />
              <div className="lighttable-tool-options__gradient-options">
                <ToolOptionSelect label="Style" value={presentedTextGradient.shape}
                  aria-label="Text gradient style"
                  onChange={(event) => onTextFillPaintChange({
                    ...presentedTextGradient,
                    shape: event.currentTarget.value as GradientPaintInstance['shape']
                  })}>
                  <option value="linear">Linear</option><option value="radial">Radial</option>
                  <option value="angle">Angle</option><option value="reflected">Reflected</option>
                  <option value="diamond">Diamond</option>
                </ToolOptionSelect>
              </div>
            </AnchoredGradientPopover>
          ) : null}
          {textProperties && onTextStrokeColorChange ? (
            <ToolOptionColor
              label="Line"
              value={textProperties.strokeColor.kind === 'value'
                ? textProperties.strokeColor.value : '#000000'}
              ariaLabel="Text line"
              onFocus={onTextPropertyBegin}
              onChange={onTextStrokeColorChange}
              onBlur={onTextPropertyCommit}
              onCancel={onTextPropertyCancel}
              status={textProperties.strokeColor.kind !== 'value' ? (
                <em>{textProperties.strokeColor.kind === 'mixed' ? 'Mixed' : 'Non-solid / unsupported'}</em>
              ) : null}
            />
          ) : null}
          {textProperties && onTextStrokeWidthChange && onTextPropertyBegin
            && onTextPropertyCommit && onTextPropertyCancel ? (
            <MixedNumberInput label="Weight" value={textProperties.strokeWidth} min={0}
              max={100000} step={0.5} unit="px" onBegin={onTextPropertyBegin}
              onPreview={onTextStrokeWidthChange} onCommit={onTextPropertyCommit}
              onCancel={onTextPropertyCancel} />
          ) : null}
          <label className="lighttable-tool-options__field">
            <span>Antialias</span>
            <select defaultValue={text.antiAlias} disabled aria-label="Text antialias mode">
              <option value="smooth">Smooth</option>
            </select>
          </label>
          <ToolOptionSelect
            label="Align"
            value={textProperties?.alignment.kind === 'value'
              ? textProperties.alignment.value
              : textProperties ? '' : text.alignment}
            disabled={textProperties?.alignment.kind === 'unavailable'}
            aria-label="Text alignment"
            onChange={(event) => {
              const alignment = event.currentTarget.value as TextToolSettings['alignment'];
              if (textProperties && onTextAlignmentChange) onTextAlignmentChange(alignment);
              else onTextChange({ alignment });
            }}
          >
            {textProperties?.alignment.kind === 'mixed' ? <option value="" disabled>Mixed</option> : null}
            {textProperties?.alignment.kind === 'unavailable' ? <option value="">Unavailable</option> : null}
            <option value="start">Left</option>
            <option value="center">Center</option>
            <option value="end">Right</option>
            <option value="justify">Justify</option>
          </ToolOptionSelect>
        </div>
      ) : null}
      {activeTool === 'vector-pen' || activeTool.startsWith('shape-') || editsVectorSelection ? (
        <VectorStyleToolOptions activeTool={activeTool} style={presentedVectorStyle}
          onChange={changeVectorStyle} />
      ) : null}
      {activeTool === 'brush' || activeTool === 'erase' ? (
        <>
          <AdjustmentSlider
          label="Size"
          value={brush.size}
          min={1}
          max={1000}
          resetValue={48}
          onReset={() => onBrushChange({ size: 48 })}
          onChange={(size) => onBrushChange({ size })}
          />
          <AdjustmentSlider
          label="Hardness"
          value={brush.hardness * 100}
          min={0}
          max={100}
          resetValue={75}
          format={(value) => `${Math.round(value)}%`}
          onReset={() => onBrushChange({ hardness: 0.75 })}
          onChange={(value) => onBrushChange({ hardness: value / 100 })}
          />
          <AdjustmentSlider
          label="Opacity"
          value={brush.opacity * 100}
          min={1}
          max={100}
          resetValue={100}
          format={(value) => `${Math.round(value)}%`}
          onReset={() => onBrushChange({ opacity: 1 })}
          onChange={(value) => onBrushChange({ opacity: value / 100 })}
          />
          <AdjustmentSlider
          label="Flow"
          value={brush.flow * 100}
          min={1}
          max={100}
          resetValue={35}
          format={(value) => `${Math.round(value)}%`}
          onReset={() => onBrushChange({ flow: 0.35 })}
          onChange={(value) => onBrushChange({ flow: value / 100 })}
          />
          <AdjustmentSlider
          label="Spacing"
          value={brush.spacing * 100}
          min={1}
          max={100}
          resetValue={5}
          format={(value) => `${Math.round(value)}%`}
          onReset={() => onBrushChange({ spacing: 0.05 })}
          onChange={(value) => onBrushChange({ spacing: value / 100 })}
          />
        </>
      ) : null}
    </div>
  );
};

export const ToolOptionsBar: React.FC<ToolOptionsProps> = (props) => (
  <section className="lighttable-tool-options" aria-label="Tool settings">
    <ToolOptionsContent {...props} />
  </section>
);
