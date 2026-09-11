import React from 'react';
import type { LayerStyleStack } from '../../editor/styles/layerStyleTypes';
import { cloneLayerStyleStack } from '../../editor/styles/layerStyleDefaults';
import type { LayerStyleInteractionCallbacks } from '../../editor/ui/LayerStyleInteractionControls';
import type { LayerStyleInteractionAdmission } from './useLayerStyleEditorController';

interface LayerStyleDraftInteractionOptions {
  readonly initialStack: LayerStyleStack;
  readonly previewIntervalMs: number;
  readonly onPreview: (stack: LayerStyleStack, admission: LayerStyleInteractionAdmission) => void;
  readonly onInteractionStart?: () => LayerStyleInteractionAdmission;
  readonly onInteractionCommit?: (admission: LayerStyleInteractionAdmission) => void;
  readonly onInteractionCancel?: (admission: LayerStyleInteractionAdmission) => void;
}

export const useLayerStyleDraftInteraction = ({
  initialStack,
  previewIntervalMs,
  onPreview,
  onInteractionStart,
  onInteractionCommit,
  onInteractionCancel
}: LayerStyleDraftInteractionOptions) => {
  const [draft, setDraft] = React.useState(() => cloneLayerStyleStack(initialStack));
  const draftRef = React.useRef(draft);
  const publishedRevisionRef = React.useRef(initialStack.revision);
  const latestPreviewRef = React.useRef<LayerStyleStack | null>(null);
  const previewTimerRef = React.useRef<number | null>(null);
  const onPreviewRef = React.useRef(onPreview);
  onPreviewRef.current = onPreview;
  const callbacksRef = React.useRef({
    onInteractionStart,
    onInteractionCommit,
    onInteractionCancel
  });
  callbacksRef.current = {
    onInteractionStart,
    onInteractionCommit,
    onInteractionCancel
  };
  const interactionActiveRef = React.useRef(false);
  const interactionHandleRef = React.useRef<LayerStyleInteractionAdmission | null>(null);
  const interactionBeforeRef = React.useRef<LayerStyleStack | null>(null);

  const cancelScheduledPreview = React.useCallback(() => {
    if (previewTimerRef.current === null) return;
    window.clearTimeout(previewTimerRef.current);
    previewTimerRef.current = null;
  }, []);

  const publishLatestPreview = React.useCallback(() => {
    cancelScheduledPreview();
    const next = latestPreviewRef.current;
    const admission = interactionHandleRef.current;
    if (!next || !admission) return;
    latestPreviewRef.current = null;
    onPreviewRef.current(next, admission);
  }, [cancelScheduledPreview]);

  const schedulePreview = React.useCallback(() => {
    if (previewTimerRef.current !== null) return;
    previewTimerRef.current = window.setTimeout(() => {
      previewTimerRef.current = null;
      publishLatestPreview();
    }, previewIntervalMs);
  }, [previewIntervalMs, publishLatestPreview]);

  React.useEffect(() => {
    if (initialStack.revision === publishedRevisionRef.current) return;
    cancelScheduledPreview();
    latestPreviewRef.current = null;
    if (interactionActiveRef.current) {
      interactionActiveRef.current = false;
      interactionBeforeRef.current = null;
      const handle = interactionHandleRef.current;
      interactionHandleRef.current = null;
      if (handle) callbacksRef.current.onInteractionCancel?.(handle);
    }
    publishedRevisionRef.current = initialStack.revision;
    const next = cloneLayerStyleStack(initialStack);
    draftRef.current = next;
    setDraft(next);
  }, [cancelScheduledPreview, initialStack]);

  const startInteraction = React.useCallback((): LayerStyleInteractionAdmission => {
    if (interactionActiveRef.current && interactionHandleRef.current) {
      return { status: 'rejected' };
    }
    interactionActiveRef.current = true;
    interactionBeforeRef.current = draftRef.current;
    const handle = callbacksRef.current.onInteractionStart?.()
      ?? { status: 'rejected' as const };
    interactionHandleRef.current = handle;
    if (handle.status === 'rejected') {
      interactionActiveRef.current = false;
      interactionBeforeRef.current = null;
    }
    return handle;
  }, []);

  const finishInteraction = React.useCallback((handle: LayerStyleInteractionAdmission) => {
    if (!interactionActiveRef.current || interactionHandleRef.current !== handle) return;
    publishLatestPreview();
    interactionActiveRef.current = false;
    interactionBeforeRef.current = null;
    interactionHandleRef.current = null;
    callbacksRef.current.onInteractionCommit?.(handle);
  }, [publishLatestPreview]);

  const cancelInteraction = React.useCallback((
    handle: LayerStyleInteractionAdmission | null,
    restoreDraft = true
  ) => {
    cancelScheduledPreview();
    latestPreviewRef.current = null;
    if (!interactionActiveRef.current || interactionHandleRef.current !== handle) return;
    interactionActiveRef.current = false;
    const before = interactionBeforeRef.current;
    interactionBeforeRef.current = null;
    if (restoreDraft && before) {
      draftRef.current = before;
      publishedRevisionRef.current = before.revision;
      setDraft(before);
    }
    interactionHandleRef.current = null;
    if (handle) callbacksRef.current.onInteractionCancel?.(handle);
  }, [cancelScheduledPreview]);

  const interactionCallbacks = React.useMemo<LayerStyleInteractionCallbacks>(() => ({
    start: startInteraction,
    finish: finishInteraction,
    cancel: (handle) => cancelInteraction(handle)
  }), [cancelInteraction, finishInteraction, startInteraction]);

  React.useEffect(() => () => {
    cancelInteraction(interactionHandleRef.current, false);
  }, [cancelInteraction]);

  const updateDraft = React.useCallback((
    updater: (current: LayerStyleStack) => LayerStyleStack
  ) => {
    const current = draftRef.current;
    const next = updater(current);
    if (next === current) return;
    draftRef.current = next;
    publishedRevisionRef.current = next.revision;
    latestPreviewRef.current = next;
    setDraft(next);
    schedulePreview();
  }, [schedulePreview]);

  const performDiscreteEdit = React.useCallback((edit: () => void) => {
    const handle = startInteraction();
    if (handle.status === 'rejected') return;
    edit();
    finishInteraction(handle);
  }, [finishInteraction, startInteraction]);

  return { draft, interactionCallbacks, performDiscreteEdit, updateDraft };
};
