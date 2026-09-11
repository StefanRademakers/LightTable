import { cloneAdjustments, createDefaultAdjustments, type BasicAdjustments } from '../../types';
import type { ImageDocument } from '../../editor/document/documentTypes';
import type { DocumentSession, DocumentProcessingState } from '../documents/documentSession';
import type { PropertiesInspectorTarget } from '../properties/propertiesInspectorTarget';
import type { AdjustmentPresentationRuntime } from './AdjustmentPresentationRuntime';
import { applyGroupVisibility, createDefaultGroupVisibility, type GroupVisibility } from './groupVisibility';

interface ProcessingRenderer {
  setAdjustments(adjustments: BasicAdjustments): void;
  setGlobalGradeStrength(strength: number): void;
}

/**
 * Canonical processing access plus its mounted presentation. The only retained
 * settings are contextual preview and embedded-host state (which has no session).
 * Session processing is never mirrored. Gestures, history and GPU assets belong
 * to their existing owners, not this binding.
 */
export class DocumentProcessingBinding {
  private embedded: DocumentProcessingState = {
    adjustments: createDefaultAdjustments(), groupVisibility: createDefaultGroupVisibility(), globalGradeStrength: 100
  };
  private opening: { token: object; strength: number; visibility: GroupVisibility } | null = null;
  private sourceBinding: { token: object; retired: boolean } | null = null;
  private readonly listeners = new Set<() => void>();
  constructor(private readonly session: DocumentSession | undefined,
    private readonly contextual: AdjustmentPresentationRuntime, private readonly port: {
    isCurrent(): boolean;
    getRenderer(): ProcessingRenderer | null;
  }) {}

  get presentationStore() { return this.contextual.store; }
  get presentation() { return this.contextual.synchronizer; }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    const unsubscribe = this.session?.subscribe(listener);
    return () => { this.listeners.delete(listener); unsubscribe?.(); };
  };
  private notify(): void { this.listeners.forEach(listener => listener()); }
  private assertCurrent(): void {
    if (!this.port.isCurrent()) throw new Error('Processing belongs to a different mounted document session.');
  }
  private get state(): DocumentProcessingState { return this.session?.getSnapshot().processing ?? this.embedded; }
  getDocumentAdjustments = (): BasicAdjustments => this.state.adjustments;
  getGroupVisibility = (): GroupVisibility => this.opening?.visibility ?? this.state.groupVisibility;
  getStrength = (): number => this.opening?.strength ?? this.state.globalGradeStrength;
  getEditorAdjustments = (): BasicAdjustments => this.contextual.getSnapshot();
  stageEditorAdjustments = (next: BasicAdjustments): void => { this.contextual.stage(next); };
  publishPresentation = (next: BasicAdjustments, domain: Parameters<AdjustmentPresentationRuntime['synchronizer']['publishPresentation']>[1] = 'all'): void => {
    this.contextual.synchronizer.publishPresentation(next, domain);
  };

  private publish(patch: Partial<DocumentProcessingState>): void {
    this.assertCurrent();
    if (this.session) this.session.publishProcessing(patch);
    else {
      this.embedded = { ...this.embedded,
        ...(patch.adjustments ? { adjustments: cloneAdjustments(patch.adjustments) } : {}),
        ...(patch.groupVisibility ? { groupVisibility: { ...patch.groupVisibility } } : {}),
        ...(patch.globalGradeStrength !== undefined ? { globalGradeStrength: patch.globalGradeStrength } : {}) };
      this.notify();
    }
  }
  publishDocumentAdjustments = (adjustments: BasicAdjustments): void => { this.publish({ adjustments }); };
  publishGroupVisibility = (groupVisibility: GroupVisibility): void => { this.publish({ groupVisibility }); };
  publishStrength = (strength: number): void => {
    const next = Math.min(100, Math.max(0, strength));
    this.publish({ globalGradeStrength: next });
    this.port.getRenderer()?.setGlobalGradeStrength(next);
  };

  /** Temporary open UI; recipe adjustments are attached to the imported raster by hydration. */
  prepareNewSource = (token: object, strength: number): void => {
    this.assertCurrent();
    this.sourceBinding = { token, retired: false };
    this.opening = { token, strength, visibility: createDefaultGroupVisibility() };
    this.notify();
  };
  stageOpeningVisibility = (token: object, visibility: GroupVisibility): void => {
    if (!this.opening || this.opening.token !== token) throw new Error('Processing source-open generation changed.');
    this.opening.visibility = { ...visibility };
    this.notify();
  };
  retireOpening = (token: object): void => {
    if (this.sourceBinding?.token !== token) return;
    this.sourceBinding.retired = true;
    this.opening = null;
    this.notify();
  };
  /** Called only inside the existing prepared-source publication batch. */
  publishLoadedProcessing = (token: object, adjustments: BasicAdjustments): void => {
    this.assertCurrent();
    if (!this.sourceBinding || this.sourceBinding.token !== token || this.sourceBinding.retired) {
      throw new Error('Processing source-open generation changed.');
    }
    const opening = this.opening;
    if (opening && opening.token !== token) throw new Error('Processing source-open generation changed.');
    this.publish(opening ? { adjustments, globalGradeStrength: opening.strength, groupVisibility: opening.visibility }
      : { adjustments });
    // No initializer is needed for an in-place source replacement without a
    // fresh open; it intentionally preserves the document's processing controls.
    this.opening = null;
    this.notify();
    this.publishPresentation(adjustments);
  };
  presentExisting = (token: object, document: ImageDocument, target: PropertiesInspectorTarget): void => {
    this.assertCurrent();
    this.sourceBinding = { token, retired: false };
    this.opening = null;
    this.presentation.synchronize(document, this.getDocumentAdjustments(), target, true);
    this.notify();
  };
  projectReadyRenderer = (renderer: ProcessingRenderer): void => {
    this.assertCurrent();
    if (this.port.getRenderer() !== renderer) throw new Error('The processing renderer binding changed.');
    renderer.setAdjustments(applyGroupVisibility(this.getDocumentAdjustments(), this.getGroupVisibility()));
    renderer.setGlobalGradeStrength(this.getStrength());
  };
}
