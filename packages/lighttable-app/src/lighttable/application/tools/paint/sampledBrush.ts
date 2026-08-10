import type { ImageDocument, LayerNode } from '../../../editor/document/documentTypes';
import {
  sampledBrushOperatorFor,
  type SampledBrushSettings,
  type SampledBrushSource,
  type SampledBrushStrokePlan,
  type SampledBrushToolId
} from '../../../editor/tools/paint/sampledBrushTypes';

export {
  isSampledBrushTool,
  sampledBrushOperatorFor,
  type SampledBrushMode,
  type SampledBrushOperator,
  type SampledBrushSettings,
  type SampledBrushSource,
  type SampledBrushStrokePlan,
  type SampledBrushToolId
} from '../../../editor/tools/paint/sampledBrushTypes';

/**
 * Document-scoped source state shared by Clone Stamp and Healing Brush.
 *
 * A source is anchored to the layer that was active during Alt/Option-click.
 * Selecting a different destination layer therefore never changes sampling.
 * The aligned offset is also independent from React state so pointer input can
 * retain one exact mapping across frame-batched strokes.
 */
export class SampledBrushSourceController {
  private currentSource: SampledBrushSource | null = null;
  private alignedOffset: { x: number; y: number } | null = null;

  get source(): SampledBrushSource | null {
    return this.currentSource ? {
      ...this.currentSource,
      point: { ...this.currentSource.point }
    } : null;
  }

  setSource(
    document: Pick<ImageDocument, 'id'>,
    layer: Pick<LayerNode, 'id'>,
    point: { readonly x: number; readonly y: number }
  ): SampledBrushSource {
    this.currentSource = {
      documentId: document.id,
      anchorLayerId: layer.id,
      point: { x: point.x, y: point.y }
    };
    this.alignedOffset = null;
    return this.source!;
  }

  clear(): void {
    this.currentSource = null;
    this.alignedOffset = null;
  }

  beginStroke(
    tool: SampledBrushToolId,
    document: Pick<ImageDocument, 'id'>,
    destination: { readonly x: number; readonly y: number },
    settings: SampledBrushSettings
  ): SampledBrushStrokePlan | null {
    const source = this.currentSource;
    if (!source || source.documentId !== document.id) return null;
    const freshOffset = {
      x: source.point.x - destination.x,
      y: source.point.y - destination.y
    };
    const sourceOffset = settings.aligned
      ? this.alignedOffset ??= freshOffset
      : freshOffset;
    return {
      operator: sampledBrushOperatorFor(tool),
      source: {
        ...source,
        point: { ...source.point }
      },
      sampleMode: settings.sampleMode,
      sourceOffset: { ...sourceOffset }
    };
  }

  sourceMarkerFor(
    documentId: string,
    destination: { readonly x: number; readonly y: number }
  ): { x: number; y: number } | null {
    const source = this.currentSource;
    if (!source || source.documentId !== documentId) return null;
    return this.alignedOffset
      ? {
          x: destination.x + this.alignedOffset.x,
          y: destination.y + this.alignedOffset.y
        }
      : { ...source.point };
  }
}
