import React from 'react';
import type { GenAiModelId, GenAiProviderId, GenAiWorkflowDefinition } from '@lighttable/genai-core';
import type { LightTableGenAiService } from '../../platform/LightTableHost';
import { createGenAiAssetReferenceImport, readLocalReferencePreview,
  type GenAiAssetReferenceImportPorts } from './GenAiAssetReferenceImport';

interface Context {
  readonly service: LightTableGenAiService | undefined;
  readonly projectId: string | undefined;
  readonly generation: number;
  readonly workflow: GenAiWorkflowDefinition | undefined;
  readonly modelId: GenAiModelId | undefined;
  readonly mode: string;
  readonly providerId: GenAiProviderId;
  readonly providerStatus: string;
}

/** The render token prevents a retained old capture callback from adopting a successor context. */
export const useGenAiAssetReferenceImport = (
  context: Context,
  ports: Omit<GenAiAssetReferenceImportPorts, 'readLocalPreview'>
) => {
  const { service, projectId, generation, workflow, modelId, mode, providerId, providerStatus } = context;
  const token = React.useMemo(() => ({ epoch: null as object | null }),
    [service, projectId, generation, workflow, modelId, mode, providerId, providerStatus]);
  const latest = React.useRef({ token, ports }); latest.current = { token, ports };
  React.useLayoutEffect(() => {
    const epoch = {}; token.epoch = epoch;
    return () => { if (token.epoch === epoch) token.epoch = null; };
  }, [token]);
  const captureAssetReferenceImport = React.useCallback((requestIsCurrent: () => boolean) => {
    const epoch = token.epoch;
    const isCurrent = () => epoch !== null && token.epoch === epoch && latest.current.token === token
      && (!workflow || (workflow.modelId === modelId && workflow.mode === mode && workflow.providerId === providerId))
      && requestIsCurrent();
    return createGenAiAssetReferenceImport({ service, projectId, workflow, isCurrent },
      { ...latest.current.ports, readLocalPreview: readLocalReferencePreview });
  }, [token, service, projectId, workflow, modelId, mode, providerId]);
  const importAssetReference = React.useCallback((file: File) =>
    captureAssetReferenceImport(() => true).importFile(file), [captureAssetReferenceImport]);
  return { captureAssetReferenceImport, importAssetReference };
};
