import { panViewFromGesture, type Point, type ViewTransform } from '../../editor/tools/pointer/viewportCoordinates';

export type ViewportPanInitiator = 'view-tool' | 'temporary-tool' | 'middle-button';

interface ViewportPanGesture<TOwner> {
  readonly pointerId: number;
  readonly initiator: ViewportPanInitiator;
  readonly origin: Point;
  readonly initialView: Pick<ViewTransform, 'panX' | 'panY'>;
  readonly owner: TOwner;
}

/**
 * Retains one canvas-pan gesture independently from React renders and tools.
 * The initiating pointer remains the sole owner until terminal release/cancel.
 */
export class ViewportPanGestureOwner<TOwner = unknown> {
  private gesture: ViewportPanGesture<TOwner> | null = null;

  begin(input: {
    readonly pointerId: number;
    readonly button: number;
    readonly buttons: number;
    readonly initiator: ViewportPanInitiator;
    readonly point: Point;
    readonly view: Pick<ViewTransform, 'panX' | 'panY'>;
    readonly hasDocumentMetadata: boolean;
    readonly competingGesture: boolean;
    readonly owner: TOwner;
  }): boolean {
    if (this.gesture || input.competingGesture || !input.hasDocumentMetadata) return false;
    const expectedButton = input.initiator === 'middle-button' ? 1 : 0;
    if (input.button !== expectedButton) return false;
    if (input.initiator === 'middle-button' && (input.buttons & 1) !== 0) return false;
    this.gesture = {
      pointerId: input.pointerId,
      initiator: input.initiator,
      origin: { ...input.point },
      initialView: { ...input.view },
      owner: input.owner
    };
    return true;
  }

  owns(pointerId: number): boolean {
    return this.gesture?.pointerId === pointerId;
  }

  move(pointerId: number, point: Point): {
    readonly owner: TOwner;
    readonly pan: Pick<ViewTransform, 'panX' | 'panY'>;
  } | null {
    const gesture = this.gesture;
    if (!gesture || gesture.pointerId !== pointerId) return null;
    return {
      owner: gesture.owner,
      pan: panViewFromGesture({
        origin: gesture.origin,
        current: point,
        initialView: gesture.initialView
      })
    };
  }

  finish(pointerId: number): boolean {
    if (!this.owns(pointerId)) return false;
    this.gesture = null;
    return true;
  }

  cancel(): void {
    this.gesture = null;
  }

  get active(): boolean {
    return this.gesture !== null;
  }
}
