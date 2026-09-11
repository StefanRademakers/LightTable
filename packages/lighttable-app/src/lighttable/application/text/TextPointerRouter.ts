import type { ImageDocument } from '../../editor/document/documentTypes';
import type { VectorEditorSelection } from '../../editor/session/editorSession';
import type { ExistingTextActivationController, ExistingTextActivationPorts } from './ExistingTextActivationController';
import type { ExistingTextHitController } from './ExistingTextHitController';
import type { TextCreationInteraction } from './TextCreationInteraction';
import { resolvePathTextCreationTargetAtPoint } from './pathTextCreationTarget';

type Point = { x: number; y: number };
interface PointerParticipant {
  owns(pointerId: number): boolean;
  move(pointerId: number, point: Point): boolean;
  finish(pointerId: number, point: Point): boolean;
  cancel(pointerId: number): boolean;
}
interface HandleParticipant extends PointerParticipant {
  begin(pointerId: number, point: Point, radius: number): boolean;
}
export interface TextPointerPorts {
  getDocument(): ImageDocument | null;
  getTool(): string;
  getScale(): number;
  getVectorSelection(): VectorEditorSelection;
  activation: Pick<ExistingTextActivationController, 'begin'>;
  pendingHit: Pick<ExistingTextHitController, 'owns' | 'move' | 'finish' | 'cancelPointer'>;
  layerMove: PointerParticipant & { begin(pointerId: number, point: Point): boolean };
  pathHandle: HandleParticipant;
  frameResize: HandleParticipant;
  selection: PointerParticipant;
  creation: Pick<TextCreationInteraction, 'owns' | 'move' | 'finish' | 'cancelPointer' | 'beginPoint' | 'beginParagraph'>;
  finishEditing(): void;
  reportFailure(message: string): void;
}

/** Type-tool pointer precedence only; each participant retains its own gesture and terminal state. */
export class TextPointerRouter {
  constructor(private readonly getPorts: () => TextPointerPorts) {}
  private radius() { return 8 / Math.max(this.getPorts().getScale(), 1e-6); }
  private createPath(point: Point, deferred: boolean, radius: number) {
    const p = this.getPorts(); const document = p.getDocument();
    const result = document ? resolvePathTextCreationTargetAtPoint(
      document, p.getVectorSelection(), point, radius) : { kind: 'none' as const };
    if (result.kind === 'resolved') { void p.creation.beginPoint(point, result.target); return; }
    p.reportFailure(result.kind === 'live-shape'
      ? 'Path text requires a native path. Convert the selected shape to a path first.'
      : result.kind === 'ambiguous-subpath' ? 'Select exactly one contour for Path Text.'
        : deferred ? 'Click one native path before creating Path Text.'
          : 'Select exactly one native path before creating Path Text.');
  }
  createAtPoint = (point: Point, clickCount: number, extend: boolean) => {
    const p = this.getPorts();
    if (p.activation.begin(point, 'any', undefined, clickCount, extend)) return;
    p.finishEditing();
    if (p.getTool() === 'text-path') this.createPath(point, false, this.radius());
    else void p.creation.beginPoint(point);
  };
  beginPoint = (pointerId: number, point: Point, temporaryMove: boolean, clickCount: number, extend: boolean) => {
    const p = this.getPorts();
    return (temporaryMove && p.layerMove.begin(pointerId, point))
      || p.pathHandle.begin(pointerId, point, this.radius())
      || p.activation.begin(point, 'any', pointerId, clickCount, extend);
  };
  beginParagraph = (pointerId: number, point: Point, temporaryMove: boolean, clickCount: number, extend: boolean) => {
    const p = this.getPorts();
    return (temporaryMove && p.layerMove.begin(pointerId, point))
      || p.pathHandle.begin(pointerId, point, this.radius())
      || this.paragraphDraft(pointerId, point, clickCount, extend, false);
  };
  private paragraphDraft(pointerId: number, point: Point, clickCount: number, extend: boolean, skipHit: boolean) {
    const p = this.getPorts();
    if (p.frameResize.begin(pointerId, point, this.radius())) return true;
    if (!skipHit && p.activation.begin(point, 'any', pointerId, clickCount, extend)) return true;
    p.finishEditing(); return p.creation.beginParagraph(pointerId, point);
  }
  miss: ExistingTextActivationPorts['miss'] = (intent, { point, radius, tool, clickCount, extend }) => {
    const p = this.getPorts();
    if (tool === 'text-path') { this.createPath(intent?.current ?? point, true, radius); return; }
    if (!intent) { void p.creation.beginPoint(point); return; }
    if (!this.paragraphDraft(intent.pointerId, intent.start, clickCount, extend, true)) return;
    if (intent.current.x !== intent.start.x || intent.current.y !== intent.start.y) {
      this.move(intent.pointerId, intent.current);
    }
    if (intent.finished) this.finish(intent.pointerId, intent.current);
  };
  private participant(pointerId: number) {
    const p = this.getPorts();
    if (p.pendingHit.owns(pointerId)) return p.pendingHit;
    if (p.layerMove.owns(pointerId)) return p.layerMove;
    if (p.selection.owns(pointerId)) return p.selection;
    if (p.pathHandle.owns(pointerId)) return p.pathHandle;
    if (p.frameResize.owns(pointerId)) return p.frameResize;
    return p.creation.owns(pointerId) ? p.creation : null;
  }
  owns = (pointerId: number) => this.participant(pointerId) !== null;
  move = (pointerId: number, point: Point) => this.participant(pointerId)?.move(pointerId, point) ?? false;
  finish = (pointerId: number, point: Point) => this.participant(pointerId)?.finish(pointerId, point) ?? false;
  cancel = (pointerId: number) => {
    const p = this.getPorts();
    return p.pendingHit.cancelPointer(pointerId) || p.layerMove.cancel(pointerId)
      || p.selection.cancel(pointerId) || p.pathHandle.cancel(pointerId)
      || p.frameResize.cancel(pointerId) || p.creation.cancelPointer(pointerId);
  };
}
