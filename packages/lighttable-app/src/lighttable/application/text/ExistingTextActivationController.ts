import type { ImageDocument, LayerId, TextLayer } from '../../editor/document/documentTypes';
import { findDocumentLayer } from '../../editor/document/layerTree';
import { visibleTextLayersTopmostFirst } from '../geometry/layerGeometryQuery';
import type { captureInteractionScope } from '../interactions/captureInteractionScope';
import { textLayerSourceKey } from '../../text/rendering/TextLayerRenderer';
import { hitTestTextEditingLayout } from './textEditingHitTest';
import { textSelectionForGranularity, type TextSelectionGranularity } from './flowTextEditing';
import type { FlowTextEditingSessionController } from './flowTextEditingSession';
import type { TextSelectionGestureController } from './TextSelectionGestureController';
import type { ExistingTextHitController, ExistingTextHitRenderer, ExistingTextHitResult,
  PendingTextPointerIntent } from './ExistingTextHitController';

type Point = { x: number; y: number };
export interface ExistingTextActivationPorts {
  getDocument(): ImageDocument | null;
  getRenderer(): ExistingTextHitRenderer | null;
  getTool(): string;
  getScale(): number;
  captureScope(): ReturnType<typeof captureInteractionScope>;
  hit: Pick<ExistingTextHitController, 'resolve' | 'cancel'>;
  editing: Pick<FlowTextEditingSessionController, 'getSnapshot' | 'setSelection'>;
  selection: Pick<TextSelectionGestureController, 'begin'>;
  cancelCreation(): void;
  requestEditing(layerId: LayerId, offset: number, affinity: 'upstream' | 'downstream'): boolean;
  selectLayer(layerId: LayerId): Promise<unknown>;
  miss(intent: PendingTextPointerIntent | null, context: {
    point: Point; radius: number; tool: string; clickCount: number; extend: boolean;
  }): void;
  reportFailure(error: unknown): void;
}

/** Owns hit-to-edit activation only, not creation, typing or document publication. */
export class ExistingTextActivationController {
  private revision = 0;
  constructor(private readonly getPorts: () => ExistingTextActivationPorts) {}
  cancel = () => { ++this.revision; this.getPorts().hit.cancel(); };
  begin = (point: Point, mode: 'point' | 'paragraph' | 'any' = 'any',
    pointerId?: number, clickCount = 1, extend = false): boolean => {
    const p = this.getPorts(); const document = p.getDocument();
    if (!document) return false;
    const scope = p.captureScope(); const tool = p.getTool();
    const revision = ++this.revision;
    const isCurrent = () => revision === this.revision && scope.isCurrent()
      && this.getPorts().getTool() === tool;
    const candidates = visibleTextLayersTopmostFirst(document.layers).filter((node): node is TextLayer =>
      node.type === 'text' && node.text.source.kind === 'flow'
      && (mode === 'any' || node.text.source.layout.mode === mode));
    const active = candidates.find(({ id }) => id === document.activeLayerId);
    const ordered = [...(active ? [active] : []), ...candidates.filter(({ id }) => id !== active?.id)];
    const radius = 8 / Math.max(p.getScale(), 1e-6);
    const beginEditing = ({ layer, presentation, hit }: ExistingTextHitResult, allowPointer: boolean) => {
      if (!isCurrent() || layer.text.source.kind !== 'flow') return;
      const previous = p.editing.getSnapshot();
      const continuing = previous.status === 'editing' && previous.layerId === layer.id;
      if (!continuing && !p.requestEditing(layer.id, hit.offset, hit.affinity)) return;
      if (pointerId === undefined || !allowPointer) return;
      const granularity: TextSelectionGranularity = clickCount >= 5 ? 'story'
        : clickCount === 4 ? 'paragraph' : clickCount === 3 ? 'line' : clickCount === 2 ? 'word' : 'character';
      const clicked = textSelectionForGranularity(layer.text.source.text, presentation.layout, hit.offset, granularity);
      p.editing.setSelection(extend && continuing ? { anchor: previous.selection.anchor, focus: hit.offset } : clicked,
        { transient: true, caretAffinity: hit.affinity });
      p.selection.begin(pointerId, layer.id, extend && continuing
        ? { anchor: previous.selection.anchor, focus: previous.selection.anchor } : clicked,
      extend && continuing ? 'character' : granularity);
    };
    const resolution = p.hit.resolve(ordered, point, radius, (result, pointerFinished) => {
      if (!isCurrent() || result.layer.text.source.kind !== 'flow') return;
      p.cancelCreation();
      if (document.activeLayerId === result.layer.id) { beginEditing(result, !pointerFinished); return; }
      const renderer = p.getRenderer(); const sourceKey = textLayerSourceKey(result.layer);
      void p.selectLayer(result.layer.id).then(() => {
        if (!isCurrent()) return;
        const current = this.getPorts().getDocument();
        const layer = current ? findDocumentLayer(current, result.layer.id) : null;
        if (current?.id !== document.id || current.activeLayerId !== result.layer.id
          || this.getPorts().getRenderer() !== renderer || layer?.type !== 'text'
          || layer.text.source.kind !== 'flow' || textLayerSourceKey(layer) !== sourceKey) return;
        const presentation = renderer?.currentTextEditingLayout(layer.id);
        const hit = presentation ? hitTestTextEditingLayout(presentation, point, radius) : null;
        if (presentation && hit) beginEditing({ layer, presentation, hit }, false);
      }).catch(error => { if (isCurrent()) p.reportFailure(error); });
    }, intent => {
      if (isCurrent()) p.miss(intent, { point, radius, tool, clickCount, extend });
    }, pointerId);
    return resolution !== 'miss';
  };
}
