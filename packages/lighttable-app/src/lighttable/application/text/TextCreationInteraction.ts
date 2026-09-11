import type { DocumentFontAsset, ImageDocument, LayerId } from '../../editor/document/documentTypes';
import type { TextToolSettings } from '../../editor/session/editorSession';
import type { TextFontRuntimePort } from '../../editor/rendering/createLayerDocumentRendererRuntime';
import type { captureInteractionScope } from '../interactions/captureInteractionScope';
import { PointTextCreationController, ParagraphTextCreationController, resolveTextToolFont,
  textCreationKind, type PathTextCreationTarget } from './pointTextCreation';
import { pointTextCreateCommand, paragraphTextCreateCommand, pathTextCreateCommand,
  textCreateCommandParameters } from './semanticTextCommandExecutor';

type Point = { x: number; y: number };
interface TextCreationRenderer { configureTextFonts(port: TextFontRuntimePort): void }
export interface TextCreationPorts {
  getDocument(): ImageDocument | null;
  getTool(): string;
  getSettings(): TextToolSettings;
  getColor(): string;
  getScale(): number;
  getRenderer(): TextCreationRenderer | null;
  rendererReady(): boolean;
  getFontRuntime(): TextFontRuntimePort;
  getFontRegistry(): object;
  getFonts(): readonly DocumentFontAsset[];
  prepareFont(settings: TextToolSettings): Promise<unknown>;
  probe(): Promise<unknown>;
  captureScope(): ReturnType<typeof captureInteractionScope>;
  execute(parameters: unknown): Promise<{ status: string; value?: unknown }>;
  beginEditing(layerId: LayerId): void;
  setStatus(status: string | null): void;
  reportFailure(error: unknown): void;
}
interface CreationIntent {
  kind: 'point' | 'paragraph';
  p: TextCreationPorts;
  documentId: ImageDocument['id'];
  aboveLayerId: LayerId | null;
  tool: string;
  settings: TextToolSettings;
  color: string;
  registry: object;
  renderer: TextCreationRenderer;
  runtime: TextFontRuntimePort;
  scope: ReturnType<typeof captureInteractionScope>;
  path: PathTextCreationTarget | null;
  ready: boolean;
  finishRequested: boolean;
  dispatched: boolean;
  font: DocumentFontAsset | null;
}

/** Creation intent/readiness lifetime. Draft geometry and semantic publication keep their existing owners. */
export class TextCreationInteraction {
  private readonly point = new PointTextCreationController();
  private readonly paragraph = new ParagraphTextCreationController();
  private intent: CreationIntent | null = null;
  constructor(private readonly getPorts: () => TextCreationPorts) {}
  getSnapshot = () => this.paragraph.getSnapshot();
  subscribe = (listener: () => void) => this.paragraph.subscribe(listener);
  owns = (pointerId: number) => this.paragraph.owns(pointerId);
  move = (pointerId: number, point: Point) => this.paragraph.move(pointerId, point);

  private current(intent: CreationIntent, beforeDispatch = false) {
    const p = this.getPorts(); const doc = p.getDocument();
    return this.intent === intent && intent.scope.isCurrent() && doc?.id === intent.documentId
      && p.getTool() === intent.tool && p.getFontRegistry() === intent.registry
      && p.getRenderer() === intent.renderer && p.rendererReady()
      && (!beforeDispatch || doc.activeLayerId === intent.aboveLayerId);
  }
  cancel = () => {
    const intent = this.intent; this.intent = null;
    const point = this.point.cancel(); const paragraph = this.paragraph.cancel();
    if (intent && !intent.ready) intent.p.setStatus(null);
    return Boolean(intent || point || paragraph);
  };
  cancelPoint = () => this.intent?.kind === 'point' ? this.cancel() : this.point.cancel();
  cancelParagraph = () => this.intent?.kind === 'paragraph' ? this.cancel() : this.paragraph.cancel();
  cancelPointer = (pointerId: number) => this.owns(pointerId) && this.cancelParagraph();
  private admitPrepared(intent: CreationIntent) {
    if (this.current(intent, true)) return true;
    if (this.intent === intent) this.cancel();
    return false;
  }
  private open(kind: CreationIntent['kind'], path: PathTextCreationTarget | null) {
    this.cancel();
    const p = this.getPorts(); const document = p.getDocument(); const renderer = p.getRenderer();
    if (!document || !renderer || !p.rendererReady()) {
      p.setStatus('Text creation is unavailable until the WebGPU renderer is ready.'); return null;
    }
    const tool = p.getTool();
    if (tool !== 'text-point' && tool !== 'text-vertical' && tool !== 'text-path') return null;
    const intent: CreationIntent = { kind, p, documentId: document.id, aboveLayerId: document.activeLayerId,
      tool, settings: { ...p.getSettings() }, color: p.getColor(), registry: p.getFontRegistry(),
      renderer, runtime: p.getFontRuntime(), scope: p.captureScope(), path,
      ready: false, finishRequested: false, dispatched: false, font: null };
    this.intent = intent;
    p.setStatus('Preparing the text engine...');
    return intent;
  }
  private async prepare(intent: CreationIntent): Promise<boolean> {
    const { p } = intent;
    try {
      await p.prepareFont(intent.settings);
      if (!this.current(intent, true)) return false;
      await p.probe();
      if (!this.current(intent, true)) return false;
      const font = resolveTextToolFont(p.getFonts(), intent.settings);
      if (!font) throw new Error('The selected text font and style are unavailable. Choose an available face.');
      intent.renderer.configureTextFonts(intent.runtime);
      intent.font = font; intent.ready = true;
      return true;
    } catch (error) {
      if (this.current(intent)) {
        this.cancel();
        p.reportFailure(error instanceof Error ? new Error(`Text creation is unavailable: ${error.message}`, { cause: error }) : error);
      }
      return false;
    } finally {
      if (this.intent === intent) {
        if (!this.current(intent, true)) this.cancel();
        else p.setStatus(null);
      }
    }
  }
  beginPoint = async (origin: Point, path: PathTextCreationTarget | null = null) => {
    const intent = this.open('point', path);
    if (!intent || !await this.prepare(intent) || !this.admitPrepared(intent)) return;
    this.point.begin(intent.documentId, origin);
    this.commitPoint(true);
  };
  beginParagraph = (pointerId: number, origin: Point) => {
    const intent = this.open('paragraph', null);
    if (!intent) return false;
    if (!this.paragraph.begin(intent.documentId, intent.aboveLayerId, pointerId, origin)) {
      this.cancel(); return false;
    }
    void this.prepare(intent).then(ready => {
      if (ready && this.admitPrepared(intent) && intent.finishRequested) this.commitParagraph(true);
    });
    return true;
  };
  private dispatch(intent: CreationIntent, parameters: unknown, beginEditing: boolean) {
    intent.dispatched = true;
    void intent.p.execute(parameters).then(result => {
      if (!this.current(intent)) return;
      const layerId = (result.value as { layerId?: LayerId } | undefined)?.layerId;
      if (beginEditing && result.status === 'completed' && layerId
        && this.getPorts().getDocument()?.activeLayerId === layerId) intent.p.beginEditing(layerId);
      if (this.intent === intent) this.intent = null;
    }).catch(error => {
      if (this.current(intent)) { this.intent = null; intent.p.reportFailure(error); }
    });
    return true;
  }
  commitPoint = (beginEditing = false) => {
    const intent = this.intent;
    if (!intent || intent.kind !== 'point' || intent.dispatched || !intent.ready || !intent.font
      || !this.current(intent, true)) return false;
    const request = this.point.commit();
    if (!request) return false;
    const command = intent.path
      ? pathTextCreateCommand(request, intent.path, intent.settings, intent.font, intent.color)
      : pointTextCreateCommand(request, intent.settings, intent.font, intent.color, intent.tool === 'text-vertical');
    return this.dispatch(intent, textCreateCommandParameters(command), beginEditing);
  };
  commitParagraph = (beginEditing = false) => {
    const intent = this.intent;
    if (!intent || intent.kind !== 'paragraph' || intent.dispatched || !intent.ready || !intent.font
      || !this.current(intent, true)) return false;
    const request = this.paragraph.commit();
    if (!request) return false;
    return this.dispatch(intent, textCreateCommandParameters(paragraphTextCreateCommand(
      request, intent.settings, intent.font, intent.color, intent.tool === 'text-vertical')), beginEditing);
  };
  finish = (pointerId: number, point: Point) => {
    if (!this.owns(pointerId)) return false;
    this.paragraph.move(pointerId, point);
    const request = this.paragraph.getSnapshot().request; const intent = this.intent;
    if (!request || !intent || !this.current(intent, true)) { this.cancel(); return false; }
    if (textCreationKind(request.start, request.end, this.getPorts().getScale()) === 'point') {
      const origin = request.start; this.cancel(); void this.beginPoint(origin); return true;
    }
    if (!this.paragraph.finish(pointerId)) return false;
    intent.finishRequested = true;
    if (intent.ready) this.commitParagraph(true);
    return true;
  };
}
