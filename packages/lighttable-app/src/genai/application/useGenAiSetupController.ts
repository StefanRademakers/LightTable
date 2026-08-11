import React from 'react';
import {
  createGenAiAssetMentionOptions,
  resolveGenAiPromptMentions,
  validateGenAiWorkflowValues,
  type GenAiAssetId,
  type GenAiAssetMentionOption,
  type GenAiAssetReference,
  type GenAiGenerationSubmission,
  type GenAiCostEstimate,
  type GenAiGenerationRequest,
  type GenAiModelId,
  type GenAiModelSummary,
  type GenAiProjectSetup,
  type GenAiProviderSnapshot,
  type GenAiWorkflowDefinition
} from '@lighttable/genai-core';
import type { LightTableGenAiService } from '../../platform/LightTableHost';

export interface GenAiSetupSnapshot {
  readonly models: readonly GenAiModelSummary[];
  readonly selectedModelId?: GenAiModelId;
  readonly selectedMode: string;
  readonly workflow?: GenAiWorkflowDefinition;
  readonly loading: boolean;
  readonly error?: string;
  readonly values: Readonly<Record<string, unknown>>;
  readonly setValue: (key: string, value: unknown) => void;
  readonly setModel: (modelId: GenAiModelId) => void;
  readonly setMode: (mode: string) => void;
  readonly assets: readonly GenAiAssetReference[];
  readonly mentionOptions: readonly GenAiAssetMentionOption[];
  readonly assetPreviews: Readonly<Record<string, string>>;
  readonly requestAssetPreview: (assetId: GenAiAssetId) => void;
  readonly generating: boolean;
  readonly generationError?: string;
  readonly referenceIssue?: string;
  readonly costEstimate?: GenAiCostEstimate;
  readonly submission?: GenAiGenerationSubmission;
  readonly canGenerate: boolean;
  readonly generate: () => Promise<void>;
  readonly restoreRequest: (request: GenAiGenerationRequest) => void;
}

const ENABLED_IMAGE_MODEL_IDS = new Set(['nano-banana-pro', 'gpt-image-2']);
const DEFAULT_IMAGE_MODEL_ID = 'nano-banana-pro';

export const useGenAiSetupController = (
  service: LightTableGenAiService | undefined,
  provider: GenAiProviderSnapshot,
  projectId?: string
): GenAiSetupSnapshot => {
  const [models, setModels] = React.useState<readonly GenAiModelSummary[]>([]);
  const [selectedModelId, setSelectedModelId] = React.useState<GenAiModelId>();
  const [selectedMode, setSelectedMode] = React.useState('text2image');
  const [workflow, setWorkflow] = React.useState<GenAiWorkflowDefinition>();
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string>();
  const [values, setValues] = React.useState<Readonly<Record<string, unknown>>>({});
  const [assets, setAssets] = React.useState<readonly GenAiAssetReference[]>([]);
  const [assetPreviews, setAssetPreviews] = React.useState<Readonly<Record<string, string>>>({});
  const [generating, setGenerating] = React.useState(false);
  const [generationError, setGenerationError] = React.useState<string>();
  const [submission, setSubmission] = React.useState<GenAiGenerationSubmission>();
  const [costEstimate, setCostEstimate] = React.useState<GenAiCostEstimate>();
  const [persistedSetup, setPersistedSetup] = React.useState<GenAiProjectSetup | null>(null);
  const [setupHydrated, setSetupHydrated] = React.useState(false);
  const previewRequests = React.useRef(new Set<string>());
  const pendingRestore = React.useRef<GenAiGenerationRequest | undefined>(undefined);

  React.useEffect(() => {
    setPersistedSetup(null);
    setSetupHydrated(false);
    if (!service || !projectId) return;
    let current = true;
    void service.loadProjectSetup(projectId).then((setup) => {
      if (current) setPersistedSetup(setup);
    }).catch(() => {
      if (current) setPersistedSetup(null);
    }).finally(() => {
      if (current) setSetupHydrated(true);
    });
    return () => { current = false; };
  }, [projectId, service]);

  const setValue = React.useCallback((key: string, value: unknown) => {
    setValues((current) => ({ ...current, [key]: value }));
  }, []);

  React.useEffect(() => {
    if (!service || provider.status !== 'connected') {
      setModels([]); setWorkflow(undefined); setLoading(false);
      return;
    }
    let current = true;
    setLoading(true); setError(undefined);
    void service.listModels(provider.id).then((nextModels) => {
      const enabledModels = nextModels.filter(({ id, capabilities }) =>
        ENABLED_IMAGE_MODEL_IDS.has(id) && capabilities.some((mode) => mode === 'text2image' || mode === 'image2image')
      );
      const model = enabledModels.find(({ id }) => id === persistedSetup?.modelId)
        ?? enabledModels.find(({ id }) => id === DEFAULT_IMAGE_MODEL_ID)
        ?? enabledModels[0];
      if (!model) throw new Error('No enabled image model is available in the current OpenArt catalog.');
      const mode = persistedSetup?.modelId === model.id && model.capabilities.includes(persistedSetup.mode)
        ? persistedSetup.mode
        : model.capabilities.includes('text2image') ? 'text2image' : model.capabilities[0];
      if (!mode) throw new Error(`${model.label} exposes no supported generation mode.`);
      if (!current) return;
      setModels(enabledModels); setSelectedModelId(model.id); setSelectedMode(mode);
    }).catch((reason) => {
      if (current) { setError(reason instanceof Error ? reason.message : String(reason)); setLoading(false); }
    });
    return () => { current = false; };
  }, [persistedSetup?.mode, persistedSetup?.modelId, provider.id, provider.status, service]);

  const setModel = React.useCallback((modelId: GenAiModelId) => {
    const model = models.find(({ id }) => id === modelId);
    if (!model) return;
    setSelectedModelId(model.id);
    setSelectedMode((current) => model.capabilities.includes(current)
      ? current
      : model.capabilities.includes('text2image') ? 'text2image' : model.capabilities[0] ?? current);
  }, [models]);

  const restoreRequest = React.useCallback((request: GenAiGenerationRequest) => {
    if (!models.some(({ id }) => id === request.modelId)) return;
    if (workflow?.id === request.workflowId) {
      setValues({ ...request.fields, prompt: request.prompt });
      return;
    }
    pendingRestore.current = request;
    setSelectedModelId(request.modelId);
    setSelectedMode(String(request.workflowId).split(':').at(-1) ?? 'text2image');
  }, [models, workflow?.id]);

  React.useEffect(() => {
    if (!service || provider.status !== 'connected' || !selectedModelId || !selectedMode) return;
    let current = true;
    setLoading(true); setError(undefined);
    void service.loadWorkflow(provider.id, selectedModelId, selectedMode).then((nextWorkflow) => {
      if (!current) return;
      setWorkflow(nextWorkflow);
      const defaults = Object.fromEntries(nextWorkflow.fields.map((field) => [field.key, field.defaultValue]));
      const restored = pendingRestore.current;
      if (restored?.modelId === nextWorkflow.modelId && restored.workflowId === nextWorkflow.id) {
        pendingRestore.current = undefined;
        setValues({ ...defaults, ...restored.fields, prompt: restored.prompt });
      } else if (persistedSetup?.modelId === nextWorkflow.modelId && persistedSetup.mode === nextWorkflow.mode) {
        setValues({ ...defaults, ...persistedSetup.values });
      } else {
        setValues(defaults);
      }
      setLoading(false);
    }).catch((reason) => {
      if (current) { setError(reason instanceof Error ? reason.message : String(reason)); setLoading(false); }
    });
    return () => { current = false; };
  }, [persistedSetup, provider.id, provider.status, selectedMode, selectedModelId, service]);

  React.useEffect(() => {
    if (!service || !projectId || !setupHydrated || !workflow || !selectedModelId
      || workflow.modelId !== selectedModelId || workflow.mode !== selectedMode) return;
    const timeout = window.setTimeout(() => {
      void service.saveProjectSetup(projectId, {
        modelId: selectedModelId,
        mode: selectedMode,
        values,
        updatedAt: Date.now()
      }).catch(() => undefined);
    }, 500);
    return () => window.clearTimeout(timeout);
  }, [projectId, selectedMode, selectedModelId, service, setupHydrated, values, workflow]);

  React.useEffect(() => {
    previewRequests.current.clear(); setAssetPreviews({});
    if (!service || !projectId || provider.status !== 'connected') { setAssets([]); return; }
    let current = true;
    void service.listProjectAssets(projectId).then((next) => { if (current) setAssets(next); })
      .catch((reason) => {
        if (!current) return;
        const message = reason instanceof Error ? reason.message : String(reason);
        // During Vite HMR the renderer can briefly be newer than Electron's
        // main/preload process. Asset discovery resumes after the normal main restart.
        if (!message.includes('No handler registered')) setGenerationError(message);
        setAssets([]);
      });
    return () => { current = false; };
  }, [projectId, provider.status, service]);

  const requestAssetPreview = React.useCallback((assetId: GenAiAssetId) => {
    if (!service || !projectId || previewRequests.current.has(assetId)) return;
    previewRequests.current.add(assetId);
    void service.loadProjectAssetPreview(projectId, assetId).then((preview) => {
      if (preview) setAssetPreviews((current) => ({ ...current, [assetId]: preview }));
    }).catch(() => undefined);
  }, [projectId, service]);

  const mentionOptions = React.useMemo(() => createGenAiAssetMentionOptions(assets), [assets]);
  const prompt = String(values.prompt ?? '');
  const resolvedMentions = React.useMemo(
    () => resolveGenAiPromptMentions(prompt, mentionOptions),
    [mentionOptions, prompt]
  );
  const validationValues = React.useMemo(() => {
    if (!workflow) return values;
    const next = { ...values };
    for (const field of workflow.fields) {
      if (field.kind === 'asset') next[field.key] = resolvedMentions.references;
    }
    return next;
  }, [resolvedMentions.references, values, workflow]);
  const validationIssues = workflow ? validateGenAiWorkflowValues(workflow, validationValues) : [];
  const tooManyReferences = workflow?.fields.some((field) => field.kind === 'asset'
    && typeof field.sourceSchema.maxItems === 'number'
    && resolvedMentions.references.length > field.sourceSchema.maxItems) ?? false;
  const unpublishedReferences = resolvedMentions.references.filter((reference) =>
    !reference.publishedProviderIds?.includes(provider.id)
  );
  const referenceIssue = unpublishedReferences.length
    ? `${unpublishedReferences.length} local reference${unpublishedReferences.length === 1 ? ' is' : 's are'} not published to ${provider.label}. Use a generated history image or remove the reference.`
    : undefined;
  const canGenerate = Boolean(
    service && projectId && workflow && prompt.trim() && validationIssues.length === 0
    && resolvedMentions.missingTokens.length === 0 && !tooManyReferences && !referenceIssue && !generating
  );

  React.useEffect(() => {
    if (!service || provider.status !== 'connected' || !selectedModelId || !workflow) {
      setCostEstimate(undefined);
      return;
    }
    let current = true;
    const timeout = window.setTimeout(() => {
      void service.estimateCost(provider.id, selectedModelId, selectedMode, validationValues)
        .then((estimate) => { if (current) setCostEstimate(estimate ?? undefined); })
        .catch(() => { if (current) setCostEstimate(undefined); });
    }, 450);
    return () => { current = false; window.clearTimeout(timeout); };
  }, [provider.id, provider.status, selectedMode, selectedModelId, service, validationValues, workflow]);

  const generate = React.useCallback(async () => {
    if (!service || !projectId || !workflow || !selectedModelId || !canGenerate) return;
    setGenerating(true); setGenerationError(undefined); setSubmission(undefined);
    try {
      const next = await service.submitGeneration(projectId, {
        providerId: provider.id,
        modelId: selectedModelId,
        workflowId: workflow.id,
        prompt,
        providerPrompt: resolvedMentions.providerPrompt,
        promptBindings: resolvedMentions.bindings,
        fields: values,
        references: resolvedMentions.references
      });
      setSubmission(next);
      if (next.result) {
        const nextAssets = await service.listProjectAssets(projectId);
        setAssets(nextAssets);
        const preview = await service.loadProjectAssetPreview(projectId, next.result.assetId);
        if (preview) setAssetPreviews((current) => ({ ...current, [next.result!.assetId]: preview }));
      }
    } catch (reason) {
      setGenerationError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setGenerating(false);
    }
  }, [canGenerate, projectId, prompt, provider.id, resolvedMentions, selectedModelId, service, values, workflow]);

  return {
    models, selectedModelId, selectedMode, workflow, loading, error, values, setValue, setModel,
    setMode: setSelectedMode, assets, mentionOptions, assetPreviews, requestAssetPreview,
    generating, generationError, referenceIssue, costEstimate, submission, canGenerate, generate, restoreRequest
  };
};
