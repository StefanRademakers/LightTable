import { useCallback, useLayoutEffect, useRef, type RefObject } from 'react';
import type { DocumentRendererScopeCanvases } from '../../application/rendering/rendererTypes';
import { resolveEditorDocumentCanvases, type EditorDocumentScopeCanvasRefs } from './resolveEditorDocumentCanvases';

interface ScopeRenderer { initializeScopes(canvases: DocumentRendererScopeCanvases): Promise<void> }
interface Scope { isCurrent(): boolean }
interface Options {
  readonly renderer: RefObject<ScopeRenderer | null>;
  readonly canvases: EditorDocumentScopeCanvasRefs;
  readonly ready: boolean;
  readonly generation: number;
  readonly lifecycle: object;
  readonly surfaceRevision: number;
  readonly captureScope: () => Scope;
  readonly reportError: (message: string) => void;
}

/** Binds mounted accessory canvases to the exact current renderer, without owning GPU resources. */
export function useDocumentScopeCanvases(options: Options) {
  const latest = useRef(options);
  latest.current = options;
  const mounted = useRef(false);
  const request = useRef(0);
  const attach = useCallback(() => {
    const current = latest.current;
    const renderer = current.renderer.current;
    const scopes = resolveEditorDocumentCanvases(current.canvases)?.scopes;
    if (!mounted.current || !current.ready || !renderer || !scopes) return;
    const scope = current.captureScope();
    if (!scope.isCurrent()) return;
    const sequence = ++request.current;
    void renderer.initializeScopes(scopes).catch((error: unknown) => {
      if (mounted.current && sequence === request.current && scope.isCurrent()
        && latest.current.renderer.current === renderer) {
        current.reportError(error instanceof Error ? error.message : String(error));
      }
    });
  }, []);
  useLayoutEffect(() => {
    mounted.current = true;
    attach();
    return () => { mounted.current = false; request.current += 1; };
  }, [attach, options.ready, options.generation, options.lifecycle, options.surfaceRevision, options.renderer.current]);
  return useCallback((canvas: HTMLCanvasElement | null) => {
    latest.current.canvases.colorMixerHueDistribution.current = canvas;
    // Null is a real detachment request, not permission to retain an old context.
    attach();
  }, [attach]);
}
