import type { RefObject } from 'react';
import type {
  DocumentRendererScopeCanvases
} from '../../application/rendering/rendererTypes';

export interface EditorDocumentScopeCanvasRefs {
  readonly viewport: RefObject<HTMLCanvasElement | null>;
  readonly hueDistribution: RefObject<HTMLCanvasElement | null>;
  readonly colorMixerHueDistribution: RefObject<HTMLCanvasElement | null>;
  readonly parade: RefObject<HTMLCanvasElement | null>;
  readonly vectorscope: RefObject<HTMLCanvasElement | null>;
}

export interface ResolvedEditorDocumentCanvases {
  readonly viewport: HTMLCanvasElement;
  readonly scopes: DocumentRendererScopeCanvases | null;
}

export const resolveEditorDocumentCanvases = (
  canvases: EditorDocumentScopeCanvasRefs
): ResolvedEditorDocumentCanvases | null => {
  const viewport = canvases.viewport.current;
  const hueDistribution = canvases.hueDistribution.current;
  const colorMixerHueDistribution =
    canvases.colorMixerHueDistribution.current;
  const parade = canvases.parade.current;
  const vectorscope = canvases.vectorscope.current;
  if (!viewport) return null;
  return {
    viewport,
    // Hidden workspace panels need not be mounted to open a document.
    scopes: hueDistribution && parade && vectorscope ? {
      hueDistribution,
      ...(colorMixerHueDistribution ? { colorMixerHueDistribution } : {}),
      parade,
      vectorscope
    } : null
  };
};
