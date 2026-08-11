import React from 'react';
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

export type GenAiPanelProviderStatus = 'disconnected' | 'connecting' | 'connected' | 'error' | 'expired';

export interface GenAiPanelProps {
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

const isOpenArtReady = (asset: GenAiAssetReference): boolean =>
  asset.publishedProviderIds?.some((providerId) => providerId === 'openart') ?? false;

const QUALITY_DESCRIPTIONS: Readonly<Record<string, string>> = {
  low: 'Fastest and cheapest',
  medium: 'Balanced visuals',
  high: 'Best visual fidelity'
};

const GenAiQualityControl = ({ field, value, update }: {
  field: GenAiWorkflowDefinition['fields'][number];
  value: unknown;
  update: (value: string) => void;
}) => {
  const [menu, setMenu] = React.useState<{ readonly x: number; readonly y: number }>();
  const selected = String(value ?? field.defaultValue ?? '');
  const selectedLabel = field.options?.find((option) => option.value === selected)?.label ?? selected;
  return <div className="genai-panel__featured-setting">
    <button type="button" aria-haspopup="menu" aria-expanded={Boolean(menu)} onClick={(event) => {
      const bounds = event.currentTarget.getBoundingClientRect();
      setMenu({ x: bounds.left, y: bounds.bottom + 2 });
    }}>
      <span className="genai-panel__setting-icon">Q</span><strong>{selectedLabel}</strong>
    </button>
    <ContextMenu open={Boolean(menu)} x={menu?.x ?? 0} y={menu?.y ?? 0} onClose={() => setMenu(undefined)}
      options={(field.options ?? []).map((option) => ({
        value: option.value,
        label: option.label,
        ...(QUALITY_DESCRIPTIONS[option.value.toLocaleLowerCase('en-US')]
          ? { description: QUALITY_DESCRIPTIONS[option.value.toLocaleLowerCase('en-US')] }
          : {}),
        icon: option.value === selected ? '✓' : undefined,
        onClick: () => update(option.value)
      }))} />
  </div>;
};

export const GenAiPanel = (props: GenAiPanelProps) => {
  const { providerName, status, onConnect, message, projectName, models = [], workflow,
    selectedModelId, onModelChange, selectedMode, onModeChange, loading = false, setupError, values = {}, onFieldChange,
    mentionOptions = [], assetPreviews = {}, onRequestAssetPreview = () => undefined,
    generating = false, generationError, referenceIssue, costEstimate, submission, canGenerate = false, onGenerate } = props;
  const prompt = String(values.prompt ?? '');
  const model = models.find(({ id }) => id === workflow?.modelId);
  const basicFields = workflow?.fields.filter((field) => field.key !== 'prompt' && field.kind !== 'asset'
    && genAiFieldPlacement(field) === 'basic') ?? [];
  const advancedFields = workflow?.fields.filter((field) => field.key !== 'prompt' && field.kind !== 'asset'
    && genAiFieldPlacement(field) === 'advanced') ?? [];
  const aspectField = workflow?.fields.find(({ key }) => key === 'aspectRatio');
  const resolutionField = workflow?.fields.find(({ key }) => key === 'resolution');
  const qualityField = workflow?.fields.find(({ key }) => key === 'quality');
  const countField = workflow?.fields.find(({ key }) => key === 'imageCount');
  const references = mentionOptions.filter(({ token }) => tokenAppears(prompt, token));
  const count = Number(values.imageCount ?? countField?.defaultValue ?? 1);
  const mode = (selectedMode ?? workflow?.mode) === 'image2image' ? 'image2image' : 'text2image';
  const [referencePickerOpen, setReferencePickerOpen] = React.useState(false);

  const insertReference = React.useCallback((option: GenAiAssetMentionOption) => {
    if (!tokenAppears(prompt, option.token)) {
      onFieldChange?.('prompt', `${prompt}${prompt && !/\s$/u.test(prompt) ? ' ' : ''}${option.token} `);
    }
    onRequestAssetPreview(option.asset.id);
    setReferencePickerOpen(false);
  }, [onFieldChange, onRequestAssetPreview, prompt]);

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
    </div></div> : loading ? <div className="lighttable-panel__empty">Loading image model…</div>
      : setupError ? <div className="lighttable-panel__empty"><p role="alert">{setupError}</p></div>
        : workflow ? <form className="genai-panel__form" onSubmit={(event) => { event.preventDefault(); onGenerate?.(); }}>
          <div className="genai-panel__body">
            <SegmentedControl className="genai-panel__mode-switch" ariaLabel="Image generation mode"
              value={mode} onChange={onModeChange ?? (() => undefined)} options={[
                { value: 'image2image', label: 'Image Edit', disabled: !model?.capabilities.includes('image2image') },
                { value: 'text2image', label: 'Image Create', disabled: !model?.capabilities.includes('text2image') }
              ]} />
            <div className="genai-panel__provider-row">
              <div className="segmented-control" aria-label="Provider">
                <button type="button" className="segmented-control__button" disabled>ComfyUI</button>
                <button type="button" className="segmented-control__button" disabled>Higgsfield</button>
                <button type="button" className="segmented-control__button segmented-control__button--active">OpenArt</button>
              </div>
              <span className="genai-panel__provider-light" title="OpenArt connected" />
            </div>
            <select className="form-input genai-panel__workflow" value={selectedModelId ?? workflow.modelId}
              aria-label="Generation model" onChange={(event) => onModelChange?.(event.currentTarget.value as GenAiModelSummary['id'])}>
              {models.map((option) => <option value={option.id} key={option.id}>{option.label}</option>)}
            </select>
            <section className="genai-panel__reference-well" aria-label="Visual references">
              <header><strong>▧ &nbsp; Visual references</strong><span>{references.length}/10</span></header>
              {references.length ? <div className="genai-panel__reference-items">{references.map(({ token, asset }) => {
                return <div className="genai-panel__reference-item" key={asset.id}
                  title={isOpenArtReady(asset) ? `${token} · OpenArt ready` : `${token} · Publishes securely when generated`}>
                  {assetPreviews[asset.id] ? <img src={assetPreviews[asset.id]} alt="" /> : null}<strong>{token}</strong>
                </div>;
              })}</div> : null}
              <button type="button" className="genai-panel__reference-add" aria-expanded={referencePickerOpen}
                onClick={() => {
                  const open = !referencePickerOpen;
                  setReferencePickerOpen(open);
                  if (open) for (const option of mentionOptions.slice(0, 30)) onRequestAssetPreview(option.asset.id);
                }}>
                {mentionOptions.length ? 'Add project image' : 'No indexed project images'}
              </button>
              {referencePickerOpen ? <div className="genai-panel__reference-picker" role="listbox" aria-label="Project images">
                {mentionOptions.slice(0, 30).map((option) => <button type="button" role="option"
                  aria-selected={tokenAppears(prompt, option.token)} key={option.asset.id}
                  onClick={() => insertReference(option)}>
                  <span className="genai-prompt-composer__thumb">
                    {assetPreviews[option.asset.id] ? <img src={assetPreviews[option.asset.id]} alt="" /> : null}
                  </span>
                  <span><strong>{option.asset.label}</strong><small>{option.token} · {isOpenArtReady(option.asset) ? 'OpenArt ready' : 'Publishes on generate'}</small></span>
                </button>)}
              </div> : null}
            </section>
            <GenAiPromptComposer value={prompt} onChange={(value) => onFieldChange?.('prompt', value)}
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
            {generationError ? <p className="genai-panel__error" role="alert">{generationError}</p> : null}
            {referenceIssue ? <p className="genai-panel__notice" role="status">{referenceIssue}</p> : null}
            {submission ? <div className="genai-panel__result" role="status">
              {submission.result && assetPreviews[submission.result.assetId]
                ? <img src={assetPreviews[submission.result.assetId]} alt="Generated result" /> : null}
              <span>{submission.status === 'succeeded' ? `Saved · ${submission.result?.fileName ?? 'AiRenders/History'}` : `OpenArt job · ${submission.providerJobId}`}</span>
            </div> : null}
            <div className="genai-panel__featured-settings">
              {aspectField ? <label><span className="genai-panel__setting-icon">▭</span>
                <select value={String(values.aspectRatio ?? aspectField.defaultValue ?? '')}
                  onChange={(event) => onFieldChange?.('aspectRatio', event.currentTarget.value)}>
                  {aspectField.options?.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
                </select></label> : null}
              {resolutionField ? <label><span className="genai-panel__setting-icon">▱</span>
                <select value={String(values.resolution ?? resolutionField.defaultValue ?? '')}
                  onChange={(event) => onFieldChange?.('resolution', event.currentTarget.value)}>
                  {resolutionField.options?.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
                </select></label> : null}
              {qualityField ? <GenAiQualityControl field={qualityField} value={values.quality}
                update={(value) => onFieldChange?.('quality', value)} /> : null}
            </div>
          </div>
          <footer className="genai-panel__footer">
            {costEstimate ? <span className="genai-panel__cost" title="Estimated provider cost">
              ≈ {costEstimate.label}
            </span> : null}
            <div className="genai-panel__output-count" aria-label="Output count">
              <button type="button" onClick={() => onFieldChange?.('imageCount', Math.max(countField?.minimum ?? 1, count - 1))}>−</button>
              <strong>{count}/{countField?.maximum ?? 4}</strong>
              <button type="button" onClick={() => onFieldChange?.('imageCount', Math.min(countField?.maximum ?? 4, count + 1))}>+</button>
            </div>
            <ActionButton type="submit" disabled={!canGenerate || !onGenerate}>
              {generating ? 'Generating…' : 'Generate'}
            </ActionButton>
          </footer>
        </form> : <div className="lighttable-panel__empty">No compatible image workflow is available.</div>}
  </aside>;
};
