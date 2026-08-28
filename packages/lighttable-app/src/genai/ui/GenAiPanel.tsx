import { ButtonBase } from '../../ui/ButtonBase';
import React from 'react';
import { createPortal } from 'react-dom';
import type {
  GenAiAssetId,
  GenAiAssetMentionOption,
  GenAiAssetReference,
  GenAiGenerationSubmission,
  GenAiCostEstimate,
  GenAiModelSummary,
  GenAiWorkflowDefinition
} from '@lighttable/genai-core';
import { genAiFieldPlacement } from '@lighttable/genai-core';
import { ActionButton } from '../../ui/ActionButton';
import { ContextMenu } from '../../ui/ContextMenu';
import { FormInput } from '../../ui/FormInput';
import { FormSelect } from '../../ui/FormSelect';
import { SegmentedControl } from '../../ui/SegmentedControl';
import { SwitchControl } from '../../ui/SwitchControl';
import { PanelNumberSlider, PanelSelectField } from '../../ui/PanelControls';
import { GenAiPromptComposer } from './GenAiPromptComposer';
import { containsProjectAssetDrag, readProjectAssetDrag } from './projectAssetDrag';
import {
  containsLightTableDocumentDrag,
  readLightTableDocumentDrag
} from '../../lighttable/editor/workspace/documentTabDrag';
import type { GenAiGenerationReadiness } from '../application/genAiGenerationReadiness';

export type GenAiPanelProviderStatus = 'disconnected' | 'connecting' | 'connected' | 'error' | 'expired';

export interface GenAiPanelProps {
  readonly interactionActive?: boolean;
  readonly providerId?: string;
  readonly providerName: string;
  readonly status: GenAiPanelProviderStatus;
  readonly onConnect?: () => void;
  readonly message?: string;
  readonly projectName?: string;
  readonly models?: readonly GenAiModelSummary[];
  readonly workflow?: GenAiWorkflowDefinition;
  readonly selectedModelId?: GenAiModelSummary['id'];
  readonly onModelChange?: (modelId: GenAiModelSummary['id']) => void;
  readonly selectedMode?: string;
  readonly onModeChange?: (mode: string) => void;
  readonly loading?: boolean;
  readonly setupError?: string;
  readonly values?: Readonly<Record<string, unknown>>;
  readonly onFieldChange?: (key: string, value: unknown) => void;
  readonly assets?: readonly GenAiAssetReference[];
  readonly mentionOptions?: readonly GenAiAssetMentionOption[];
  readonly assetPreviews?: Readonly<Record<string, string>>;
  readonly onRequestAssetPreview?: (assetId: GenAiAssetId) => void;
  readonly generating?: boolean;
  readonly generationError?: string;
  readonly referenceIssue?: string;
  readonly costEstimate?: GenAiCostEstimate;
  readonly submission?: GenAiGenerationSubmission;
  readonly canGenerate?: boolean;
  readonly generationReadiness?: GenAiGenerationReadiness;
  readonly onGenerate?: () => void;
  readonly baseImageSelected?: boolean;
  readonly baseImageAssetId?: GenAiAssetId;
  readonly onBaseImageSelectedChange?: (selected: boolean) => void;
  readonly onImportReferenceFile?: (file: File) => void | Promise<unknown>;
  readonly onImportDocumentReference?: (documentId: string) => void | Promise<unknown>;
}

const statusLabel: Record<GenAiPanelProviderStatus, string> = {
  disconnected: 'Not connected', connecting: 'Connecting...', connected: 'Connected',
  error: 'Connection failed', expired: 'Connection expired'
};

const FieldControl = ({ field, value, update }: {
  field: GenAiWorkflowDefinition['fields'][number]; value: unknown; update: (value: unknown) => void;
}) => {
  if (field.kind === 'boolean') return <SwitchControl label={field.label} checked={value === true} onCheckedChange={update} />;
  if (field.kind === 'enum') return (
    <PanelSelectField label={field.label} value={String(value ?? '')} options={field.options ?? []}
      onChange={update} />
  );
  if ((field.kind === 'number' || field.kind === 'integer')
    && field.minimum !== undefined && field.maximum !== undefined) return (
    <PanelNumberSlider label={field.label} value={typeof value === 'number' ? value : Number(field.defaultValue ?? field.minimum)}
      min={field.minimum} max={field.maximum} step={field.step ?? (field.kind === 'integer' ? 1 : 0.1)}
      resetValue={typeof field.defaultValue === 'number' ? field.defaultValue : field.minimum} onChange={update} />
  );
  return <FormInput type={field.kind === 'number' || field.kind === 'integer' ? 'number' : 'text'}
    required={field.required} value={String(value ?? '')} min={field.minimum} max={field.maximum}
    step={field.step ?? (field.kind === 'integer' ? 1 : undefined)}
    onChange={(event) => update(field.kind === 'number' || field.kind === 'integer'
      ? event.currentTarget.valueAsNumber : event.currentTarget.value)} />;
};

const GenAiField = ({ field, value, update }: {
  field: GenAiWorkflowDefinition['fields'][number]; value: unknown; update: (value: unknown) => void;
}) => field.kind === 'enum' || ((field.kind === 'number' || field.kind === 'integer')
  && field.minimum !== undefined && field.maximum !== undefined)
  ? <FieldControl field={field} value={value} update={update} />
  : <label className="genai-panel__field"><span>{field.label}</span>
      <FieldControl field={field} value={value} update={update} />
    </label>;

const tokenAppears = (prompt: string, token: string): boolean => new RegExp(
  `(^|\\s)${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\s|$|[.,!?;:])`, 'i'
).test(prompt);

const removeTokenFromPrompt = (prompt: string, token: string): string => prompt
  .replace(new RegExp(
    `(^|\\s)${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\s|$|[.,!?;:])`,
    'giu'
  ), '$1')
  .replace(/[ \t]{2,}/gu, ' ')
  .replace(/[ \t]+\n/gu, '\n')
  .trimStart();

const isProviderReady = (asset: GenAiAssetReference, providerId: string | undefined): boolean =>
  Boolean(providerId && asset.publishedProviderIds?.some((publishedId) => publishedId === providerId));

export const isReferencePublicationError = (message: string | undefined): boolean => Boolean(
  message && (message.includes('Could not publish the local reference')
    || message.includes('Reference publishing is not connected'))
);

const QUALITY_DESCRIPTIONS: Readonly<Record<string, string>> = {
  low: 'Fastest and cheapest',
  medium: 'Balanced visuals',
  high: 'Best visual fidelity'
};

const GenAiFeaturedSelect = ({ field, value, icon, update }: {
  field: GenAiWorkflowDefinition['fields'][number];
  value: unknown;
  icon: string;
  update: (value: string) => void;
}) => {
  const [menu, setMenu] = React.useState<{ readonly x: number; readonly y: number; readonly width: number }>();
  const selected = String(value ?? field.defaultValue ?? '');
  const selectedLabel = field.options?.find((option) => option.value === selected)?.label ?? selected;
  return <div className={`genai-panel__featured-setting${menu ? ' is-open' : ''}`}>
    <ButtonBase type="button" aria-label={field.label} aria-haspopup="menu" aria-expanded={Boolean(menu)} onClick={(event) => {
      const bounds = event.currentTarget.parentElement?.getBoundingClientRect()
        ?? event.currentTarget.getBoundingClientRect();
      setMenu({ x: bounds.left, y: bounds.top - 2, width: bounds.width });
    }}>
      <span className="genai-panel__setting-icon">{icon}</span><strong>{selectedLabel}</strong>
    </ButtonBase>
    <ContextMenu open={Boolean(menu)} x={menu?.x ?? 0} y={menu?.y ?? 0} placement="above"
      className="context-menu--select" width={menu?.width}
      onClose={() => setMenu(undefined)}
      options={(field.options ?? []).map((option) => ({
        value: option.value,
        label: option.label,
        ...(QUALITY_DESCRIPTIONS[option.value.toLocaleLowerCase('en-US')]
          ? { description: QUALITY_DESCRIPTIONS[option.value.toLocaleLowerCase('en-US')] }
          : {}),
        selected: option.value === selected,
        onClick: () => update(option.value)
      }))} />
  </div>;
};

export const GenAiPanel = (props: GenAiPanelProps) => {
  const { interactionActive = true, providerId, providerName, status, onConnect, message, projectName, models = [], workflow,
    selectedModelId, onModelChange, selectedMode, onModeChange, loading = false, setupError, values = {}, onFieldChange,
    mentionOptions = [], assetPreviews = {}, onRequestAssetPreview = () => undefined,
    generating = false, generationError, referenceIssue, costEstimate, submission,
    canGenerate = false, generationReadiness, onGenerate,
    baseImageSelected = false, baseImageAssetId, onBaseImageSelectedChange,
    onImportReferenceFile, onImportDocumentReference } = props;
  const promptField = workflow?.fields.find(({ role }) => role === 'prompt');
  const promptKey = promptField?.key ?? 'prompt';
  const prompt = String(values[promptKey] ?? '');
  // Model selection is UI state; the workflow is provider-adapter state and may
  // temporarily remain on the last usable schema when a newly selected model
  // exposes an incomplete form. Never let that adapter failure replace the
  // complete composer UI.
  const model = models.find(({ id }) => id === selectedModelId)
    ?? models.find(({ id }) => id === workflow?.modelId);
  const basicFields = workflow?.fields.filter((field) => field.role !== 'prompt' && field.role !== 'references'
    && field.kind !== 'asset'
    && !field.locked
    && genAiFieldPlacement(field) === 'basic') ?? [];
  const advancedFields = workflow?.fields.filter((field) => field.role !== 'prompt' && field.role !== 'references'
    && field.kind !== 'asset'
    && !field.locked
    && genAiFieldPlacement(field) === 'advanced') ?? [];
  const aspectField = workflow?.fields.find(({ role }) => role === 'aspect-ratio');
  const resolutionField = workflow?.fields.find(({ role }) => role === 'output-size');
  const qualityField = workflow?.fields.find(({ role }) => role === 'quality');
  const countField = workflow?.fields.find(({ role }) => role === 'output-count');
  const hasFeaturedSettings = Boolean(aspectField || resolutionField || qualityField);
  const referenceField = workflow?.fields.find(({ role }) => role === 'references');
  const firstFrameField = workflow?.fields.find(({ role }) => role === 'first-frame');
  const lastFrameField = workflow?.fields.find(({ role }) => role === 'last-frame');
  const assetFields = workflow?.fields.filter(({ kind }) => kind === 'asset') ?? [];
  const hasFrameSlots = Boolean(firstFrameField || lastFrameField);
  const referenceLimit = hasFrameSlots ? 2 : typeof referenceField?.sourceSchema.maxItems === 'number'
    ? referenceField.sourceSchema.maxItems : 10;
  const selectedReferences = [...new Map(assetFields.flatMap((field) => {
    const value = values[field.key];
    const candidates = Array.isArray(value) ? value : value && typeof value === 'object' ? [value] : [];
    return candidates.filter((candidate): candidate is GenAiAssetReference => 'id' in candidate && typeof candidate.id === 'string');
  }).map((reference) => [reference.id, reference])).values()];
  const updateReferences = (next: readonly GenAiAssetReference[]) => {
    if (firstFrameField) onFieldChange?.(firstFrameField.key, next[0]);
    if (lastFrameField) onFieldChange?.(lastFrameField.key, next[1]);
    if (referenceField) onFieldChange?.(referenceField.key, hasFrameSlots ? [] : next);
  };
  const referencePublicationError = isReferencePublicationError(generationError) ? generationError : undefined;
  const generalGenerationError = referencePublicationError ? undefined : generationError;
  const references = selectedReferences.map((asset) => ({
    asset,
    token: mentionOptions.find((option) => option.asset.id === asset.id)?.token ?? `@${asset.label.replace(/\.[^.]+$/u, '')}`
  }));
  const countKey = countField?.key ?? 'imageCount';
  const count = Number(values[countKey] ?? countField?.defaultValue ?? 1);
  const mode = selectedMode ?? workflow?.mode ?? 'text2image';
  const videoMode = mode.includes('video');
  const taskForMode = (value: string) => value === 'text2image' ? 'image-create'
    : value === 'image2image' ? 'image-edit' : 'video';
  const task = taskForMode(mode);
  const taskModes: Readonly<Record<string, readonly string[]>> = {
    'image-create': ['text2image'], 'image-edit': ['image2image'],
    video: ['text2video', 'references2video', 'frames2video']
  };
  const taskLabels: Readonly<Record<string, string>> = {
    'image-create': 'Image Create', 'image-edit': 'Image Edit', video: 'Video'
  };
  const taskOptions = Object.keys(taskModes).filter((candidate) => models.some(({ capabilities }) =>
    capabilities.some((capability) => taskModes[candidate]!.includes(capability))))
    .map((value) => ({ value, label: taskLabels[value]! }));
  const activeTaskModes = taskModes[task] ?? [];
  const taskModels = models.filter(({ capabilities }) => capabilities.some((capability) => activeTaskModes.includes(capability)));
  const videoLabels: Readonly<Record<string, string>> = {
    text2video: 'Text', references2video: 'References', frames2video: 'Frames'
  };
  const videoOptions = (model?.capabilities ?? []).filter((capability) => videoLabels[capability])
    .map((value) => ({ value, label: videoLabels[value]! }));
  const selectTask = (nextTask: string) => {
    const modes = taskModes[nextTask] ?? [];
    const nextModel = models.find(({ id, capabilities }) => id === model?.id
      && capabilities.some((capability) => modes.includes(capability)))
      ?? models.find(({ capabilities }) => capabilities.some((capability) => modes.includes(capability)));
    if (!nextModel) return;
    const nextMode = modes.find((candidate) => nextModel.capabilities.includes(candidate));
    if (!nextMode) return;
    if (nextModel.id !== model?.id) onModelChange?.(nextModel.id);
    onModeChange?.(nextMode);
  };
  const [referenceDragActive, setReferenceDragActive] = React.useState(false);
  const referenceHover = React.useRef(false);
  const [referencePreview, setReferencePreview] = React.useState<{
    readonly assetId: GenAiAssetId;
    readonly source: string;
    readonly x: number;
    readonly y: number;
  }>();

  React.useEffect(() => {
    if (referencePreview && !references.some(({ asset }) => asset.id === referencePreview.assetId)) {
      setReferencePreview(undefined);
    }
  }, [referencePreview, references]);

  const insertReference = React.useCallback((option: GenAiAssetMentionOption) => {
    if (!selectedReferences.some(({ id }) => id === option.asset.id)) {
      updateReferences([...selectedReferences, option.asset].slice(0, referenceLimit));
    }
    if (!tokenAppears(prompt, option.token)) {
      onFieldChange?.(promptKey, `${prompt}${prompt && !/\s$/u.test(prompt) ? ' ' : ''}${option.token} `);
    }
    onRequestAssetPreview(option.asset.id);
  }, [onFieldChange, onRequestAssetPreview, prompt, promptKey, referenceLimit, selectedReferences]);

  React.useEffect(() => {
    if (!interactionActive || !onImportReferenceFile) return;
    const paste = (event: ClipboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!referenceHover.current && !target?.closest('.genai-prompt-composer')) return;
      const imageItem = Array.from(event.clipboardData?.items ?? [])
        .find((item) => item.kind === 'file' && item.type.startsWith('image/'));
      const image = imageItem?.getAsFile();
      if (!image) return;
      event.preventDefault();
      event.stopPropagation();
      const extension = image.type.split('/')[1]?.replace('jpeg', 'jpg') ?? 'png';
      void onImportReferenceFile(new File([image], `clipboard-${Date.now()}.${extension}`, { type: image.type }));
    };
    window.addEventListener('paste', paste, true);
    return () => window.removeEventListener('paste', paste, true);
  }, [interactionActive, onImportReferenceFile]);

  const updatePrompt = React.useCallback((nextPrompt: string) => {
    onFieldChange?.(promptKey, nextPrompt);
    const mentionedAssets = mentionOptions
      .filter(({ token }) => tokenAppears(nextPrompt, token))
      .map(({ asset }) => asset)
      .filter((asset) => !selectedReferences.some(({ id }) => id === asset.id));
    if (mentionedAssets.length) updateReferences([...selectedReferences, ...mentionedAssets].slice(0, referenceLimit));
  }, [mentionOptions, onFieldChange, promptKey, referenceLimit, selectedReferences]);

  React.useEffect(() => {
    for (const { asset } of references) onRequestAssetPreview(asset.id);
  }, [onRequestAssetPreview, references.map(({ asset }) => asset.id).join('|')]);

  return <aside className="lighttable-panel genai-panel" aria-label="Generative AI">
    {status !== 'connected' ? <div className="lighttable-panel__empty"><div>
      <p><strong>{providerName}</strong><br />{statusLabel[status]}</p>
      {message ? <p role={status === 'error' ? 'alert' : 'status'}>{message}</p> : null}
      <ActionButton onClick={onConnect} disabled={!onConnect || status === 'connecting'}>
        {status === 'expired' ? 'Reconnect' : 'Connect'}
      </ActionButton>
    </div></div> : loading && !workflow ? <div className="lighttable-panel__empty">Loading image model…</div>
      : workflow || setupError ? <form className="genai-panel__form" onSubmit={(event) => { event.preventDefault(); onGenerate?.(); }}>
          <div className="genai-panel__body">
            <SegmentedControl className="genai-panel__mode-switch" ariaLabel="Content type"
              value={task} onChange={selectTask} options={taskOptions} />
            <FormSelect className="genai-panel__workflow" value={selectedModelId ?? workflow?.modelId ?? ''}
              aria-label="Generation model" onChange={(event) => onModelChange?.(event.currentTarget.value as GenAiModelSummary['id'])}>
              {taskModels.map((option) => <option value={option.id} key={option.id}>{option.label}</option>)}
            </FormSelect>
            {model?.description ? <p className="genai-panel__model-description">{model.description}</p> : null}
            {task === 'video' && videoOptions.length > 1 ? <SegmentedControl
              className="genai-panel__variant-switch" ariaLabel="Video input"
              value={mode} onChange={onModeChange ?? (() => undefined)} options={videoOptions} /> : null}
            {setupError ? <p className="genai-panel__error" role="alert">{setupError}</p> : null}
            {assetFields.length ? <section className={`genai-panel__reference-well${referenceDragActive ? ' is-drag-target' : ''}`}
              aria-label={videoMode ? 'Media references' : 'Visual references'}
              onPointerEnter={() => { referenceHover.current = true; }}
              onPointerLeave={() => { referenceHover.current = false; }}
              onDragEnter={(event) => {
                if (!containsProjectAssetDrag(event.dataTransfer)
                  && !containsLightTableDocumentDrag(event.dataTransfer)) return;
                event.preventDefault();
                setReferenceDragActive(true);
              }}
              onDragOver={(event) => {
                if (!containsProjectAssetDrag(event.dataTransfer)
                  && !containsLightTableDocumentDrag(event.dataTransfer)) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = 'copy';
                setReferenceDragActive(true);
              }}
              onDragLeave={(event) => {
                if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
                setReferenceDragActive(false);
              }}
              onDrop={(event) => {
                const assetId = readProjectAssetDrag(event.dataTransfer);
                const documentId = readLightTableDocumentDrag(event.dataTransfer);
                if (!assetId && !documentId) return;
                event.preventDefault();
                setReferenceDragActive(false);
                if (assetId) {
                  const option = mentionOptions.find(({ asset }) => asset.id === assetId);
                  if (option) insertReference(option);
                } else if (documentId) void onImportDocumentReference?.(documentId);
              }}>
              <header><strong>▧ &nbsp; {mode === 'frames2video' ? 'Frames' : 'References'}</strong><span>{references.length}/{referenceLimit}</span></header>
              {references.length ? <div className="genai-panel__reference-items">{references.map(({ token, asset }) => {
                return <div className="genai-panel__reference-item" key={asset.id}
                  onPointerEnter={(event) => {
                    const source = assetPreviews[asset.id];
                    if (!source) return;
                    const bounds = event.currentTarget.getBoundingClientRect();
                    setReferencePreview({ assetId: asset.id, source, x: bounds.right + 8, y: Math.max(8, bounds.top - 72) });
                  }}
                  onPointerLeave={() => setReferencePreview(undefined)}
                  title={isProviderReady(asset, providerId)
                    ? `${token} · ${providerName} ready` : `${token} · Publishes securely when generated`}>
                  {assetPreviews[asset.id]
                    ? <img className="genai-panel__reference-thumbnail" src={assetPreviews[asset.id]} alt="" />
                    : null}
                  <ButtonBase type="button" className="genai-panel__reference-remove"
                    aria-label={`Remove ${token}`} title={`Remove ${token}`}
                    onClick={() => {
                      setReferencePreview(undefined);
                      updateReferences(selectedReferences.filter(({ id }) => id !== asset.id));
                      onFieldChange?.(promptKey, removeTokenFromPrompt(prompt, token));
                      if (asset.id === baseImageAssetId) onBaseImageSelectedChange?.(false);
                    }}>×</ButtonBase>
                  <strong>{token}</strong>
                </div>;
              })}</div> : <p className="genai-panel__reference-empty">
                Drag open tabs or assets here, or paste images.
              </p>}
              {referencePreview && typeof document !== 'undefined' ? createPortal(
                <span className="genai-panel__reference-preview" aria-hidden="true"
                  style={{ left: referencePreview.x, top: referencePreview.y }}>
                  <img src={referencePreview.source} alt="" />
                </span>, document.body
              ) : null}
              {referencePublicationError ? <p className="genai-panel__reference-error" role="alert">
                {referencePublicationError}
              </p> : null}
            </section> : null}
            {!videoMode ? <label className="genai-panel__base-image">
              <input type="checkbox" checked={baseImageSelected}
                onChange={(event) => onBaseImageSelectedChange?.(event.currentTarget.checked)} />
              <span>Add base image</span>
            </label> : null}
            <GenAiPromptComposer value={prompt} onChange={updatePrompt}
              mentions={mentionOptions} previews={assetPreviews} requestPreview={onRequestAssetPreview}
              placeholder={videoMode
                ? 'Describe the video. Type @ to reference a project asset.'
                : 'Describe the image. Type @ to reference a project asset.'} />
            {basicFields.length ? <section className="genai-panel__settings" aria-label="Generation settings">
              {basicFields.map((field) => <GenAiField key={field.key} field={field} value={values[field.key]}
                update={(value) => onFieldChange?.(field.key, value)} />)}
            </section> : null}
            {advancedFields.length ? <details className="genai-panel__advanced"><summary>Advanced</summary>
              <div className="genai-panel__settings">{advancedFields.map((field) => (
                <GenAiField key={field.key} field={field} value={values[field.key]}
                  update={(value) => onFieldChange?.(field.key, value)} />
              ))}</div>
            </details> : null}
            {!projectName ? <p className="genai-panel__notice">Open a project to generate and retain output history.</p> : null}
            {generalGenerationError ? <p className="genai-panel__error" role="alert">{generalGenerationError}</p> : null}
            {referenceIssue ? <p className="genai-panel__notice" role="status">{referenceIssue}</p> : null}
            {submission ? <div className="genai-panel__result" role="status">
              {submission.result && assetPreviews[submission.result.assetId]
                ? <img src={assetPreviews[submission.result.assetId]} alt="Generated result" /> : null}
              <span>{submission.status === 'succeeded' ? `Saved · ${submission.result?.fileName ?? 'AiRenders/History'}` : `${providerName} job · ${submission.providerJobId}`}</span>
            </div> : null}
          </div>
          {hasFeaturedSettings ? <div className="genai-panel__featured-settings">
              {aspectField ? <GenAiFeaturedSelect field={aspectField} value={values[aspectField.key]} icon="▭"
                update={(value) => onFieldChange?.(aspectField.key, value)} /> : null}
              {resolutionField ? <GenAiFeaturedSelect field={resolutionField} value={values[resolutionField.key]} icon="▱"
                update={(value) => onFieldChange?.(resolutionField.key, value)} /> : null}
              {qualityField ? <GenAiFeaturedSelect field={qualityField} value={values[qualityField.key]} icon="Q"
                update={(value) => onFieldChange?.(qualityField.key, value)} /> : null}
            </div> : null}
          <footer className="genai-panel__footer">
            {generationReadiness && !generationReadiness.ready && generationReadiness.code !== 'generating'
              ? <span className="genai-panel__readiness" role="status">{generationReadiness.message}</span>
              : costEstimate ? <span className="genai-panel__cost" title="Estimated provider cost">
              ≈ {costEstimate.label}
            </span> : null}
            <div className="genai-panel__output-count" aria-label="Output count">
              <ButtonBase type="button" onClick={() => onFieldChange?.(countKey, Math.max(countField?.minimum ?? 1, count - 1))}>−</ButtonBase>
              <strong>{count}/{countField?.maximum ?? 4}</strong>
              <ButtonBase type="button" onClick={() => onFieldChange?.(countKey, Math.min(countField?.maximum ?? 4, count + 1))}>+</ButtonBase>
            </div>
            <ActionButton type="submit" size="control" layout="fill"
              disabled={!canGenerate || !onGenerate}
              title={!generationReadiness?.ready ? generationReadiness?.message : undefined}>
              {generating ? 'Generating…' : 'Generate'}
            </ActionButton>
          </footer>
        </form> : <div className="lighttable-panel__empty">No compatible image workflow is available.</div>}
  </aside>;
};
