import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { DocumentSession } from '../../application/documents/documentSession';
import type { ImageDocument } from '../../editor/document/documentTypes';
import type { SelectionSessionController } from '../../application/tools/selection/useSelectionSessionController';
import { SmartSelectionToolController, type SmartSelectionToolCallbacks } from '../../application/tools/smartSelection/SmartSelectionToolController';
import type { SmartSelectionBackend, SmartSelectionPreparationState } from '../../application/tools/smartSelection/SmartSelectionBackend';
import type { SmartSelectionPreviewRenderer } from '../../application/tools/smartSelection/SmartSelectionPreviewLease';
import { configuredSmartSelectionBackendProfile, createSmartSelectionBackend } from '../../application/tools/smartSelection/smartSelectionBackendFactory';
import type { LightTableCommandService } from '../../application/commands/lightTableCommandService';
import { smartSelectionProcessingEqual } from '../../application/tools/smartSelection/SmartSelectionSourceSession';

const subscribeToNothing = () => () => undefined;

interface SmartSelectionRuntime {
  readonly session: DocumentSession | undefined;
  readonly renderer: SmartSelectionPreviewRenderer | null;
  readonly lifecycle: object;
  readonly generation: number;
  readonly ready: boolean;
  readonly sourceReady: boolean;
  readonly enabled: boolean;
  readonly document: ImageDocument | null;
  readonly sampleAllLayers: boolean;
}

interface SmartSelectionHost {
  readonly selection: Pick<SelectionSessionController, 'rasterMask'>;
  readonly commands: Pick<LightTableCommandService, 'recordObservedCommand'>;
  readonly getOptions: SmartSelectionToolCallbacks['getOptions'];
  readonly setStatus: SmartSelectionToolCallbacks['setStatus'];
  readonly setDraft: SmartSelectionToolCallbacks['setDraft'];
  captureRendererScope(): { isCurrent(): boolean };
}

/** Owns the mounted worker lifetime and UI projection, not selection or inference. */
export const useSmartSelectionBinding = (
  runtime: SmartSelectionRuntime, host: SmartSelectionHost,
  createBackend = (): SmartSelectionBackend => createSmartSelectionBackend(configuredSmartSelectionBackendProfile())
) => {
  const latest = useRef({ runtime, host });
  latest.current = { runtime, host };
  const lifetime = useRef({ mounted: false, epoch: 0, disposal: null as ReturnType<typeof setTimeout> | null });
  const [backend] = useState(createBackend);
  const [backendIdentity, setBackendIdentity] = useState(backend.identity);
  const [preparation, setPreparation] = useState<SmartSelectionPreparationState>({ phase: 'idle' });
  const processing = useSyncExternalStore(runtime.session?.subscribe ?? subscribeToNothing,
    () => runtime.session?.getSnapshot().processing ?? null);
  const [controller] = useState(() => {
    const captureScope = () => {
      const opening = latest.current.runtime;
      const epoch = lifetime.current.epoch;
      const rendererScope = latest.current.host.captureRendererScope();
      return { isCurrent: () => {
        const current = latest.current.runtime;
        return lifetime.current.mounted && epoch === lifetime.current.epoch
          && current.session === opening.session && current.renderer === opening.renderer
          && current.lifecycle === opening.lifecycle && current.generation === opening.generation
          && current.ready && current.session?.getSnapshot().lifecycle === 'ready'
          && rendererScope.isCurrent();
      } };
    };
    const publish = (action: () => void) => { if (captureScope().isCurrent()) action(); };
    return new SmartSelectionToolController({
      captureScope,
      getDocument: () => latest.current.runtime.session?.getSnapshot().document ?? null,
      getProcessing: () => latest.current.runtime.session?.getSnapshot().processing ?? null,
      getRenderer: () => latest.current.runtime.renderer,
      isRendererReady: () => latest.current.runtime.ready,
      getOptions: () => latest.current.host.getOptions(),
      selection: { rasterMask: (...args) => latest.current.host.selection.rasterMask(...args) },
      setStatus: message => publish(() => latest.current.host.setStatus(message)),
      setDraft: draft => publish(() => latest.current.host.setDraft(draft)),
      onBackendIdentityChange: identity => publish(() => setBackendIdentity(identity)),
      onPreparationChange: state => publish(() => setPreparation(state)),
      onSelectionCommitted: (parameters, result) => {
        const session = latest.current.runtime.session;
        return session && captureScope().isCurrent()
          ? latest.current.host.commands.recordObservedCommand('selection.selectSubject', session.id, parameters, result) ?? false
          : false;
      }
    }, backend);
  });
  useLayoutEffect(() => {
    const owned = lifetime.current;
    if (owned.disposal !== null) clearTimeout(owned.disposal);
    owned.disposal = null;
    owned.mounted = true;
    return () => {
      controller.invalidate();
      owned.mounted = false;
      owned.epoch += 1;
      // StrictMode setup replay keeps its worker, but never revives an old request.
      owned.disposal = setTimeout(() => { controller.dispose(); owned.disposal = null; }, 0);
    };
  }, [controller]);
  useLayoutEffect(() => {
    const session = runtime.session;
    if (!session) return;
    let observed = session.getSnapshot().processing;
    return session.subscribe(() => {
      const next = session.getSnapshot().processing;
      if (smartSelectionProcessingEqual(observed, next)) return;
      observed = next;
      if (latest.current.runtime.session === session) controller.invalidate();
      // No export here: renderer processing publication may still follow in
      // this synchronous commit. Preparation belongs to the layout binding below.
    });
  }, [controller, runtime.session]);
  useLayoutEffect(() => {
    controller.invalidate();
    if (!runtime.enabled) return;
    setPreparation({ phase: 'preparing', message: 'Loading Object Selection model…' });
    if (runtime.ready && runtime.sourceReady && runtime.document) void controller.prepare();
    return () => controller.clearPreview();
  }, [controller, runtime.session, runtime.renderer, runtime.lifecycle, runtime.generation,
    runtime.ready, runtime.sourceReady, runtime.enabled, runtime.sampleAllLayers,
    runtime.document?.id, runtime.document?.revision, runtime.document?.activeLayerId,
    processing?.adjustments, processing?.groupVisibility, processing?.globalGradeStrength]);
  return { controller, backendIdentity, preparation };
};
