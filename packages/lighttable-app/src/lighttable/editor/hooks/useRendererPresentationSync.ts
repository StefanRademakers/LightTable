import { useEffect, type MutableRefObject } from 'react';
import type { WebGpuScopeOptions } from '../../gpu/WebGpuScopeEngine';
import type { ScopeSettings, ScopeVisibility } from '../../scopes';
import type { LensBlurViewportMode } from '../config/adjustmentControls';
import type { WarpDebugView } from '../../effects/warp/warpTypes';
import type { VectorEditorSelection } from '../session/editorSession';
import type { SelectionOperation, SelectionShape } from '../selection/selectionTypes';
import type { LayerId } from '../document/documentTypes';

export interface RendererPresentationPort {
  setBefore(enabled: boolean): void;
  setDifference(enabled: boolean): void;
  setMaskIsolation(layerId: LayerId | null): void;
  setScopeOptions(
    histogramVisible: boolean,
    options: WebGpuScopeOptions
  ): void;
  setLensBlurDepthVisualization(enabled: boolean): void;
  setWarpDebugVisualization(view: WarpDebugView): void;
  setVectorEditingSelection(selection: VectorEditorSelection): void;
  setSelectionEditingOverlay(
    operations: readonly SelectionOperation[],
    draft: SelectionShape | null,
    visible: boolean
  ): void;
}

export const createScopeRendererOptions = (
  visibility: ScopeVisibility,
  settings: ScopeSettings
): WebGpuScopeOptions => ({
  // The compact Color Mixer consumes the same hue analysis as the standalone
  // Hue Distribution scope, so this inexpensive analysis stays available.
  hueDistributionVisible: true,
  paradeVisible: visibility.parade,
  vectorscopeVisible: visibility.vectorscope,
  quality: settings.quality,
  traceBrightness: settings.traceBrightness,
  vectorscopeRange: settings.vectorscopeRange,
  vectorscopeZoom2x: settings.vectorscopeZoom2x
});

interface RendererPresentationSyncOptions<
  Renderer extends RendererPresentationPort
> {
  readonly rendererRef: MutableRefObject<Renderer | null>;
  readonly showOriginal: boolean;
  readonly showDifference: boolean;
  readonly isolatedMaskLayerId: LayerId | null;
  readonly lensBlurViewportMode: LensBlurViewportMode;
  readonly warpDebugView: WarpDebugView;
  readonly vectorSelection: VectorEditorSelection;
  readonly selection: readonly SelectionOperation[];
  readonly selectionDraft: SelectionShape | null;
  readonly selectionOverlayVisible: boolean;
  readonly scopeVisibility: ScopeVisibility;
  readonly scopeSettings: ScopeSettings;
  readonly scopeVisibilityRef: MutableRefObject<ScopeVisibility>;
  readonly scopeSettingsRef: MutableRefObject<ScopeSettings>;
}

/**
 * Keeps presentation-only renderer state synchronized with the active
 * document view. It deliberately owns no document mutations or GPU lifetime.
 */
export const useRendererPresentationSync = <
  Renderer extends RendererPresentationPort
>({
  rendererRef,
  showOriginal,
  showDifference,
  isolatedMaskLayerId,
  lensBlurViewportMode,
  warpDebugView,
  vectorSelection,
  selection,
  selectionDraft,
  selectionOverlayVisible,
  scopeVisibility,
  scopeSettings,
  scopeVisibilityRef,
  scopeSettingsRef
}: RendererPresentationSyncOptions<Renderer>): void => {
  useEffect(() => {
    rendererRef.current?.setBefore(showOriginal);
    rendererRef.current?.setDifference(showDifference);
  }, [rendererRef, showDifference, showOriginal]);

  useEffect(() => {
    rendererRef.current?.setMaskIsolation(isolatedMaskLayerId);
  }, [isolatedMaskLayerId, rendererRef]);

  useEffect(() => {
    rendererRef.current?.setLensBlurDepthVisualization(
      lensBlurViewportMode === 'depth'
    );
  }, [lensBlurViewportMode, rendererRef]);

  useEffect(() => {
    rendererRef.current?.setWarpDebugVisualization(warpDebugView);
  }, [rendererRef, warpDebugView]);

  useEffect(() => {
    rendererRef.current?.setVectorEditingSelection(vectorSelection);
  }, [rendererRef, vectorSelection]);

  useEffect(() => {
    rendererRef.current?.setSelectionEditingOverlay(
      selection,
      selectionDraft,
      selectionOverlayVisible
    );
  }, [rendererRef, selection, selectionDraft, selectionOverlayVisible]);

  useEffect(() => {
    scopeVisibilityRef.current = scopeVisibility;
    scopeSettingsRef.current = scopeSettings;
    rendererRef.current?.setScopeOptions(
      scopeVisibility.histogram,
      createScopeRendererOptions(scopeVisibility, scopeSettings)
    );
  }, [
    rendererRef,
    scopeSettings,
    scopeSettingsRef,
    scopeVisibility,
    scopeVisibilityRef
  ]);
};
