import { useLayoutEffect, useMemo, useRef } from 'react';
import type { DocumentSession } from '../../application/documents/documentSession';
import type { DocumentMutationController } from '../../application/documents/useDocumentMutationController';
import { PositionedTextRecoveryCommandController } from '../../application/text/PositionedTextRecoveryCommandController';
import { PositionedTextRecoveryIntent, type PositionedTextRecoveryIntentPorts } from '../../application/text/PositionedTextRecoveryIntent';
import type { ImageDocument } from '../../editor/document/documentTypes';

interface Binding {
  readonly lifecycle: object;
  readonly generation: number;
  getSession(): DocumentSession | undefined;
  getRenderer(): object | null;
  getProjectedDocument(): Pick<ImageDocument, 'id'> | null;
  captureScope(): { isCurrent(): boolean };
  readonly documentMutations: Pick<DocumentMutationController, 'change'>;
  readonly text: PositionedTextRecoveryIntentPorts['text'];
  status: PositionedTextRecoveryIntentPorts['status'];
  error: PositionedTextRecoveryIntentPorts['error'];
}

export const usePositionedTextRecovery = (binding: Binding) => {
  const latest = useRef(binding); latest.current = binding;
  const session = binding.getSession(), renderer = binding.getRenderer();
  const lifetime = useMemo(() => {
    let mounted = false;
    const opening = binding, generation = binding.generation, lifecycle = binding.lifecycle;
    const isCurrent = () => mounted && Boolean(session && renderer)
      && latest.current.getSession() === session && latest.current.getRenderer() === renderer
      && latest.current.lifecycle === lifecycle && latest.current.generation === generation
      && session?.getSnapshot().lifecycle === 'ready'
      && Boolean(session.getSnapshot().document)
      && latest.current.getProjectedDocument()?.id === session.getSnapshot().document?.id;
    const getDocument = () => session?.getSnapshot().document ?? null;
    const command = new PositionedTextRecoveryCommandController(() => ({ getDocument, documentMutations: opening.documentMutations }));
    return {
      setMounted: (value: boolean) => { mounted = value; },
      intent: new PositionedTextRecoveryIntent({ isCurrent, getDocument, command,
        captureScope: opening.captureScope, text: opening.text, status: opening.status, error: opening.error })
    };
  }, [session, renderer, binding.lifecycle, binding.generation]);
  useLayoutEffect(() => { lifetime.setMounted(true); return () => lifetime.setMounted(false); }, [lifetime]);
  return lifetime.intent;
};
