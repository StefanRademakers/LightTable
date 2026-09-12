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
  execute(parameters: unknown): Promise<{ status: string; value?: unknown; message?: string }>;
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
  fileFinishRequested: boolean;
  terminal: Promise<CreationTerminal>;
  complete(result: CreationTerminal): void;
}
type CreationTerminal = { status: 'completed' } | { status: 'canceled' | 'failed'; error: Error };

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
    return this.intent === intent && this.bindingCurrent(intent, beforeDispatch);
  }
  private bindingCurrent(intent: CreationIntent, beforeDispatch = false) {
    const p = this.getPorts(); const doc = p.getDocument();
    return intent.scope.isCurrent() && doc?.id === intent.documentId
      && p.getTool() === intent.tool && p.getFontRegistry() === intent.registry
      && p.getRenderer() === intent.renderer && p.rendererReady()
      && (!beforeDispatch || doc.activeLayerId === intent.aboveLayerId);
  }
  cancel = () => {
    const intent = this.intent; this.intent = null;
    const point = this.point.cancel(); const paragraph = this.paragraph.cancel();
    intent?.complete({ status: 'canceled', error: new Error('Text creation was retired before file preparation completed.') });
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
    let complete!: (result: CreationTerminal) => void;
    const terminal = new Promise<CreationTerminal>(resolve => { complete = resolve; });
    const intent: CreationIntent = { kind, p, documentId: document.id, aboveLayerId: document.activeLayerId,
      tool, settings: { ...p.getSettings() }, color: p.getColor(), registry: p.getFontRegistry(),
      renderer, runtime: p.getFontRuntime(), scope: p.captureScope(), path,
      ready: false, finishRequested: false, dispatched: false, font: null,
      fileFinishRequested: false, terminal, complete };
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
        const failure = error instanceof Error
          ? new Error(`Text creation is unavailable: ${error.message}`, { cause: error })
          : new Error('Text creation is unavailable.', { cause: error });
        intent.complete({ status: 'failed', error: failure });
        this.cancel();
        p.reportFailure(failure);
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
    this.commitPoint(!intent.fileFinishRequested);
  };
  beginParagraph = (pointerId: number, origin: Point) => {
    const intent = this.open('paragraph', null);
    if (!intent) return false;
    if (!this.paragraph.begin(intent.documentId, intent.aboveLayerId, pointerId, origin)) {
      this.cancel(); return false;
    }
    void this.prepare(intent).then(ready => {
      if (ready && this.admitPrepared(intent) && intent.finishRequested) this.commitParagraph(!intent.fileFinishRequested);
    });
    return true;
  };
  private dispatch(intent: CreationIntent, parameters: unknown, beginEditing: boolean) {
    intent.dispatched = true;
    const execute = async () => intent.p.execute(parameters);
    void execute().then(result => {
      if (!this.current(intent)) {
        intent.complete({ status: 'canceled', error: new Error('Text creation completed for a retired file target.') });
        return;
      }
      if (result.status !== 'completed') throw new Error(result.message ?? 'Text creation did not complete.');
      const layerId = (result.value as { layerId?: LayerId } | undefined)?.layerId;
      if (this.intent === intent) this.intent = null;
      intent.complete({ status: 'completed' });
      if (beginEditing && !intent.fileFinishRequested && layerId
        && this.getPorts().getDocument()?.activeLayerId === layerId) intent.p.beginEditing(layerId);
    }).catch(error => {
      intent.complete({ status: 'failed', error: error instanceof Error ? error : new Error(String(error)) });
      if (this.current(intent) || (!this.intent && this.bindingCurrent(intent))) {
        this.intent = null; intent.p.reportFailure(error);
      }
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
  /** A queued export cannot await text.create behind its own command turn. */
  assertFileCommandReady = (): void => {
    if (this.intent && this.current(this.intent)) {
      throw new Error('Finish the pending text creation before exporting through a command.');
    }
  };
  /** File intents await the existing creation, including cold fonts and command publication. */
  finishForFile = async (): Promise<void> => {
    let intent = this.intent;
    if (!intent) return;
    if (!this.current(intent)) {
      if (this.intent === intent) this.cancel();
      throw new Error('Text creation belongs to a retired file target.');
    }
    intent.fileFinishRequested = true;
    const paragraph = this.paragraph.getSnapshot();
    if (intent.kind === 'paragraph' && paragraph.status === 'dragging' && paragraph.request?.pointerId != null) {
      // Use the normal pointer terminal, including its short-drag point conversion.
      this.finish(paragraph.request.pointerId, paragraph.request.end);
      intent = this.intent;
      if (!intent) throw new Error('The text creation was retired while preparing the file operation.');
      intent.fileFinishRequested = true;
    }
    intent.finishRequested = true;
    // Point creation's begin continuation always dispatches itself. Do not
    // race it between font readiness and point-draft initialization.
    if (intent.kind === 'paragraph' && intent.ready && !intent.dispatched) {
      if (!this.commitParagraph()) {
        this.cancel();
        throw new Error('The pending text creation could not be committed for the file operation.');
      }
    }
    const result = await intent.terminal;
    if (result.status !== 'completed') throw result.error;
    if (!this.bindingCurrent(intent)) throw new Error('Text creation completed for a retired file target.');
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
