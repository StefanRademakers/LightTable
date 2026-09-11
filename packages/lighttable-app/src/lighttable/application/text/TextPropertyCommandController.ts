import type { TextPaint } from '@lighttable/text-core';
import type { DocumentFontAsset, ImageDocument, LayerId } from '../../editor/document/documentTypes';
import type { TextToolSettings } from '../../editor/session/editorSession';
import { findDocumentLayer } from '../../editor/document/layerTree';
import { convertParagraphTextToPoint, convertPointTextToParagraph } from '../../editor/document/textLayerCommands';
import type { DocumentMutationController } from '../documents/useDocumentMutationController';
import type { captureInteractionScope } from '../interactions/captureInteractionScope';
import type { TextPropertyGestureController } from './TextPropertyGestureController';
import type { FlowTextEditingSessionController } from './flowTextEditingSession';
import type { ParagraphStylePatch, TextStylePatch } from './flowTextFormatting';
import { defaultTextStyleForFamily } from './pointTextCreation';
import { semanticParagraphPatchFromCanonical, semanticStylePatchFromCanonical } from './semanticTextCommandExecutor';
import { textFillEnabledPatch, textFillPatchFromHex, textFontPatch, textStrokePatch,
  type TextPropertyPresentation } from './textPropertyPresentation';

export interface TextPropertyCommandPorts {
  getDocument(): ImageDocument | null;
  getTool(): string;
  captureScope(): ReturnType<typeof captureInteractionScope>;
  getFontRegistry(): object;
  getFonts(): readonly DocumentFontAsset[];
  loadFont(assetId: string): Promise<DocumentFontAsset | null>;
  getPresentation(): TextPropertyPresentation | null;
  getBrushColor(): string;
  updateBrushColor(color: string): void;
  updateDefaults(recipe: (current: TextToolSettings) => TextToolSettings): void;
  getFirstBaselineOffset(layerId: LayerId): number;
  gestures: Pick<TextPropertyGestureController, 'begin' | 'apply' | 'queuePaint' | 'commit' | 'cancel'>;
  editing: Pick<FlowTextEditingSessionController, 'getSnapshot' | 'finish' | 'begin'>;
  mutations: Pick<DocumentMutationController, 'change'>;
  execute(command: 'text.format' | 'text.setLayout', parameters: unknown): Promise<{ status: string }>;
  activateTool(tool: 'text-point' | 'text-vertical', after?: () => void): void;
  reportFailure(error: unknown): void;
}

/** Text-properties intents only. Gestures, font bytes and semantic edits retain their existing owners. */
export class TextPropertyCommandController {
  private generation = 0;
  constructor(private readonly getPorts: () => TextPropertyCommandPorts) {}
  cancelPending = () => { ++this.generation; };
  private flowLayer() {
    const document = this.getPorts().getDocument();
    const layer = document ? findDocumentLayer(document, document.activeLayerId) : null;
    return layer?.type === 'text' && layer.text.source.kind === 'flow' ? layer : null;
  }
  private captureIntent() {
    const p = this.getPorts(); const scope = p.captureScope();
    const document = p.getDocument(); const layerId = document?.activeLayerId;
    const layer = document ? findDocumentLayer(document, layerId ?? null) : null;
    const source = layer?.type === 'text' ? layer.text.source : null;
    const editing = p.editing.getSnapshot(); const tool = p.getTool();
    const registry = p.getFontRegistry();
    return { p, isCurrent: () => {
      const current = this.getPorts(); const doc = current.getDocument();
      const node = doc ? findDocumentLayer(doc, doc.activeLayerId) : null;
      const nextEditing = current.editing.getSnapshot();
      return scope.isCurrent() && doc?.id === document?.id && doc?.activeLayerId === layerId
        && (node?.type === 'text' ? node.text.source : null) === source
        && current.getTool() === tool && current.getFontRegistry() === registry
        && editing.status === nextEditing.status && editing.layerId === nextEditing.layerId
        && editing.selection.anchor === nextEditing.selection.anchor
        && editing.selection.focus === nextEditing.selection.focus;
    } };
  }
  updateDefaults = (change: Partial<TextToolSettings>) => {
    const p = this.getPorts();
    p.updateDefaults(current => ({ ...current, ...change,
      ...(change.family && change.family !== current.family && change.style === undefined
        ? { style: defaultTextStyleForFamily(p.getFonts(), change.family) ?? current.style } : {}) }));
  };
  begin = () => this.getPorts().gestures.begin(this.flowLayer()?.id);
  apply = (style: TextStylePatch, paragraph: ParagraphStylePatch = {}) => this.getPorts().gestures.apply(style, paragraph);
  commit = () => this.getPorts().gestures.commit();
  cancel = () => this.getPorts().gestures.cancel();
  private discrete(stylePatch: TextStylePatch, paragraphPatch: ParagraphStylePatch) {
    const p = this.getPorts(); const layer = this.flowLayer();
    const style = semanticStylePatchFromCanonical(stylePatch);
    const paragraph = semanticParagraphPatchFromCanonical(paragraphPatch);
    if (!layer || !style || !paragraph) return false;
    const editing = p.editing.getSnapshot();
    if (editing.status === 'editing' && editing.layerId === layer.id) {
      if (!p.gestures.begin(layer.id)) return false;
      p.gestures.apply(stylePatch, paragraphPatch); p.gestures.commit();
    } else {
      void p.execute('text.format', { layerId: layer.id,
        ...(Object.keys(style).length ? { style } : {}),
        ...(Object.keys(paragraph).length ? { paragraph } : {}) }).catch(p.reportFailure);
    }
    return true;
  }
  applyStyle = (patch: TextStylePatch) => this.discrete(patch, {});
  applyParagraph = (patch: ParagraphStylePatch) => this.discrete({}, patch);
  applyFont = async (assetId: string): Promise<void> => {
    const sequence = ++this.generation; const intent = this.captureIntent();
    const asset = await intent.p.loadFont(assetId);
    if (sequence !== this.generation || !intent.isCurrent()) return;
    if (!asset) throw new Error('The selected text font is unavailable.');
    if (!intent.p.getPresentation()) this.updateDefaults({ family: asset.familyNames[0]!, style: asset.styleName });
    else this.applyStyle(textFontPatch(asset));
  };
  applyFill = (fill: string) => {
    const p = this.getPorts();
    if (!p.getPresentation()) { p.updateBrushColor(fill); return; }
    const patch = textFillPatchFromHex(fill);
    if (patch) p.gestures.queuePaint(patch);
  };
  applyFillPaint = (fill: TextPaint) => this.getPorts().gestures.queuePaint({ fill: structuredClone(fill) });
  applyFillEnabled = (enabled: boolean) => {
    const p = this.getPorts(); const model = p.getPresentation();
    if (!model) { this.updateDefaults({ fillEnabled: enabled }); return; }
    this.applyStyle(textFillEnabledPatch(enabled, model.fill.kind === 'value' ? model.fill.value : p.getBrushColor()));
  };
  applyStrokeColor = (stroke: string) => {
    const p = this.getPorts(); const model = p.getPresentation();
    const width = model?.strokeWidth.kind === 'value' && model.strokeWidth.value > 0 ? model.strokeWidth.value : 1;
    const patch = textStrokePatch(stroke, width);
    if (patch) p.gestures.queuePaint(patch);
  };
  applyStrokeWidth = (width: number) => {
    const model = this.getPorts().getPresentation();
    const patch = textStrokePatch(model?.strokeColor.kind === 'value' ? model.strokeColor.value : '#000000', width);
    if (patch) this.apply(patch);
  };
  applyWritingMode = async (writingMode: 'horizontal-tb' | 'vertical-rl' | 'vertical-lr') => {
    const p = this.getPorts(); const layer = this.flowLayer();
    if (!layer || layer.text.source.kind !== 'flow' || layer.text.source.layout.mode === 'path') return;
    const sequence = ++this.generation;
    p.editing.finish();
    const scope = p.captureScope(); const tool = p.getTool();
    const result = await p.execute('text.setLayout', { layerId: layer.id, writingMode });
    // The command may change the source; continuation requires original scope/target/tool, not source equality.
    if (sequence === this.generation && result.status === 'completed' && scope.isCurrent()
      && this.getPorts().getDocument()?.activeLayerId === layer.id && this.getPorts().getTool() === tool) {
      p.activateTool(writingMode === 'horizontal-tb' ? 'text-point' : 'text-vertical');
    }
  };
  changeLayoutMode = (mode: 'point' | 'paragraph') => {
    const p = this.getPorts(); const layer = this.flowLayer();
    if (!layer || layer.text.source.kind !== 'flow' || layer.text.source.layout.mode === mode) return;
    const editing = p.editing.getSnapshot(); const scope = p.captureScope();
    const restore = editing.status === 'editing' && editing.layerId === layer.id;
    const firstBaselineOffset = p.getFirstBaselineOffset(layer.id);
    if (restore) p.editing.finish();
    const changed = p.mutations.change(document => mode === 'paragraph'
      ? convertPointTextToParagraph(document, layer.id, { width: 240, height: 120, firstBaselineOffset })
      : convertParagraphTextToPoint(document, layer.id, { firstBaselineOffset }), true,
    { label: mode === 'paragraph' ? 'Convert to Paragraph Text' : 'Convert to Point Text',
      type: 'text.set-layout', layerIds: [layer.id] });
    if (changed) p.activateTool('text-point', () => {
      if (restore && scope.isCurrent() && this.getPorts().getDocument()?.activeLayerId === layer.id) {
        p.editing.begin(layer.id, editing.selection.focus);
      }
    });
  };
}
