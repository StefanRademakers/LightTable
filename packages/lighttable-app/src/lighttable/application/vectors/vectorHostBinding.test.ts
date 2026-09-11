import { describe, expect, it, vi } from 'vitest';
import { createImageDocument } from '../../editor/document/documentTypes';
import { createEditorSession } from '../../editor/session/editorSession';
import type { DocumentSessionId } from '../documents/documentSession';
import { createVectorDocumentTestHarness } from './vectorDocumentTestHarness';
import { VectorDocumentController } from './VectorDocumentController';
import { GradientToolController } from './GradientToolController';
import { VectorCommitPublisher } from './VectorCommitPublisher';
import { useVectorToolSessionController } from './useVectorToolSessionController';

// Instantiate the actual host ports once. Deliberately withhold React effects
// and rerenders while the real domain/document controllers publish revisions.
vi.mock('react', () => ({
  useRef: (current: unknown) => ({ current }),
  useEffect: vi.fn()
}));

describe('vector host authority between React renders', () => {
  it.each(['session', 'renderer'] as const)('retires an exact %s replacement before React rerenders', replace => {
    const initial = createImageDocument('same id', 320, 180, 'asset');
    const h = createVectorDocumentTestHarness(initial);
    const session = createEditorSession(); session.activeTool = 'vector-pen';
    let sessionIdentity = {}, rendererIdentity = {};
    const controller = useVectorToolSessionController({
      document: initial, rendererGeneration: 1, sessionIdentity, rendererIdentity,
      lifecycleIdentity: h, getSessionIdentity: () => sessionIdentity,
      getRendererGeneration: () => 1, captureScope: () => {
        const renderer = rendererIdentity;
        return { isCurrent: () => renderer === rendererIdentity };
      },
      getDocument: () => h.canonicalDocument, getSession: () => session,
      documentMutations: h.mutations,
      publishSelection: selection => { session.vectorSelection = selection; },
      captureTransformPreview: () => null, reportError: vi.fn(), rasterizeShape: async () => false
    });
    controller.activate('pen');
    for (const [id, point] of [{ x: 10, y: 10 }, { x: 70, y: 30 }].entries()) {
      controller.pointerDown(id, point, { hitRadius: 3 }); controller.pointerUp(id, point);
    }
    if (replace === 'session') sessionIdentity = {};
    else rendererIdentity = {};
    controller.deactivate();
    expect(h.history).toHaveLength(0);
    controller.dispose();
  });
  it('reads live document/settings/selection and observes one exact gradient create/update', () => {
    const initial = createImageDocument('gradient', 320, 180, 'asset');
    const h = createVectorDocumentTestHarness(initial);
    const session = createEditorSession();
    session.activeTool = 'gradient';
    const record = vi.fn(), selectLayer = vi.fn();
    const publisher = new VectorCommitPublisher({
      documentId: 'workspace' as DocumentSessionId, selectLayer, record
    });
    const controller = useVectorToolSessionController({
      document: initial, rendererGeneration: 1,
      sessionIdentity: h, rendererIdentity: null, lifecycleIdentity: h, getSessionIdentity: () => h,
      getRendererGeneration: () => 1, captureScope: () => ({ isCurrent: () => true }),
      getDocument: () => h.canonicalDocument, getSession: () => session,
      documentMutations: h.mutations,
      publishSelection: selection => { session.vectorSelection = selection; },
      captureTransformPreview: () => null, reportError: vi.fn(),
      rasterizeShape: async () => false, onGradientCommitted: publisher.gradient
    });
    // These changes happen after mounting, before any React rerender.
    session.gradient = { ...session.gradient, opacity: 0.6, blendMode: 'multiply' };
    controller.activate('gradient');
    controller.pointerDown(1, { x: 20, y: 30 }, { hitRadius: 3 });
    controller.pointerUp(1, { x: 200, y: 50 });
    expect(h.history).toHaveLength(1); expect(record).toHaveBeenCalledOnce();
    const layerId = h.canonicalDocument.activeLayerId!;
    expect(selectLayer).toHaveBeenCalledWith(layerId);
    expect(record.mock.calls[0]).toEqual(['vector.create', 'workspace',
      expect.objectContaining({ layerRole: 'gradient-fill', layerOpacity: 0.6, layerBlendMode: 'multiply' }),
      expect.objectContaining({ layerId })]);
    expect(session.vectorSelection.elements[0]?.layerId).toBe(layerId);
    controller.pointerDown(2, { x: 70, y: 80 }, { hitRadius: 3 });
    controller.pointerUp(2, { x: 240, y: 110 });
    expect(h.history).toHaveLength(2); expect(record).toHaveBeenCalledTimes(2);
    expect(record.mock.calls[1]?.[0]).toBe('vector.update');
    expect(record.mock.calls[1]?.[3]).toMatchObject({ layerId });
    expect(selectLayer).toHaveBeenCalledOnce();
    controller.dispose();
  });

  it('uses committed gradient payload even if the host document read lags publication', () => {
    const initial = createImageDocument('gradient', 320, 180, 'asset');
    const h = createVectorDocumentTestHarness(initial);
    const documents = new VectorDocumentController(() => ({
      ...h.dependencies, getDocument: () => initial
    }));
    const onCommitted = vi.fn();
    const settings = createEditorSession().gradient;
    const controller = new GradientToolController(documents, () => settings,
      undefined, undefined, undefined, onCommitted);
    controller.pointerDown({ x: 20, y: 30 });
    expect(controller.pointerUp({ x: 200, y: 60 })).toBe(true);
    expect(h.history).toHaveLength(1);
    expect(onCommitted).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'create', layerId: h.canonicalDocument.activeLayerId,
      layerRole: 'gradient-fill', element: expect.objectContaining({ type: 'live-shape' })
    }));
  });
});
