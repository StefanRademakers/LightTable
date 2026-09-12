import { beforeEach, expect, it, vi } from 'vitest';
import type { GenAiModelId, GenAiProviderSnapshot, GenAiWorkflowDefinition } from '@lighttable/genai-core';
import type { LightTableGenAiService } from '../../platform/LightTableHost';
import { DocumentSession, type DocumentSessionId } from '../../lighttable/application/documents/documentSession';
import { createImageDocument } from '../../lighttable/editor/document/documentTypes';
import { readGenAiDocumentContext } from '../../lighttable/composition/genai/readGenAiDocumentContext';
import { useGenAiSetupController } from './useGenAiSetupController';

// Invoke the real submission callback with prepared UI state; effects/provider
// discovery are intentionally absent. No network or paid generation is executed.
const hook = vi.hoisted(() => ({ cursor: 0, prepared: new Map<number, unknown>() }));
vi.mock('react', () => ({ default: {
  useState: (initial: unknown) => [hook.prepared.has(hook.cursor)
    ? hook.prepared.get(hook.cursor++) : (hook.cursor++, initial), vi.fn()],
  useRef: (current: unknown) => ({ current }), useMemo: (create: () => unknown) => create(),
  useCallback: (callback: unknown) => callback, useEffect: () => {}
} }));
vi.mock('./useGenAiAssetReferenceImport', () => ({ useGenAiAssetReferenceImport: () => vi.fn() }));
beforeEach(() => { hook.cursor = 0; hook.prepared.clear(); });

it.each(['processing', 'pixel-history', 'retired'] as const)(
  'the actual Generate request reads %s provenance without a React rerender', async kind => {
    const modelId = 'fixture-model' as GenAiModelId;
    const workflow = { id: 'fixture-workflow', modelId, mode: 'image2image', label: 'Fixture',
      fields: [] } as unknown as GenAiWorkflowDefinition;
    // Setup's declared UI state: selectedModel, mode, workflow and prompt values.
    hook.prepared.set(1, modelId); hook.prepared.set(2, 'image2image');
    hook.prepared.set(3, workflow); hook.prepared.set(6, { prompt: 'Reference proof' });
    const session = new DocumentSession({ id: 'provenance-document' as DocumentSessionId,
      source: { id: 'source', name: 'Source', mediaType: 'image/png' } });
    session.setDocument(createImageDocument('Source', 64, 48, 'pixels')); session.setReady();
    const presentation = readGenAiDocumentContext(session)!;
    const submitGeneration = vi.fn(async () => ({ id: 'fixture-job' }));
    const readCurrent = vi.fn(() => readGenAiDocumentContext(session));
    const setup = useGenAiSetupController({ submitGeneration } as unknown as LightTableGenAiService,
      { id: 'fixture-provider', status: 'connected' } as GenAiProviderSnapshot,
      'fixture-project', { presentation, readCurrent });
    expect(setup.canGenerate).toBe(true);
    if (kind === 'processing') session.publishProcessing({ globalGradeStrength: 50 });
    if (kind === 'pixel-history') session.history.record({ id: 'pixel-edit', type: 'paint', label: 'Paint',
      documentId: session.id, undo() {}, redo() {} });
    if (kind === 'retired') session.dispose();
    const expected = readGenAiDocumentContext(session);
    if (kind !== 'retired') expect(expected!.revision).toBeGreaterThan(presentation.revision);
    await setup.generate();
    expect(readCurrent).toHaveBeenCalledOnce();
    expect(submitGeneration).toHaveBeenCalledOnce();
    const request = submitGeneration.mock.calls[0] as unknown as [string, { editorDelivery?: unknown }];
    expect(request[1].editorDelivery).toEqual(expected ? { projectId: 'fixture-project',
      documentId: expected.id, sourceRevision: expected.revision, behavior: 'place-edit' } : undefined);
    session.dispose();
  });
