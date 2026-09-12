import type { VectorSelectionFrame } from '@lighttable/vector-rendering';
import type { DocumentGuide } from '../../../editor/document/documentTypes';
import { buildDocumentGuideFrame, buildDocumentGridFrame } from '../../../editor/tools/transform/layoutGuideEditingFrame';

export interface GuideDraftSource {
  getSnapshot(): readonly DocumentGuide[] | null;
  subscribe(listener: () => void): () => void;
}
export interface GuideGridRenderer {
  setDocumentGuideEditingFrame(frame: VectorSelectionFrame | null): void;
  setDocumentGridEditingFrame(frame: VectorSelectionFrame | null): void;
}
export interface GuideGridPresentationInputs {
  readonly document: { readonly guides: readonly DocumentGuide[]; readonly width: number; readonly height: number } | null;
  readonly guidesVisible: boolean;
  readonly gridVisible: boolean;
  readonly gridSpacing: number;
  readonly gridOriginX: number;
  readonly gridOriginY: number;
  readonly zoom: number;
}

// Frame-slot ownership only: a retired binding must not clear a successor that
// reuses the same renderer. This does not retain document state or GPU resources.
const frameOwners = new WeakMap<GuideGridRenderer, object>();
const equalKeys = (before: readonly unknown[] | null, after: readonly unknown[]) =>
  before?.length === after.length && after.every((value, index) => Object.is(value, before[index]));

/** Sole guide/grid frame writer. Draft events update guides only, without a new frame queue. */
export class GuideGridPresentationBinding {
  private readonly token = {};
  private mounted = false;
  private unsubscribe: (() => void) | undefined;
  private guideKeys: readonly unknown[] | null = null;
  private gridKeys: readonly unknown[] | null = null;
  constructor(private readonly renderer: GuideGridRenderer | null,
    private readonly isCurrent: () => boolean,
    private readonly read: () => GuideGridPresentationInputs,
    private readonly drafts: GuideDraftSource) {}

  mount = () => {
    if (this.mounted || !this.renderer || !this.isCurrent()) return;
    this.mounted = true;
    frameOwners.set(this.renderer, this.token);
    this.unsubscribe = this.drafts.subscribe(this.presentGuides);
    this.present();
  };
  unmount = () => {
    this.unsubscribe?.(); this.unsubscribe = undefined;
    const ownsFrames = this.renderer && frameOwners.get(this.renderer) === this.token;
    this.mounted = false; this.guideKeys = null; this.gridKeys = null;
    if (!ownsFrames || !this.renderer) return;
    frameOwners.delete(this.renderer);
    if (!this.isCurrent()) return;
    this.renderer.setDocumentGuideEditingFrame(null);
    this.renderer.setDocumentGridEditingFrame(null);
  };
  private available() {
    return this.mounted && this.renderer && this.isCurrent()
      && frameOwners.get(this.renderer) === this.token;
  }
  present = () => { this.presentGuides(); this.presentGrid(); };
  private presentGuides = () => {
    if (!this.available()) return;
    const input = this.read(), document = input.document;
    const visible = Boolean(document && input.guidesVisible);
    const guides = visible ? this.drafts.getSnapshot() ?? document!.guides : null;
    const keys = [visible, guides, document?.width, document?.height];
    if (equalKeys(this.guideKeys, keys)) return;
    this.renderer!.setDocumentGuideEditingFrame(visible
      ? buildDocumentGuideFrame(guides!, document!.width, document!.height) : null);
    this.guideKeys = keys;
  };
  private presentGrid() {
    if (!this.available()) return;
    const input = this.read(), document = input.document;
    const visible = Boolean(document && input.gridVisible);
    const keys = [visible, document?.width, document?.height, input.gridSpacing,
      input.gridOriginX, input.gridOriginY, input.zoom];
    if (equalKeys(this.gridKeys, keys)) return;
    this.renderer!.setDocumentGridEditingFrame(visible
      ? buildDocumentGridFrame(document!.width, document!.height, input.gridSpacing,
        input.gridOriginX, input.gridOriginY, input.zoom) : null);
    this.gridKeys = keys;
  }
}
