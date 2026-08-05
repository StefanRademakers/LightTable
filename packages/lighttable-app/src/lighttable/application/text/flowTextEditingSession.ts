import {
  createDefaultFlowTextSource,
  type FlowTextSource,
  type ParagraphStyleRun,
  type RealizedTextLayout,
  type TextStyleRun
} from '@lighttable/text-core';
import type { ImageDocument, LayerId } from '../../editor/document/documentTypes';
import { findDocumentLayer } from '../../editor/document/layerTree';
import {
  createTextEditTransactionController,
  type TextEditGroupKind,
  type TextEditHistoryEntry
} from './textEditTransactionController';
import {
  deleteFlowTextSelection,
  moveTextSelection,
  moveTextSelectionHorizontallyInLayout,
  moveTextSelectionInLayout,
  orderedTextSelection,
  replaceFlowTextSelection,
  snapTextOffset,
  type TextSelectionRange
} from './flowTextEditing';
import {
  formatFlowTextSource,
  projectFlowTextFormat,
  type FlowTextFormatProjection,
  type ParagraphStylePatch,
  type TextStylePatch
} from './flowTextFormatting';

export interface FlowTextEditingSnapshot {
  readonly status: 'idle' | 'editing';
  readonly documentId: ImageDocument['id'] | null;
  readonly layerId: LayerId | null;
  readonly selection: TextSelectionRange;
  readonly compositionRange: TextSelectionRange | null;
  readonly caretAffinity: 'upstream' | 'downstream';
  readonly preferredCaretX: number | null;
  readonly focusKey: number;
}

export interface FlowTextEditingDependencies {
  getDocument(): ImageDocument | null;
  applyDocument(document: ImageDocument): void;
  pushHistory(entry: TextEditHistoryEntry): void;
}

const IDLE_SNAPSHOT: FlowTextEditingSnapshot = Object.freeze({
  status: 'idle', documentId: null, layerId: null,
  selection: Object.freeze({ anchor: 0, focus: 0 }), compositionRange: null,
  caretAffinity: 'downstream', preferredCaretX: null, focusKey: 0
});

const DEFAULT_INSERTION_SOURCE = createDefaultFlowTextSource('x');

const flowSourceFor = (document: ImageDocument | null, layerId: LayerId | null) => {
  if (!document || !layerId) return null;
  const layer = findDocumentLayer(document, layerId);
  return layer?.type === 'text' && layer.text.source.kind === 'flow'
    ? layer.text.source
    : null;
};

export class FlowTextEditingSessionController {
  private snapshot: FlowTextEditingSnapshot = IDLE_SNAPSHOT;
  private readonly listeners = new Set<() => void>();
  private shellSnapshot: FlowTextEditingSnapshot = IDLE_SNAPSHOT;
  private shellSignature = 'idle';
  private readonly shellListeners = new Set<() => void>();
  private openGroup: TextEditGroupKind | null = null;
  private compositionText = '';
  private deleteSignature = '';
  private insertionStyle: TextStyleRun | undefined;
  private insertionParagraph: ParagraphStyleRun | undefined;
  private formattingInsertionBefore: {
    readonly style: TextStyleRun | undefined;
    readonly paragraph: ParagraphStyleRun | undefined;
  } | null = null;
  private focusSequence = 0;
  private readonly transaction = createTextEditTransactionController(
    () => this.dependencies()
  );

  constructor(private readonly dependencies: () => FlowTextEditingDependencies) {}

  readonly getSnapshot = () => this.snapshot;
  /**
   * Coarse UI state. Ordinary caret/selection movement remains on the isolated
   * input/GPU path unless it changes the effective property projection.
   */
  readonly getShellSnapshot = () => this.shellSnapshot;
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  readonly subscribeShell = (listener: () => void) => {
    this.shellListeners.add(listener);
    return () => this.shellListeners.delete(listener);
  };

  begin(layerId: LayerId, offset?: number, caretAffinity: 'upstream' | 'downstream' = 'downstream') {
    this.finish();
    const document = this.dependencies().getDocument();
    const source = flowSourceFor(document, layerId);
    if (!document || !source) return false;
    const focus = snapTextOffset(source.text, offset ?? source.text.length);
    this.captureInsertionStyle(source, focus);
    this.publish({
      status: 'editing', documentId: document.id, layerId,
      selection: { anchor: focus, focus }, compositionRange: null, caretAffinity,
      preferredCaretX: null, focusKey: ++this.focusSequence
    });
    return true;
  }

  setSelection(selection: TextSelectionRange, options: { readonly transient?: boolean } = {}) {
    const source = this.currentSource();
    if (!source) return false;
    this.commitOpenGroup();
    const anchor = snapTextOffset(source.text, selection.anchor);
    const focus = snapTextOffset(source.text, selection.focus);
    this.captureInsertionStyle(source, focus);
    this.publish({
      ...this.snapshot, selection: { anchor, focus }, compositionRange: null,
      caretAffinity: 'downstream', preferredCaretX: null
    }, !options.transient);
    return true;
  }

  insert(text: string) {
    if (!text || !this.ensureGroup('typing')) return false;
    return this.replaceSelection(text);
  }

  paste(text: string) {
    if (!text) return false;
    this.commitOpenGroup();
    if (!this.ensureGroup('typing')) return false;
    const changed = this.replaceSelection(text);
    this.commitOpenGroup();
    return changed;
  }

  delete(direction: 'backward' | 'forward', unit: 'grapheme' | 'word' = 'grapheme') {
    const signature = `${direction}:${unit}`;
    if (this.openGroup === 'delete' && this.deleteSignature !== signature) {
      this.commitOpenGroup();
    }
    if (!this.ensureGroup('delete')) return false;
    this.deleteSignature = signature;
    let resultSelection = this.snapshot.selection;
    const changed = this.transaction.apply((text) => {
      if (text.source.kind !== 'flow') return text;
      const result = deleteFlowTextSelection(text.source, this.snapshot.selection, direction, unit);
      resultSelection = result.selection;
      return { ...text, source: result.source };
    });
    if (changed) this.publish({ ...this.snapshot, selection: resultSelection, compositionRange: null });
    return changed;
  }

  navigate(
    direction: 'backward' | 'forward',
    options: { readonly extend?: boolean; readonly unit?: 'grapheme' | 'word' | 'paragraph' } = {}
  ) {
    const source = this.currentSource();
    if (!source) return false;
    this.commitOpenGroup();
    const selection = moveTextSelection(source.text, this.snapshot.selection, direction, options);
    this.captureInsertionStyle(source, selection.focus);
    this.publish({
      ...this.snapshot,
      selection,
      compositionRange: null,
      caretAffinity: direction === 'backward' ? 'upstream' : 'downstream',
      preferredCaretX: null
    });
    return true;
  }

  navigateLayout(
    layout: RealizedTextLayout,
    command: 'line-start' | 'line-end' | 'line-up' | 'line-down',
    extend = false
  ) {
    if (!this.currentSource()) return false;
    this.commitOpenGroup();
    const result = moveTextSelectionInLayout(
      layout,
      this.snapshot.selection,
      command,
      extend,
      this.snapshot.caretAffinity,
      this.snapshot.preferredCaretX
    );
    const source = this.currentSource();
    if (source) this.captureInsertionStyle(source, result.selection.focus);
    this.publish({
      ...this.snapshot,
      selection: result.selection,
      compositionRange: null,
      caretAffinity: result.affinity,
      preferredCaretX: result.preferredX
    });
    return true;
  }

  navigateLayoutHorizontal(
    layout: RealizedTextLayout,
    direction: 'backward' | 'forward',
    extend = false
  ) {
    const source = this.currentSource();
    if (!source) return false;
    this.commitOpenGroup();
    const result = moveTextSelectionHorizontallyInLayout(
      layout, this.snapshot.selection, direction, extend, this.snapshot.caretAffinity
    );
    this.captureInsertionStyle(source, result.selection.focus);
    this.publish({
      ...this.snapshot,
      selection: result.selection,
      compositionRange: null,
      caretAffinity: result.affinity,
      preferredCaretX: null
    });
    return true;
  }

  moveToBoundary(boundary: 'start' | 'end', extend = false) {
    const source = this.currentSource();
    if (!source) return false;
    this.commitOpenGroup();
    const focus = boundary === 'start' ? 0 : source.text.length;
    this.captureInsertionStyle(source, focus);
    this.publish({
      ...this.snapshot,
      selection: extend ? { anchor: this.snapshot.selection.anchor, focus } : { anchor: focus, focus },
      compositionRange: null,
      caretAffinity: boundary === 'start' ? 'downstream' : 'upstream',
      preferredCaretX: null
    });
    return true;
  }

  navigateLogicalLine(command: 'line-start' | 'line-end' | 'line-up' | 'line-down', extend = false) {
    const source = this.currentSource();
    if (!source) return false;
    this.commitOpenGroup();
    const text = source.text;
    const focus = this.snapshot.selection.focus;
    const lineStart = text.lastIndexOf('\n', Math.max(0, focus - 1)) + 1;
    const nextBreak = text.indexOf('\n', focus);
    const lineEnd = nextBreak < 0 ? text.length : nextBreak;
    let target = command === 'line-start' ? lineStart : lineEnd;
    if (command === 'line-up') {
      const previousEnd = Math.max(0, lineStart - 1);
      const previousStart = text.lastIndexOf('\n', Math.max(0, previousEnd - 1)) + 1;
      target = previousStart + Math.min(focus - lineStart, previousEnd - previousStart);
    } else if (command === 'line-down') {
      if (nextBreak < 0) target = lineEnd;
      else {
        const nextStart = nextBreak + 1;
        const followingBreak = text.indexOf('\n', nextStart);
        const nextEnd = followingBreak < 0 ? text.length : followingBreak;
        target = nextStart + Math.min(focus - lineStart, nextEnd - nextStart);
      }
    }
    target = snapTextOffset(text, target);
    this.captureInsertionStyle(source, target);
    this.publish({
      ...this.snapshot,
      selection: extend
        ? { anchor: this.snapshot.selection.anchor, focus: target }
        : { anchor: target, focus: target },
      compositionRange: null,
      caretAffinity: target <= focus ? 'upstream' : 'downstream',
      preferredCaretX: null
    });
    return true;
  }

  selectAll() {
    const source = this.currentSource();
    if (!source) return false;
    this.commitOpenGroup();
    this.publish({
      ...this.snapshot,
      selection: { anchor: 0, focus: source.text.length },
      compositionRange: null,
      caretAffinity: 'upstream', preferredCaretX: null
    });
    return true;
  }

  compositionStart() {
    if (!this.currentSource()) return false;
    this.commitOpenGroup();
    if (!this.ensureGroup('composition')) return false;
    this.compositionText = '';
    this.deleteSignature = '';
    this.publish({ ...this.snapshot, compositionRange: this.snapshot.selection });
    return true;
  }

  compositionUpdate(text: string) {
    if (this.openGroup !== 'composition' || !this.snapshot.compositionRange) return false;
    if (text === this.compositionText) return false;
    const replacementRange = this.snapshot.compositionRange;
    let resultSelection = this.snapshot.selection;
    const changed = this.transaction.apply((data) => {
      if (data.source.kind !== 'flow') return data;
      const result = replaceFlowTextSelection(
        data.source,
        replacementRange,
        text,
        this.insertionStyle,
        this.insertionParagraph
      );
      resultSelection = result.selection;
      return { ...data, source: result.source };
    });
    if (!changed) return false;
    const start = orderedTextSelection(replacementRange).start;
    this.compositionText = text;
    this.publish({
      ...this.snapshot,
      selection: resultSelection,
      compositionRange: { anchor: start, focus: resultSelection.focus }
    });
    return true;
  }

  compositionEnd(text: string) {
    if (this.openGroup !== 'composition') return false;
    if (text !== this.compositionText) this.compositionUpdate(text);
    const changed = this.commitOpenGroup();
    this.publish({ ...this.snapshot, compositionRange: null });
    return changed;
  }

  selectedText() {
    const source = this.currentSource(false);
    if (!source) return '';
    const { start, end } = orderedTextSelection(this.snapshot.selection);
    return source.text.slice(start, end);
  }

  text() {
    return this.currentSource(false)?.text ?? '';
  }

  formatProjection(): FlowTextFormatProjection | null {
    const source = this.currentSource(false);
    return source
      ? projectFlowTextFormat(
          source,
          this.snapshot.selection,
          this.insertionStyle,
          this.insertionParagraph
        )
      : null;
  }

  beginFormatting() {
    this.commitOpenGroup();
    if (!this.ensureGroup('format')) return false;
    this.formattingInsertionBefore = {
      style: this.insertionStyle,
      paragraph: this.insertionParagraph
    };
    return true;
  }

  format(stylePatch: TextStylePatch, paragraphPatch: ParagraphStylePatch = {}) {
    if (this.openGroup !== 'format' && !this.beginFormatting()) return false;
    let nextInsertionStyle = this.insertionStyle;
    let nextInsertionParagraph = this.insertionParagraph;
    const changed = this.transaction.apply((data) => {
      if (data.source.kind !== 'flow') return data;
      const source = formatFlowTextSource(
        data.source,
        this.snapshot.selection,
        stylePatch,
        paragraphPatch,
        this.insertionStyle,
        this.insertionParagraph
      );
      if (source.insertionStyle) {
        nextInsertionStyle = { ...source.insertionStyle, start: 0, end: 0 };
      }
      if (source.insertionParagraph) {
        nextInsertionParagraph = { ...source.insertionParagraph, start: 0, end: 0 };
      }
      return { ...data, source };
    });
    if (changed) {
      this.insertionStyle = nextInsertionStyle;
      this.insertionParagraph = nextInsertionParagraph;
      this.publish({ ...this.snapshot });
    }
    return changed;
  }

  endFormatting() {
    if (this.openGroup !== 'format') return false;
    const changed = this.commitOpenGroup();
    this.formattingInsertionBefore = null;
    return changed;
  }

  cancelFormatting() {
    if (this.openGroup !== 'format') return false;
    const cancelled = this.transaction.cancel();
    this.openGroup = null;
    this.insertionStyle = this.formattingInsertionBefore?.style;
    this.insertionParagraph = this.formattingInsertionBefore?.paragraph;
    this.formattingInsertionBefore = null;
    this.publish({ ...this.snapshot });
    return cancelled;
  }

  checkpoint() {
    const wasComposing = this.openGroup === 'composition';
    const changed = this.commitOpenGroup();
    if (wasComposing && this.snapshot.status === 'editing') {
      this.publish({ ...this.snapshot, compositionRange: null });
    }
    return changed;
  }

  finish() {
    if (this.snapshot.status === 'idle') return false;
    this.commitOpenGroup();
    this.compositionText = '';
    this.deleteSignature = '';
    this.insertionStyle = undefined;
    this.insertionParagraph = undefined;
    this.formattingInsertionBefore = null;
    this.publish(IDLE_SNAPSHOT);
    return true;
  }

  cancelComposition() {
    if (this.openGroup !== 'composition') return false;
    const cancelled = this.transaction.cancel();
    this.openGroup = null;
    this.compositionText = '';
    this.deleteSignature = '';
    this.publish({ ...this.snapshot, compositionRange: null });
    return cancelled;
  }

  reset() {
    this.transaction.reset();
    this.openGroup = null;
    this.compositionText = '';
    this.deleteSignature = '';
    this.insertionStyle = undefined;
    this.insertionParagraph = undefined;
    this.formattingInsertionBefore = null;
    this.publish(IDLE_SNAPSHOT);
  }

  private currentSource(resetIfMissing = true): FlowTextSource | null {
    const document = this.dependencies().getDocument();
    const source = document?.id === this.snapshot.documentId
      ? flowSourceFor(document, this.snapshot.layerId)
      : null;
    if (!source && resetIfMissing) {
      this.reset();
      return null;
    }
    return source;
  }

  private ensureGroup(group: TextEditGroupKind) {
    if (!this.currentSource()) return false;
    if (this.openGroup === group) return true;
    this.commitOpenGroup();
    if (!this.snapshot.layerId || !this.transaction.begin(this.snapshot.layerId, group)) return false;
    this.openGroup = group;
    return true;
  }

  private captureInsertionStyle(source: FlowTextSource, offset: number) {
    this.insertionStyle = source.styleRuns.find(
      (run) => run.start <= offset && offset < run.end
    ) ?? source.styleRuns.at(-1)
      ?? (source.insertionStyle ? { ...source.insertionStyle, start: 0, end: 0 } : undefined)
      ?? this.insertionStyle ?? DEFAULT_INSERTION_SOURCE.styleRuns[0];
    this.insertionParagraph = source.paragraphRuns.find(
      (run) => run.start <= offset && offset < run.end
    ) ?? source.paragraphRuns.at(-1)
      ?? (source.insertionParagraph ? { ...source.insertionParagraph, start: 0, end: 0 } : undefined)
      ?? this.insertionParagraph ?? DEFAULT_INSERTION_SOURCE.paragraphRuns[0];
  }

  private replaceSelection(replacement: string) {
    let resultSelection = this.snapshot.selection;
    const changed = this.transaction.apply((text) => {
      if (text.source.kind !== 'flow') return text;
      const result = replaceFlowTextSelection(
        text.source,
        this.snapshot.selection,
        replacement,
        this.insertionStyle,
        this.insertionParagraph
      );
      resultSelection = result.selection;
      return { ...text, source: result.source };
    });
    if (changed) this.publish({ ...this.snapshot, selection: resultSelection, compositionRange: null });
    return changed;
  }

  private commitOpenGroup() {
    if (!this.openGroup) return false;
    const changed = this.transaction.commit();
    this.openGroup = null;
    this.compositionText = '';
    this.deleteSignature = '';
    this.formattingInsertionBefore = null;
    return changed;
  }

  private publish(snapshot: FlowTextEditingSnapshot, notifyShell = true) {
    this.snapshot = Object.freeze(snapshot);
    for (const listener of this.listeners) listener();
    if (!notifyShell) return;
    const signature = snapshot.status === 'idle'
      ? 'idle'
      : JSON.stringify([
        snapshot.status,
        snapshot.documentId,
        snapshot.layerId,
        snapshot.focusKey,
        this.formatProjection()
      ]);
    if (signature !== this.shellSignature) {
      this.shellSignature = signature;
      this.shellSnapshot = this.snapshot;
      for (const listener of this.shellListeners) listener();
    }
  }
}
