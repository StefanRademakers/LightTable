import type { LightTableViewState } from '../../types';
import {
  LatestFrameValueScheduler,
  type InputAnimationFrameHost
} from './latestFrameValueScheduler';
import {
  ViewportPanGestureOwner,
  type ViewportPanInitiator
} from './ViewportPanGestureOwner';
import type { Point, ViewTransform } from '../../editor/tools/pointer/viewportCoordinates';

export type ViewportViewSetter = (
  value: LightTableViewState | ((current: LightTableViewState) => LightTableViewState)
) => void;

export interface ViewportFrameOwner {
  readonly documentId: string | null;
  readonly setView: ViewportViewSetter;
}

/** Owns document-bound pan gestures and coalesced viewport publications. */
export class ViewportPresentationController {
  private owner: ViewportFrameOwner;
  private readonly pan = new ViewportPanGestureOwner<ViewportFrameOwner>();
  private readonly panFrames: LatestFrameValueScheduler<{
    readonly owner: ViewportFrameOwner;
    readonly pan: Pick<ViewTransform, 'panX' | 'panY'>;
  }>;
  private readonly viewFrames: LatestFrameValueScheduler<{
    readonly owner: ViewportFrameOwner;
    readonly view: LightTableViewState;
  }>;

  constructor(
    documentId: string | null,
    setView: ViewportViewSetter,
    frameHost?: InputAnimationFrameHost
  ) {
    this.owner = { documentId, setView };
    this.panFrames = new LatestFrameValueScheduler(({ owner, pan }) => {
      if (!this.isCurrent(owner)) return;
      owner.setView((current) => ({ ...current, ...pan }));
    }, frameHost);
    this.viewFrames = new LatestFrameValueScheduler(({ owner, view }) => {
      if (!this.isCurrent(owner)) return;
      owner.setView(view);
    }, frameHost);
  }

  prepare(documentId: string | null, setView: ViewportViewSetter): ViewportFrameOwner {
    if (this.owner.documentId === documentId && this.owner.setView === setView) return this.owner;
    return { documentId, setView };
  }

  commit(owner: ViewportFrameOwner): void {
    if (this.owner === owner) return;
    this.cancel();
    this.owner = owner;
  }

  currentOwner(): ViewportFrameOwner {
    return this.owner;
  }

  isCurrent(owner: ViewportFrameOwner): boolean {
    return this.owner === owner;
  }

  beginPan(input: {
    readonly pointerId: number;
    readonly button: number;
    readonly buttons: number;
    readonly initiator: ViewportPanInitiator;
    readonly point: Point;
    readonly view: Pick<ViewTransform, 'panX' | 'panY'>;
    readonly hasDocumentMetadata: boolean;
    readonly competingGesture: boolean;
  }): boolean {
    return this.pan.begin({ ...input, owner: this.owner });
  }

  movePan(pointerId: number, point: Point): boolean {
    const result = this.pan.move(pointerId, point);
    if (!result) return false;
    if (!this.isCurrent(result.owner)) {
      this.pan.cancel();
      return false;
    }
    this.panFrames.schedule(result);
    return true;
  }

  finishPan(pointerId: number, point: Point): boolean {
    if (!this.pan.owns(pointerId)) return false;
    this.movePan(pointerId, point);
    if (!this.pan.owns(pointerId)) return false;
    this.panFrames.flush();
    return this.pan.finish(pointerId);
  }

  ownsPan(pointerId: number): boolean {
    return this.pan.owns(pointerId);
  }

  get panActive(): boolean {
    return this.pan.active;
  }

  pendingView(): LightTableViewState | null {
    const pending = this.viewFrames.pending();
    return pending?.owner === this.owner ? pending.view : null;
  }

  scheduleView(view: LightTableViewState): void {
    this.viewFrames.schedule({ owner: this.owner, view });
  }

  cancel(): void {
    this.pan.cancel();
    this.panFrames.cancel();
    this.viewFrames.cancel();
  }

  dispose(): void {
    this.pan.cancel();
    this.panFrames.dispose();
    this.viewFrames.dispose();
  }
}
