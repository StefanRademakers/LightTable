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
import { SegmentedControl } from '../../ui/SegmentedControl';
import { SwitchControl } from '../../ui/SwitchControl';
import { GenAiPromptComposer } from './GenAiPromptComposer';
import { containsProjectAssetDrag, readProjectAssetDrag } from './projectAssetDrag';
import {
  containsLightTableDocumentDrag,
  readLightTableDocumentDrag
} from '../../lighttable/editor/workspace/documentTabDrag';

export type GenAiPanelProviderStatus = 'disconnected' | 'connecting' | 'connected' | 'error' | 'expired';

export interface GenAiPanelProps {
  readonly interactionActive?: boolean;
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
    <select className="form-input" value={String(value ?? '')} onChange={(event) => update(event.currentTarget.value)}>
      {field.options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  );
  return <FormInput type={field.kind === 'number' || field.kind === 'integer' ? 'number' : 'text'}
    required={field.required} value={String(value ?? '')} min={field.minimum} max={field.maximum}
    step={field.step ?? (field.kind === 'integer' ? 1 : undefined)}
    onChange={(event) => update(field.kind === 'number' || field.kind === 'integer'
      ? event.currentTarget.valueAsNumber : event.currentTarget.value)} />;
};

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

const isOpenArtReady = (asset: GenAiAssetReference): boolean =>
  asset.publishedProviderIds?.some((providerId) => providerId === 'openart') ?? false;

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
    <button type="button" aria-label={field.label} aria-haspopup="menu" aria-expanded={Boolean(menu)} onClick={(event) => {
      const bounds = event.currentTarget.parentElement?.getBoundingClientRect()
        ?? event.currentTarget.getBoundingClientRect();
      setMenu({ x: bounds.left, y: bounds.top - 2, width: bounds.width });
    }}>
      <span className="genai-panel__setting-icon">{icon}</span><strong>{selectedLabel}</strong>
    </button>
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
  const { interactionActive = true, providerName, status, onConnect, message, projectName, models = [], workflow,
    selectedModelId, onModelChange, selectedMode, onModeChange, loading = false, setupError, values = {}, onFieldChange,
    mentionOptions = [], assetPreviews = {}, onRequestAssetPreview = () => undefined,
    generating = false, generationError, referenceIssue, costEstimate, submission, canGenerate = false, onGenerate,
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
    && genAiFieldPlacement(field) === 'basic') ?? [];
  const advancedFields = workflow?.fields.filter((field) => field.role !== 'prompt' && field.role !== 'references'
    && field.kind !== 'asset'
    && genAiFieldPlacement(field) === 'advanced') ?? [];
  const aspectField = workflow?.fields.find(({ role }) => role === 'aspect-ratio');
  const resolutionField = workflow?.fields.find(({ role }) => role === 'output-size');
  const qualityField = workflow?.fields.find(({ role }) => role === 'quality');
  const countField = workflow?.fields.find(({ role }) => role === 'output-count');
  const hasFeaturedSettings = Boolean(aspectField || resolutionField || qualityField);
  const referenceField = workflow?.fields.find(({ role }) => role === 'references');
  const referenceKey = referenceField?.key ?? 'visualReferences';
  const selectedReferences = Array.isArray(values[referenceKey])
    ? values[referenceKey] as GenAiAssetReference[] : [];
  const referencePublicationError = isReferencePublicationError(generationError) ? generationError : undefined;
  const generalGenerationError = referencePublicationError ? undefined : generationError;
  const references = selectedReferences.map((asset) => ({
    asset,
    token: mentionOptions.find((option) => option.asset.id === asset.id)?.token ?? `@${asset.label.replace(/\.[^.]+$/u, '')}`
  }));
  const countKey = countField?.key ?? 'imageCount';
  const count = Number(values[countKey] ?? countField?.defaultValue ?? 1);
  const mode = (selectedMode ?? workflow?.mode) === 'image2image' ? 'image2image' : 'text2image';
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
      onFieldChange?.(referenceKey, [...selectedReferences, option.asset]);
    }
    if (!tokenAppears(prompt, option.token)) {
      onFieldChange?.(promptKey, `${prompt}${prompt && !/\s$/u.test(prompt) ? ' ' : ''}${option.token} `);
    }
    onRequestAssetPreview(option.asset.id);
  }, [onFieldChange, onRequestAssetPreview, prompt, promptKey, referenceKey, selectedReferences]);

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
    if (mentionedAssets.length) onFieldChange?.(referenceKey, [...selectedReferences, ...mentionedAssets]);
  }, [mentionOptions, onFieldChange, promptKey, referenceKey, selectedReferences]);

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
            <SegmentedControl className="genai-panel__mode-switch" ariaLabel="Image generation mode"
              value={mode} onChange={onModeChange ?? (() => undefined)} options={[
                { value: 'image2image', label: 'Image Edit', disabled: !model?.capabilities.includes('image2image') },
                { value: 'text2image', label: 'Image Create', disabled: !model?.capabilities.includes('text2image') }
              ]} />
            <select className="form-input genai-panel__workflow" value={selectedModelId ?? workflow?.modelId ?? ''}
              aria-label="Generation model" onChange={(event) => onModelChange?.(event.currentTarget.value as GenAiModelSummary['id'])}>
              {models.map((option) => <option value={option.id} key={option.id}>{option.label}</option>)}
            </select>
            {setupError ? <p className="genai-panel__error" role="alert">{setupError}</p> : null}
            <section className={`genai-panel__reference-well${referenceDragActive ? ' is-drag-target' : ''}`}
              aria-label="Visual references"
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
              <header><strong>▧ &nbsp; Visual references</strong><span>{references.length}/10</span></header>
              {references.length ? <div className="genai-panel__reference-items">{references.map(({ token, asset }) => {
                return <div className="genai-panel__reference-item" key={asset.id}
                  onPointerEnter={(event) => {
                    const source = assetPreviews[asset.id];
                    if (!source) return;
                    const bounds = event.currentTarget.getBoundingClientRect();
                    setReferencePreview({ assetId: asset.id, source, x: bounds.right + 8, y: Math.max(8, bounds.top - 72) });
                  }}
                  onPointerLeave={() => setReferencePreview(undefined)}
                  title={isOpenArtReady(asset) ? `${token} · OpenArt ready` : `${token} · Publishes securely when generated`}>
                  {assetPreviews[asset.id]
                    ? <img className="genai-panel__reference-thumbnail" src={assetPreviews[asset.id]} alt="" />
                    : null}
                  <button type="button" className="genai-panel__reference-remove"
                    aria-label={`Remove ${token}`} title={`Remove ${token}`}
                    onClick={() => {
                      setReferencePreview(undefined);
                      onFieldChange?.(referenceKey, selectedReferences.filter(({ id }) => id !== asset.id));
                      onFieldChange?.(promptKey, removeTokenFromPrompt(prompt, token));
                      if (asset.id === baseImageAssetId) onBaseImageSelectedChange?.(false);
                    }}>×</button>
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
            </section>
            <label className="genai-panel__base-image">
              <input type="checkbox" checked={baseImageSelected}
                onChange={(event) => onBaseImageSelectedChange?.(event.currentTarget.checked)} />
              <span>Add base image</span>
            </label>
            <GenAiPromptComposer value={prompt} onChange={updatePrompt}
              mentions={mentionOptions} previews={assetPreviews} requestPreview={onRequestAssetPreview} />
            {basicFields.length ? <section className="genai-panel__settings" aria-label="Generation settings">
              {basicFields.map((field) => <label className="genai-panel__field" key={field.key}><span>{field.label}</span>
                <FieldControl field={field} value={values[field.key]} update={(value) => onFieldChange?.(field.key, value)} />
              </label>)}
            </section> : null}
            {advancedFields.length ? <details className="genai-panel__advanced"><summary>Advanced</summary>
              <div className="genai-panel__settings">{advancedFields.map((field) => (
                <label className="genai-panel__field" key={field.key}><span>{field.label}</span>
                  <FieldControl field={field} value={values[field.key]} update={(value) => onFieldChange?.(field.key, value)} />
                </label>
              ))}</div>
            </details> : null}
            {!projectName ? <p className="genai-panel__notice">Open a project to retain output history.</p> : null}
            {generalGenerationError ? <p className="genai-panel__error" role="alert">{generalGenerationError}</p> : null}
            {referenceIssue ? <p className="genai-panel__notice" role="status">{referenceIssue}</p> : null}
            {submission ? <div className="genai-panel__result" role="status">
              {submission.result && assetPreviews[submission.result.assetId]
                ? <img src={assetPreviews[submission.result.assetId]} alt="Generated result" /> : null}
              <span>{submission.status === 'succeeded' ? `Saved · ${submission.result?.fileName ?? 'AiRenders/History'}` : `OpenArt job · ${submission.providerJobId}`}</span>
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
            {costEstimate ? <span className="genai-panel__cost" title="Estimated provider cost">
              ≈ {costEstimate.label}
            </span> : null}
            <div className="genai-panel__output-count" aria-label="Output count">
              <button type="button" onClick={() => onFieldChange?.(countKey, Math.max(countField?.minimum ?? 1, count - 1))}>−</button>
              <strong>{count}/{countField?.maximum ?? 4}</strong>
              <button type="button" onClick={() => onFieldChange?.(countKey, Math.min(countField?.maximum ?? 4, count + 1))}>+</button>
            </div>
            <ActionButton type="submit" disabled={!canGenerate || !onGenerate}>
              {generating ? 'Generating…' : 'Generate'}
            </ActionButton>
          </footer>
        </form> : <div className="lighttable-panel__empty">No compatible image workflow is available.</div>}
  </aside>;
};
