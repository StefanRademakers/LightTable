import { useEffect, type MutableRefObject } from 'react';
import type { WebGpuScopeOptions } from '../../gpu/WebGpuScopeEngine';
import type { ScopeSettings, ScopeVisibility } from '../../scopes';

export interface RendererPresentationPort {
  setBefore(enabled: boolean): void;
  setDifference(enabled: boolean): void;
  setScopeOptions(
    histogramVisible: boolean,
    options: WebGpuScopeOptions
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
