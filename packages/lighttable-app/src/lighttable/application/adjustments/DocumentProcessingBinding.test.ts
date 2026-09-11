import { describe, expect, it, vi } from 'vitest';
import { createDefaultAdjustments } from '../../types';
import { createImageDocument } from '../../editor/document/documentTypes';
import { DocumentSession, type DocumentSessionId } from '../documents/documentSession';
import { applyGroupVisibility, createDefaultGroupVisibility } from './groupVisibility';
import { AdjustmentPresentationRuntime } from './AdjustmentPresentationRuntime';
import { DocumentProcessingBinding } from './DocumentProcessingBinding';

const setup = () => {
  const session = new DocumentSession({ id: 'processing' as DocumentSessionId,
    source: { id: 'source', name: 'test', mediaType: 'image/png' } });
  const document = createImageDocument('Processing', 20, 10, 'source');
  session.setDocument(document);
  const renderer = { setAdjustments: vi.fn(), setGlobalGradeStrength: vi.fn() };
  const port = { isCurrent: vi.fn(() => true), getRenderer: () => renderer };
  const contextual = new AdjustmentPresentationRuntime();
  const binding = new DocumentProcessingBinding(session, contextual, port);
  return { session, document, renderer, port, contextual, binding };
};

describe('processing ownership and presentation', () => {
  it('publishes only supplied fields, preserving unrelated identities and isolating mutable inputs', () => {
    const f = setup();
    const initial = f.session.getSnapshot().processing;
    const observed = vi.fn(); const unsubscribe = f.session.subscribe(observed);
    f.session.publishProcessing({ globalGradeStrength: 42 });
    expect(f.session.getSnapshot().processing.adjustments).toBe(initial.adjustments);
    expect(f.session.getSnapshot().processing.groupVisibility).toBe(initial.groupVisibility);
    const adjustments = { ...createDefaultAdjustments(), exposureEV: 2 };
    const visibility = { ...createDefaultGroupVisibility(), globalGrade: false };
    observed.mockClear();
    f.session.publishProcessing({ adjustments, groupVisibility: visibility, globalGradeStrength: 73 });
    expect(observed).toHaveBeenCalledOnce();
    adjustments.effects.lensBlur.enabled = true; visibility.globalGrade = true;
    expect(f.session.getSnapshot().processing.adjustments.effects.lensBlur.enabled).toBe(false);
    expect(f.session.getSnapshot().processing.groupVisibility.globalGrade).toBe(false);
    const next = f.session.getSnapshot().processing;
    f.session.publishProcessing({ groupVisibility: visibility });
    expect(f.session.getSnapshot().processing.adjustments).toBe(next.adjustments);
    unsubscribe(); f.session.dispose();
  });

  it('keeps pointer-rate staged previews out of canonical state and all panel notifications', () => {
    const f = setup();
    const state = f.session.getSnapshot();
    const canonical = vi.fn(); const panel = vi.fn();
    const off = f.binding.subscribe(canonical);
    const offPanel = f.binding.presentationStore.subscribe(panel);
    for (let i = 0; i < 20; i++) f.binding.stageEditorAdjustments({ ...createDefaultAdjustments(), exposureEV: i / 10 });
    expect(f.binding.getEditorAdjustments().exposureEV).toBe(1.9);
    expect(f.session.getSnapshot()).toBe(state);
    expect(canonical).not.toHaveBeenCalled(); expect(panel).not.toHaveBeenCalled();
    f.binding.publishPresentation(f.binding.getEditorAdjustments(), 'grade');
    expect(panel).toHaveBeenCalledOnce(); expect(canonical).not.toHaveBeenCalled();
    off(); offPanel(); f.session.dispose();
  });

  it('restores existing processing read-only and respects disabled groups on renderer readiness', () => {
    const f = setup();
    const settings = createDefaultAdjustments(); settings.exposureEV = 2; settings.effects.lensBlur.enabled = true;
    const visibility = { ...createDefaultGroupVisibility(), globalGrade: false, globalLensFx: false };
    f.session.publishProcessing({ adjustments: settings, groupVisibility: visibility, globalGradeStrength: 37 });
    const state = f.session.getSnapshot();
    const writes = vi.spyOn(f.session, 'publishProcessing');
    const notifications = vi.fn(); f.session.subscribe(notifications);
    f.binding.presentExisting({}, f.document, { kind: 'document-processing', owner: 'grade' });
    expect(f.binding.getEditorAdjustments().exposureEV).toBe(2);
    f.binding.projectReadyRenderer(f.renderer);
    expect(f.renderer.setAdjustments).toHaveBeenCalledWith(applyGroupVisibility(settings, visibility));
    expect(f.renderer.setGlobalGradeStrength).toHaveBeenCalledWith(37);
    expect(f.session.getSnapshot()).toBe(state);
    expect(writes).not.toHaveBeenCalled(); expect(notifications).not.toHaveBeenCalled();
    f.session.dispose();
  });

  it('publishes hydrated neutral document adjustments plus recipe strength once, then preserves strength on rebind', () => {
    const f = setup(); const token = {};
    const before = f.session.getSnapshot();
    f.binding.prepareNewSource(token, 38);
    f.binding.stageOpeningVisibility(token, createDefaultGroupVisibility());
    // Recipe controls are presentation only here; hydration owns their raster attachment.
    f.binding.publishPresentation({ ...createDefaultAdjustments(), exposureEV: 3 });
    expect(f.session.getSnapshot()).toBe(before);
    expect(f.binding.getStrength()).toBe(38);
    const observed = vi.fn(); f.session.subscribe(observed);
    f.session.runPublication(() => f.binding.publishLoadedProcessing(token, createDefaultAdjustments()));
    expect(observed).toHaveBeenCalledOnce();
    expect(f.session.getSnapshot().processing).toMatchObject({ globalGradeStrength: 38, adjustments: { exposureEV: 0 } });
    f.binding.presentExisting({}, f.document, { kind: 'document-processing', owner: 'grade' });
    expect(f.binding.getStrength()).toBe(38);
    expect(f.binding.getDocumentAdjustments().exposureEV).toBe(0);
    f.session.dispose();
  });

  it('rejects superseded/failed initializers, while a stale close cannot retire a newer source', () => {
    const f = setup(); const first = {}; const second = {};
    f.binding.prepareNewSource(first, 21);
    f.binding.prepareNewSource(second, 62);
    f.binding.retireOpening(first);
    expect(f.binding.getStrength()).toBe(62);
    expect(() => f.binding.publishLoadedProcessing(first, createDefaultAdjustments())).toThrow('generation changed');
    f.binding.retireOpening(second);
    expect(() => f.binding.publishLoadedProcessing(second, createDefaultAdjustments())).toThrow('generation changed');
    expect(f.session.getSnapshot().processing.globalGradeStrength).toBe(100);
    f.session.dispose();
  });

  it('shares the mounted inspector runtime across bindings so retained history updates the current panel', () => {
    const f = setup();
    const historyPublish = () => {
      f.binding.publishDocumentAdjustments({ ...createDefaultAdjustments(), exposureEV: 1 });
      f.binding.presentExisting({}, f.document, { kind: 'document-processing', owner: 'grade' });
    };
    const rebound = new DocumentProcessingBinding(f.session, f.contextual, f.port);
    const panel = vi.fn(); const off = rebound.presentationStore.subscribeGrade(panel);
    historyPublish();
    expect(rebound.getEditorAdjustments().exposureEV).toBe(1);
    expect(panel).toHaveBeenCalledOnce();
    off(); f.session.dispose();
  });

  it('notifies canonical observers even when contextual presentation is unchanged, and refuses stale writes', () => {
    const f = setup(); const canonical = vi.fn(); const panel = vi.fn();
    const off = f.binding.subscribe(canonical); const offPanel = f.contextual.store.subscribe(panel);
    f.binding.publishDocumentAdjustments({ ...createDefaultAdjustments(), exposureEV: 1 });
    expect(canonical).toHaveBeenCalledOnce(); expect(panel).not.toHaveBeenCalled();
    f.port.isCurrent.mockReturnValue(false);
    expect(() => f.binding.publishStrength(25)).toThrow('different mounted document');
    expect(() => f.binding.projectReadyRenderer(f.renderer)).toThrow('different mounted document');
    expect(f.renderer.setGlobalGradeStrength).not.toHaveBeenCalled();
    off(); offPanel(); f.session.dispose();
  });

  it('rejects a retired renderer at the ready projection boundary without any GPU write', () => {
    const f = setup();
    const retired = { setAdjustments: vi.fn(), setGlobalGradeStrength: vi.fn() };
    expect(() => f.binding.projectReadyRenderer(retired)).toThrow('renderer binding changed');
    expect(retired.setAdjustments).not.toHaveBeenCalled();
    expect(retired.setGlobalGradeStrength).not.toHaveBeenCalled();
    expect(f.renderer.setAdjustments).not.toHaveBeenCalled();
    f.session.dispose();
  });
});
