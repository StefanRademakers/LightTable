import React, { type ChangeEvent, type RefObject } from 'react';
import { SquareIconButton } from '../../../ui/SquareIconButton';
import type { ContextMenuOption } from '../../../ui/ContextMenu';
import { lightTableIcon } from '../../../assets/icons';
import type { EditorMenuId } from '../menus/createEditorMenuOptions';
import type { EditorSession, ToolId } from '../session/editorSession';
import { EditorMenuBar } from './EditorMenuBar';
import { EditorToolbar } from './EditorToolbar';
import { ToolOptionsBar } from './ToolOptionsBar';
import type { EditorScreenMode } from '../workspace/editorScreenMode';
import type { TextPropertyPresentation } from '../../application/text/textPropertyPresentation';
import type { TextPaint } from '@lighttable/text-core';
import type { FaceWarpToolOptionsProps } from '../../application/tools/faceWarp/FaceWarpToolOptions';
import type {
  SmartSelectionBackendIdentity,
  SmartSelectionPreparationState
} from '../../application/tools/smartSelection/SmartSelectionBackend';

export interface LightTableEditorShellProps {
  workspaceDocumentKind?: 'image' | 'video' | 'model-3d';
  screenMode: EditorScreenMode;
  active: boolean;
  saving: boolean;
  recoveryNotice?: string | null;
  projectName?: string;
  onRevealProject?: () => void;
  onClose: () => void;
  menuOptionsFor: (menuId: EditorMenuId) => Array<ContextMenuOption<string>>;
  activeTool: ToolId;
  brush: EditorSession['brush'];
  sampledBrush: EditorSession['sampledBrush'];
  toneBrush: EditorSession['toneBrush'];
  gradient: EditorSession['gradient'];
  shape: EditorSession['shape'];
  pen: EditorSession['pen'];
  warp: EditorSession['warp'];
  vectorStyle: EditorSession['vectorStyle'];
  text: EditorSession['text'];
  textFonts: readonly import('../document/documentTypes').DocumentFontAsset[];
  textProperties?: TextPropertyPresentation | null;
  textLayoutMode?: 'point' | 'paragraph' | null;
  selectedVectorStyle: EditorSession['vectorStyle'] | null;
  selectedShape: EditorSession['shape'] | null;
  selectedShapeKind: 'rectangle' | 'ellipse' | 'line' | null;
  selectionPixelSnap: boolean;
  selectionCombineMode: EditorSession['selectionCombineMode'];
  selectionFeather: number;
  selectionAntiAlias: boolean;
  selectionMarqueeStyle: EditorSession['selectionMarqueeStyle'];
  selectionMarqueeWidth: number;
  selectionMarqueeHeight: number;
  selectionRowHeight: number;
  selectionColumnWidth: number;
  selectionSmooth: number;
  magicWand: EditorSession['magicWand'];
  smartSelection: EditorSession['smartSelection'];
  smartSelectionBackendIdentity?: SmartSelectionBackendIdentity | null;
  smartSelectionPreparation?: SmartSelectionPreparationState;
  transformAutoSelectLayer: boolean;
  zoomPercent: number;
  gradientEditorRequest?: { readonly revision: number; readonly endpoint: 'start' | 'end' } | null;
  onBrushChange: (change: Partial<EditorSession['brush']>) => void;
  onSampledBrushChange: (change: Partial<EditorSession['sampledBrush']>) => void;
  onToneBrushChange: (change: Partial<EditorSession['toneBrush']>) => void;
  onGradientChange: (change: Partial<EditorSession['gradient']>) => void;
  onShapeChange: (change: Partial<EditorSession['shape']>) => void;
  onPenChange: (change: Partial<EditorSession['pen']>) => void;
  onWarpChange: (change: Partial<EditorSession['warp']>) => void;
  onVectorStyleChange: (change: Partial<EditorSession['vectorStyle']>) => void;
  onTextChange: (change: Partial<EditorSession['text']>) => void;
  onTextFontAssetChange?: (assetId: string) => void;
  onTextSizeChange?: (size: number) => void;
  onTextFillChange?: (fill: string) => void;
  onTextFillPaintChange?: (fill: TextPaint) => void;
  onTextFillEnabledChange?: (enabled: boolean) => void;
  onTextStrokeColorChange?: (stroke: string) => void;
  onTextStrokeWidthChange?: (width: number) => void;
  onTextAlignmentChange?: (alignment: EditorSession['text']['alignment']) => void;
  onTextWritingModeChange?: (writingMode: 'horizontal-tb' | 'vertical-rl' | 'vertical-lr') => void;
  onTextPropertyBegin?: () => void;
  onTextPropertyCommit?: () => void;
  onTextPropertyCancel?: () => void;
  onTextLayoutModeChange?: (mode: 'point' | 'paragraph') => void;
  onSelectedVectorStyleChange: (change: Partial<EditorSession['vectorStyle']>) => void;
  onSelectedShapeChange: (change: Partial<EditorSession['shape']>) => void;
  onWarpReset: () => void;
  faceWarp: FaceWarpToolOptionsProps;
  onSelectionPixelSnapChange: (enabled: boolean) => void;
  onSelectionCombineModeChange: (mode: EditorSession['selectionCombineMode']) => void;
  onSelectionFeatherChange: (radius: number) => void;
  onSelectionAntiAliasChange: (enabled: boolean) => void;
  onSelectionMarqueeStyleChange: (style: EditorSession['selectionMarqueeStyle']) => void;
  onSelectionMarqueeWidthChange: (width: number) => void;
  onSelectionMarqueeHeightChange: (height: number) => void;
  onSelectionRowHeightChange: (height: number) => void;
  onSelectionColumnWidthChange: (width: number) => void;
  onSelectionSmoothChange: (smooth: number) => void;
  onMagicWandChange: (change: Partial<EditorSession['magicWand']>) => void;
  onSmartSelectionChange: (change: Partial<EditorSession['smartSelection']>) => void;
  onSmartSelectionSelectSubject?: () => void;
  onTransformAutoSelectLayerChange: (enabled: boolean) => void;
  onZoomPreset: (percent: number) => void;
  onZoomFit: () => void;
  onZoomActual: () => void;
  onToolChange: (tool: ToolId) => void;
  onForegroundColorChange: (color: string) => void;
  onBackgroundColorChange: (color: string) => void;
  onSwapColors: () => void;
  onResetColors: () => void;
  fileInputRef: RefObject<HTMLInputElement | null>;
  advancedFileInputRef: RefObject<HTMLInputElement | null>;
  fastFileAccept: string;
  precisionFileAccept: string;
  onFastFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onPrecisionFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  children: React.ReactNode;
  overlays?: React.ReactNode;
}

const IMAGE_ONLY_MENUS = new Set<EditorMenuId>(['image', 'layer', 'type', 'select', 'filter']);

export const editorMenuEnabledForDocumentKind = (
  documentKind: 'image' | 'video' | 'model-3d',
  menuId: EditorMenuId
): boolean => documentKind === 'image' || !IMAGE_ONLY_MENUS.has(menuId);

/**
 * Platform-neutral editor chrome.
 *
 * This component owns presentation and event containment only. It deliberately
 * receives commands and projected state instead of document, history, renderer
 * or host services, keeping web and Electron on the same UI boundary.
 */
export const LightTableEditorShell: React.FC<LightTableEditorShellProps> = ({
  workspaceDocumentKind = 'image',
  screenMode,
  active,
  saving,
  recoveryNotice,
  projectName,
  onRevealProject,
  onClose,
  menuOptionsFor,
  activeTool,
  brush,
  sampledBrush,
  toneBrush,
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
  selectionFeather,
  selectionAntiAlias,
  selectionMarqueeStyle,
  selectionMarqueeWidth,
  selectionMarqueeHeight,
  selectionRowHeight,
  selectionColumnWidth,
  selectionSmooth,
  magicWand,
  smartSelection,
  smartSelectionBackendIdentity,
  smartSelectionPreparation,
  transformAutoSelectLayer,
  zoomPercent,
  gradientEditorRequest,
  onBrushChange,
  onSampledBrushChange,
  onToneBrushChange,
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
  faceWarp,
  onSelectionPixelSnapChange,
  onSelectionCombineModeChange,
  onSelectionFeatherChange,
  onSelectionAntiAliasChange,
  onSelectionMarqueeStyleChange,
  onSelectionMarqueeWidthChange,
  onSelectionMarqueeHeightChange,
  onSelectionRowHeightChange,
  onSelectionColumnWidthChange,
  onSelectionSmoothChange,
  onMagicWandChange,
  onSmartSelectionChange,
  onSmartSelectionSelectSubject,
  onTransformAutoSelectLayerChange,
  onZoomPreset,
  onZoomFit,
  onZoomActual,
  onToolChange,
  onForegroundColorChange,
  onBackgroundColorChange,
  onSwapColors,
  onResetColors,
  fileInputRef,
  advancedFileInputRef,
  fastFileAccept,
  precisionFileAccept,
  onFastFileChange,
  onPrecisionFileChange,
  children,
  overlays
}) => (
  <div
    className={`modal-backdrop lighttable-backdrop${active ? '' : ' lighttable-backdrop--inactive'}`}
    aria-hidden={!active}
  >
    <div
      className={`modal lighttable${screenMode === 'canvas-only' ? ' lighttable--canvas-only' : ''}`}
      onClick={(event) => event.stopPropagation()}
    >
      {screenMode !== 'canvas-only' ? <div className="modal__header concept-art-editor__header lighttable__header">
        <div className="lighttable__header-left">
          <EditorMenuBar optionsFor={menuOptionsFor} projectName={projectName}
            enabledFor={(menuId) => editorMenuEnabledForDocumentKind(workspaceDocumentKind, menuId)}
            onRevealProject={onRevealProject} />
        </div>
        <SquareIconButton
          className="lighttable__close-button"
          onClick={onClose}
          disabled={saving}
          title="Close editor"
          aria-label="Close editor"
          icon={<img src={lightTableIcon('close.png')} alt="" aria-hidden />}
        />
      </div> : null}

      {screenMode !== 'canvas-only' && workspaceDocumentKind === 'image' ? <ToolOptionsBar
        activeTool={activeTool}
        brush={brush}
        sampledBrush={sampledBrush}
        toneBrush={toneBrush}
        gradient={gradient}
        shape={shape}
        pen={pen}
        warp={warp}
        vectorStyle={vectorStyle}
        text={text}
        textFonts={textFonts}
        textProperties={textProperties}
        textLayoutMode={textLayoutMode}
        selectedVectorStyle={selectedVectorStyle}
        selectedShape={selectedShape}
        selectedShapeKind={selectedShapeKind}
        selectionPixelSnap={selectionPixelSnap}
        selectionCombineMode={selectionCombineMode}
        selectionFeather={selectionFeather}
        selectionAntiAlias={selectionAntiAlias}
        selectionMarqueeStyle={selectionMarqueeStyle}
        selectionMarqueeWidth={selectionMarqueeWidth}
        selectionMarqueeHeight={selectionMarqueeHeight}
        selectionRowHeight={selectionRowHeight}
        selectionColumnWidth={selectionColumnWidth}
        selectionSmooth={selectionSmooth}
        magicWand={magicWand}
        smartSelection={smartSelection}
        smartSelectionBackendIdentity={smartSelectionBackendIdentity}
        smartSelectionPreparation={smartSelectionPreparation}
        transformAutoSelectLayer={transformAutoSelectLayer}
        zoomPercent={zoomPercent}
        gradientEditorRequest={gradientEditorRequest}
        onBrushChange={onBrushChange}
        onSampledBrushChange={onSampledBrushChange}
        onToneBrushChange={onToneBrushChange}
        onGradientChange={onGradientChange}
        onShapeChange={onShapeChange}
        onPenChange={onPenChange}
        onWarpChange={onWarpChange}
        onVectorStyleChange={onVectorStyleChange}
        onTextChange={onTextChange}
        onTextFontAssetChange={onTextFontAssetChange}
        onTextSizeChange={onTextSizeChange}
        onTextFillChange={onTextFillChange}
        onTextFillPaintChange={onTextFillPaintChange}
        onTextFillEnabledChange={onTextFillEnabledChange}
        onTextStrokeColorChange={onTextStrokeColorChange}
        onTextStrokeWidthChange={onTextStrokeWidthChange}
        onTextAlignmentChange={onTextAlignmentChange}
        onTextWritingModeChange={onTextWritingModeChange}
        onTextPropertyBegin={onTextPropertyBegin}
        onTextPropertyCommit={onTextPropertyCommit}
        onTextPropertyCancel={onTextPropertyCancel}
        onTextLayoutModeChange={onTextLayoutModeChange}
        onSelectedVectorStyleChange={onSelectedVectorStyleChange}
        onSelectedShapeChange={onSelectedShapeChange}
        onWarpReset={onWarpReset}
        faceWarp={faceWarp}
        onSelectionPixelSnapChange={onSelectionPixelSnapChange}
        onSelectionCombineModeChange={onSelectionCombineModeChange}
        onSelectionFeatherChange={onSelectionFeatherChange}
        onSelectionAntiAliasChange={onSelectionAntiAliasChange}
        onSelectionMarqueeStyleChange={onSelectionMarqueeStyleChange}
        onSelectionMarqueeWidthChange={onSelectionMarqueeWidthChange}
        onSelectionMarqueeHeightChange={onSelectionMarqueeHeightChange}
        onSelectionRowHeightChange={onSelectionRowHeightChange}
        onSelectionColumnWidthChange={onSelectionColumnWidthChange}
        onSelectionSmoothChange={onSelectionSmoothChange}
        onMagicWandChange={onMagicWandChange}
        onSmartSelectionChange={onSmartSelectionChange}
        onSmartSelectionSelectSubject={onSmartSelectionSelectSubject}
        onTransformAutoSelectLayerChange={onTransformAutoSelectLayerChange}
        onZoomPreset={onZoomPreset}
        onZoomFit={onZoomFit}
      /> : null}

      {recoveryNotice && screenMode !== 'canvas-only' ? (
        <div className="lighttable__recovery-notice" role="status">
          {recoveryNotice}
        </div>
      ) : null}

      <input
        ref={fileInputRef}
        type="file"
        accept={fastFileAccept}
        hidden
        onChange={onFastFileChange}
      />
      <input
        ref={advancedFileInputRef}
        type="file"
        accept={precisionFileAccept}
        hidden
        onChange={onPrecisionFileChange}
      />

      <div className="lighttable__body">
        {screenMode !== 'canvas-only' ? <EditorToolbar
          documentKind={workspaceDocumentKind}
          activeTool={activeTool}
          foregroundColor={brush.color}
          backgroundColor={brush.backgroundColor}
          onToolChange={onToolChange}
          onZoomActual={onZoomActual}
          onForegroundColorChange={onForegroundColorChange}
          onBackgroundColorChange={onBackgroundColorChange}
          onSwapColors={onSwapColors}
          onResetColors={onResetColors}
        /> : null}
        {children}
      </div>
    </div>
    {overlays}
  </div>
);
