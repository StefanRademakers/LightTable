import type { TextLayerEditingLayout } from '../../text/rendering/TextLayerRenderCoordinator';
import type { ImageDocument, LayerId, TextLayer } from '../../editor/document/documentTypes';
import { layerGeometryBounds, pointInBounds } from '../geometry/layerGeometryQuery';
import { hitTestTextEditingLayout, type TextEditingHit } from './textEditingHitTest';

export interface ExistingTextHitRenderer {
  currentTextEditingLayout(layerId: LayerId): TextLayerEditingLayout | null;
  waitForTextEditingLayout(layerId: LayerId, signal?: AbortSignal): Promise<{
    readonly kind: 'ready'; readonly presentation: TextLayerEditingLayout;
  } | { readonly kind: 'invalidated' | 'unavailable' }>;
}

export interface ExistingTextHitControllerDependencies {
  getDocument(): ImageDocument | null;
  getRenderer(): ExistingTextHitRenderer | null;
  getRendererGeneration(): number;
}

export interface ExistingTextHitResult {
  readonly layer: TextLayer;
  readonly presentation: TextLayerEditingLayout;
  readonly hit: TextEditingHit;
}

export interface PendingTextPointerIntent {
  readonly pointerId: number;
  readonly start: { readonly x: number; readonly y: number };
  readonly current: { readonly x: number; readonly y: number };
  readonly finished: boolean;
}

/** Retains a plausible text click while its renderer-owned layout is pending. */
export class ExistingTextHitController {
  private revision = 0;
  private pending: {
    pointer: PendingTextPointerIntent | null;
    abort: AbortController;
  } | null = null;

  constructor(private readonly dependencies: ExistingTextHitControllerDependencies) {}

  resolve(
    candidates: readonly TextLayer[],
    point: { readonly x: number; readonly y: number },
    radius: number,
    publish: (result: ExistingTextHitResult, pointerFinished: boolean) => void,
    miss: (intent: PendingTextPointerIntent | null) => void,
    pointerId?: number
  ): 'hit' | 'pending' | 'miss' {
    this.cancel();
    const document = this.dependencies.getDocument();
    const renderer = this.dependencies.getRenderer();
    if (!document || !renderer) return 'miss';
    const immediate = this.hit(candidates, renderer, point, radius);
    if (immediate) {
      publish(immediate, false);
      return 'hit';
    }
    const plausible = candidates.filter(({ id }) => {
      const geometry = layerGeometryBounds(document, id);
      return !geometry || geometry.visualBounds === null
        || pointInBounds(point, geometry.documentBounds, radius);
    });
    if (plausible.length === 0) return 'miss';
    const revision = this.revision;
    const rendererGeneration = this.dependencies.getRendererGeneration();
    const abort = new AbortController();
    this.pending = {
      abort,
      pointer: pointerId === undefined ? null
        : { pointerId, start: { ...point }, current: { ...point }, finished: false }
    };
    void Promise.all(plausible.map(({ id }) => renderer.waitForTextEditingLayout(id, abort.signal)))
      .then((results) => {
        if (revision !== this.revision) return;
        const pending = this.pending;
        if (pending?.abort === abort) this.pending = null;
        if (this.dependencies.getDocument() !== document
          || this.dependencies.getRenderer() !== renderer
          || this.dependencies.getRendererGeneration() !== rendererGeneration) return;
        if (results.some(({ kind }) => kind === 'invalidated')) return;
        const resolved = this.hit(plausible, renderer, point, radius);
        if (resolved) publish(resolved, pending?.pointer?.finished ?? false);
        else miss(pending?.pointer ?? null);
      })
      .catch(() => undefined);
    return 'pending';
  }

  cancel() {
    this.pending?.abort.abort();
    this.pending = null;
    this.revision += 1;
  }

  owns(pointerId: number) {
    return this.pending?.pointer?.pointerId === pointerId;
  }

  move(pointerId: number, point: { readonly x: number; readonly y: number }) {
    if (!this.pending?.pointer || this.pending.pointer.pointerId !== pointerId) return false;
    this.pending.pointer = { ...this.pending.pointer, current: { ...point } };
    return true;
  }

  finish(pointerId: number, point: { readonly x: number; readonly y: number }) {
    if (!this.pending?.pointer || this.pending.pointer.pointerId !== pointerId) return false;
    this.pending.pointer = { ...this.pending.pointer, current: { ...point }, finished: true };
    return true;
  }

  cancelPointer(pointerId: number) {
    if (!this.owns(pointerId)) return false;
    this.cancel();
    return true;
  }

  private hit(
    candidates: readonly TextLayer[],
    renderer: ExistingTextHitRenderer,
    point: { readonly x: number; readonly y: number },
    radius: number
  ): ExistingTextHitResult | null {
    for (const layer of candidates) {
      const presentation = renderer.currentTextEditingLayout(layer.id);
      if (!presentation) continue;
      const hit = hitTestTextEditingLayout(presentation, point, radius);
      if (hit) return { layer, presentation, hit };
    }
    return null;
  }

}
