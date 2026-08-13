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
  type GenAiProjectAssetSection,
  type GenAiProviderSnapshot,
  type GenAiWorkflowDefinition
} from '@lighttable/genai-core';
import type { LightTableGenAiService } from '../../platform/LightTableHost';
import {
  applyGenAiImageCreateDefaults,
  applyGenAiOutputSizeDefault,
  genAiDocumentContextKey,
  matchGenAiValuesToDocument,
  type GenAiDocumentContext
} from './genAiDocumentDefaults';

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
  readonly assetSections: readonly GenAiProjectAssetSection[];
  readonly mentionOptions: readonly GenAiAssetMentionOption[];
  readonly assetPreviews: Readonly<Record<string, string>>;
  readonly requestAssetPreview: (assetId: GenAiAssetId) => void;
  readonly refreshAssets: () => Promise<void>;
  readonly addAssetReference: (assetId: GenAiAssetId) => void;
  readonly importAssetReference: (file: File) => Promise<GenAiAssetReference | undefined>;
  readonly removeAssetReference: (assetId: GenAiAssetId) => void;
  readonly generating: boolean;
  readonly generationError?: string;
  readonly referenceIssue?: string;
  readonly costEstimate?: GenAiCostEstimate;
  readonly submission?: GenAiGenerationSubmission;
  readonly canGenerate: boolean;
  readonly generate: () => Promise<void>;
  readonly restoreRequest: (request: GenAiGenerationRequest) => void;
}

const DEFAULT_IMAGE_MODEL_ID = 'nano-banana-pro';

export const useGenAiSetupController = (
  service: LightTableGenAiService | undefined,
  provider: GenAiProviderSnapshot,
  projectId?: string,
  documentContext?: GenAiDocumentContext
): GenAiSetupSnapshot => {
  const [models, setModels] = React.useState<readonly GenAiModelSummary[]>([]);
  const [selectedModelId, setSelectedModelId] = React.useState<GenAiModelId>();
  const [selectedMode, setSelectedMode] = React.useState('text2image');
  const [workflow, setWorkflow] = React.useState<GenAiWorkflowDefinition>();
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string>();
  const [values, setValues] = React.useState<Readonly<Record<string, unknown>>>({});
  const [assets, setAssets] = React.useState<readonly GenAiAssetReference[]>([]);
  const [assetSections, setAssetSections] = React.useState<readonly GenAiProjectAssetSection[]>([]);
  const [assetPreviews, setAssetPreviews] = React.useState<Readonly<Record<string, string>>>({});
  const [generating, setGenerating] = React.useState(false);
  const [generationError, setGenerationError] = React.useState<string>();
  const [submission, setSubmission] = React.useState<GenAiGenerationSubmission>();
  const [costEstimate, setCostEstimate] = React.useState<GenAiCostEstimate>();
  const [persistedSetup, setPersistedSetup] = React.useState<GenAiProjectSetup | null>(null);
  const [setupHydrated, setSetupHydrated] = React.useState(false);
  const previewRequests = React.useRef(new Set<string>());
  const pendingRestore = React.useRef<GenAiGenerationRequest | undefined>(undefined);
  const workflowCache = React.useRef(new Map<string, GenAiWorkflowDefinition>());
  const documentContextKey = genAiDocumentContextKey(documentContext);
  const documentContextRef = React.useRef(documentContext);
  documentContextRef.current = documentContext;
  const valuesRef = React.useRef(values);
  valuesRef.current = values;
  const workflowRef = React.useRef(workflow);
  workflowRef.current = workflow;

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
      const enabledModels = nextModels.filter(({ capabilities }) =>
        capabilities.some((mode) => mode === 'text2image' || mode === 'image2image')
      );
      const model = enabledModels.find(({ id }) => id === persistedSetup?.modelId)
        ?? enabledModels.find(({ id }) => id === DEFAULT_IMAGE_MODEL_ID)
        ?? enabledModels[0];
      if (!model) throw new Error(`${provider.label} exposes no supported image model.`);
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
    const cacheKey = `${provider.id}:${selectedModelId}:${selectedMode}`;
    const cachedWorkflow = workflowCache.current.get(cacheKey);
    if (cachedWorkflow) {
      setWorkflow(cachedWorkflow);
      setLoading(false);
      setError(undefined);
    } else {
      // Keep the current form mounted while an uncached schema is resolved.
      // `loading` is reserved for the first bootstrap, not ordinary switching.
      setLoading(!workflow);
      setError(undefined);
    }
    void service.loadWorkflow(provider.id, selectedModelId, selectedMode).then((nextWorkflow) => {
      if (!current) return;
      workflowCache.current.set(cacheKey, nextWorkflow);
      setWorkflow(nextWorkflow);
      const providerDefaults = Object.fromEntries(nextWorkflow.fields.map((field) => [field.key, field.defaultValue]));
      const restored = pendingRestore.current;
      let nextValues: Readonly<Record<string, unknown>>;
      if (restored?.modelId === nextWorkflow.modelId && restored.workflowId === nextWorkflow.id) {
        pendingRestore.current = undefined;
        nextValues = { ...providerDefaults, ...restored.fields, prompt: restored.prompt };
      } else if (persistedSetup?.modelId === nextWorkflow.modelId && persistedSetup.mode === nextWorkflow.mode) {
        nextValues = { ...providerDefaults, ...persistedSetup.values };
      } else {
        nextValues = applyGenAiImageCreateDefaults(
          nextWorkflow,
          applyGenAiOutputSizeDefault(nextWorkflow, providerDefaults)
        );
      }
      const previousWorkflow = workflowRef.current;
      const previousValues = valuesRef.current;
      const previousPromptField = previousWorkflow?.fields.find(({ role }) => role === 'prompt');
      const previousReferenceField = previousWorkflow?.fields.find(({ role }) => role === 'references');
      const nextPromptField = nextWorkflow.fields.find(({ role }) => role === 'prompt');
      const nextReferenceField = nextWorkflow.fields.find(({ role }) => role === 'references');
      const previousPrompt = previousPromptField ? previousValues[previousPromptField.key] : previousValues.prompt;
      const previousReferences = previousReferenceField ? previousValues[previousReferenceField.key] : undefined;
      nextValues = {
        ...nextValues,
        ...(nextPromptField && typeof previousPrompt === 'string' ? { [nextPromptField.key]: previousPrompt } : {}),
        ...(nextReferenceField && Array.isArray(previousReferences)
          ? { [nextReferenceField.key]: previousReferences } : {})
      };
      const activeDocument = documentContextRef.current;
      setValues(activeDocument
        ? matchGenAiValuesToDocument(nextWorkflow, nextValues, activeDocument)
        : nextValues);
      setLoading(false);
    }).catch((reason) => {
      if (current) { setError(reason instanceof Error ? reason.message : String(reason)); setLoading(false); }
    });
    return () => { current = false; };
  }, [persistedSetup, provider.id, provider.status, selectedMode, selectedModelId, service]);

  React.useEffect(() => {
    if (!workflow || workflow.mode !== selectedMode || selectedMode !== 'image2image'
      || !documentContext || !documentContextKey) return;
    setValues((current) => matchGenAiValuesToDocument(workflow, current, documentContext));
  }, [documentContext, documentContextKey, selectedMode, workflow]);

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
    if (!service || !projectId) { setAssets([]); setAssetSections([]); return; }
    let current = true;
    const refresh = () => void service.loadProjectAssetCatalog(projectId).then((next) => {
      if (current) { setAssets(next.assets); setAssetSections(next.sections); }
    }).catch((reason) => {
        if (!current) return;
        const message = reason instanceof Error ? reason.message : String(reason);
        // During Vite HMR the renderer can briefly be newer than Electron's
        // main/preload process. Asset discovery resumes after the normal main restart.
        if (!message.includes('No handler registered')) setGenerationError(message);
        setAssets([]); setAssetSections([]);
      });
    refresh();
    const unsubscribe = service.subscribeProjectAssets(projectId, refresh);
    return () => { current = false; unsubscribe(); };
  }, [projectId, service]);

  const requestAssetPreview = React.useCallback((assetId: GenAiAssetId) => {
    if (!service || !projectId || previewRequests.current.has(assetId)) return;
    previewRequests.current.add(assetId);
    void service.loadProjectAssetPreview(projectId, assetId).then((preview) => {
      if (preview) setAssetPreviews((current) => ({ ...current, [assetId]: preview }));
    }).catch(() => undefined);
  }, [projectId, service]);

  const refreshAssets = React.useCallback(async () => {
    if (!service || !projectId) return;
    setGenerationError(undefined);
    try {
      await service.refreshProjectAssets(projectId);
    } catch (reason) {
      setGenerationError(reason instanceof Error ? reason.message : String(reason));
    }
  }, [projectId, service]);

  const mentionOptions = React.useMemo(() => createGenAiAssetMentionOptions(assets), [assets]);
  const addAssetReference = React.useCallback((assetId: GenAiAssetId) => {
    const option = mentionOptions.find(({ asset }) => asset.id === assetId);
    if (!option) return;
    setValues((current) => {
      const currentPrompt = String(current.prompt ?? '');
      const referenceField = workflow?.fields.find(({ role }) => role === 'references');
      const currentReferences = referenceField && Array.isArray(current[referenceField.key])
        ? current[referenceField.key] as GenAiAssetReference[] : [];
      const references = currentReferences.some(({ id }) => id === assetId)
        ? currentReferences : [...currentReferences, option.asset];
      const hasToken = new RegExp(`(^|\\s)${option.token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\s|$)`, 'iu').test(currentPrompt);
      return { ...current,
        ...(referenceField ? { [referenceField.key]: references } : {}),
        prompt: hasToken ? currentPrompt
          : `${currentPrompt}${currentPrompt && !/\s$/u.test(currentPrompt) ? ' ' : ''}${option.token}` };
    });
  }, [mentionOptions, workflow]);
  const importAssetReference = React.useCallback(async (file: File) => {
    if (!service) {
      setGenerationError('Local reference images are unavailable in this host.');
      return undefined;
    }
    try {
      setGenerationError(undefined);
      const imported = projectId
        ? await service.importProjectAsset(projectId, {
          name: file.name,
          mediaType: file.type,
          bytes: new Uint8Array(await file.arrayBuffer())
        })
        : {
          id: `session-${crypto.randomUUID()}` as GenAiAssetId,
          projectId: '',
          label: file.name,
          mediaType: file.type,
          previewId: `session-${file.name}`
        } satisfies GenAiAssetReference;
      setAssets((current) => current.some(({ id }) => id === imported.id) ? current : [...current, imported]);
      if (!projectId) {
        const preview = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => typeof reader.result === 'string'
            ? resolve(reader.result)
            : reject(new Error('The local reference preview could not be decoded.'));
          reader.onerror = () => reject(reader.error ?? new Error('The local reference preview could not be read.'));
          reader.readAsDataURL(file);
        });
        setAssetPreviews((current) => ({ ...current, [imported.id]: preview }));
      }
      const referenceField = workflow?.fields.find(({ role }) => role === 'references');
      if (referenceField) setValues((current) => {
        const references = Array.isArray(current[referenceField.key])
          ? current[referenceField.key] as GenAiAssetReference[] : [];
        return references.some(({ id }) => id === imported.id) ? current
          : { ...current, [referenceField.key]: [...references, imported] };
      });
      previewRequests.current.delete(imported.id);
      return imported;
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      setGenerationError(message.includes("No handler registered for 'lighttable:genai-project-asset-import'")
        ? 'Restart the LightTable desktop process once to enable local reference imports.'
        : message);
      return undefined;
    }
  }, [projectId, service, workflow]);
  const removeAssetReference = React.useCallback((assetId: GenAiAssetId) => {
    const referenceField = workflow?.fields.find(({ role }) => role === 'references');
    if (!referenceField) return;
    setValues((current) => ({
      ...current,
      [referenceField.key]: Array.isArray(current[referenceField.key])
        ? (current[referenceField.key] as GenAiAssetReference[]).filter(({ id }) => id !== assetId)
        : []
    }));
  }, [workflow]);
  const prompt = String(values.prompt ?? '');
  const referenceField = workflow?.fields.find(({ role }) => role === 'references');
  const selectedReferences = React.useMemo(() => referenceField && Array.isArray(values[referenceField.key])
    ? values[referenceField.key] as GenAiAssetReference[] : [], [referenceField, values]);
  const resolvedMentions = React.useMemo(
    () => resolveGenAiPromptMentions(prompt, mentionOptions, selectedReferences),
    [mentionOptions, prompt, selectedReferences]
  );
  const validationValues = React.useMemo(() => {
    if (!workflow) return values;
    const next = { ...values };
    for (const field of workflow.fields) {
      if (field.kind === 'asset') next[field.key] = selectedReferences;
    }
    return next;
  }, [selectedReferences, values, workflow]);
  const validationIssues = workflow ? validateGenAiWorkflowValues(workflow, validationValues) : [];
  const tooManyReferences = workflow?.fields.some((field) => field.kind === 'asset'
    && typeof field.sourceSchema.maxItems === 'number'
    && resolvedMentions.references.length > field.sourceSchema.maxItems) ?? false;
  const acceptsReferences = workflow?.fields.some((field) => field.kind === 'asset') ?? false;
  const referenceIssue = resolvedMentions.references.length && !acceptsReferences
    ? `${workflow?.label ?? 'This workflow'} does not accept visual references.`
    : undefined;
  const workflowReady = Boolean(workflow && workflow.modelId === selectedModelId && workflow.mode === selectedMode);
  const canGenerate = Boolean(
    service && projectId && workflowReady && prompt.trim() && validationIssues.length === 0
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
      const outputValue = (role: 'aspect-ratio' | 'output-size' | 'quality' | 'output-count') => {
        const field = workflow.fields.find((candidate) => candidate.role === role);
        return field ? values[field.key] : undefined;
      };
      const aspectRatio = outputValue('aspect-ratio');
      const outputSize = outputValue('output-size');
      const quality = outputValue('quality');
      const outputCount = outputValue('output-count');
      const next = await service.submitGeneration(projectId, {
        providerId: provider.id,
        modelId: selectedModelId,
        workflowId: workflow.id,
        prompt,
        providerPrompt: resolvedMentions.providerPrompt,
        promptBindings: resolvedMentions.bindings,
        output: {
          ...(typeof aspectRatio === 'string' ? { aspectRatio } : {}),
          ...(typeof outputSize === 'string' ? { size: outputSize } : {}),
          ...(typeof quality === 'string' ? { quality } : {}),
          ...(typeof outputCount === 'number' ? { count: outputCount } : {})
        },
        fields: values,
        references: resolvedMentions.references
      });
      setSubmission(next);
      if (next.result) {
        const nextCatalog = await service.loadProjectAssetCatalog(projectId);
        setAssets(nextCatalog.assets); setAssetSections(nextCatalog.sections);
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
    setMode: setSelectedMode, assets, assetSections, mentionOptions, assetPreviews, requestAssetPreview, addAssetReference,
    importAssetReference, removeAssetReference, refreshAssets,
    generating, generationError, referenceIssue, costEstimate, submission, canGenerate, generate, restoreRequest
  };
};
