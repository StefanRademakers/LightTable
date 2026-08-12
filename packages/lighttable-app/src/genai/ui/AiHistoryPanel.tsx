import React from 'react';
import type {
  GenAiAssetId,
  GenAiGenerationJob,
  GenAiGenerationResult
} from '@lighttable/genai-core';
import { ContextMenu, type ContextMenuOption } from '../../ui/ContextMenu';
import { buildJustifiedLayout } from './justifiedLayout';

export interface AiHistoryPanelProps {
  readonly jobs: readonly GenAiGenerationJob[];
  readonly loading?: boolean;
  readonly error?: string;
  readonly previews?: Readonly<Record<string, string>>;
  readonly onRequestPreview?: (assetId: GenAiAssetId) => void;
  readonly onOpenResult?: (job: GenAiGenerationJob) => void;
  /** Restores the persisted request into the GenAI editor; never submits it. */
  readonly onRecreate?: (job: GenAiGenerationJob) => void;
  readonly onRevealResult?: (job: GenAiGenerationJob) => Promise<void> | void;
  readonly onDeleteJob?: (job: GenAiGenerationJob) => Promise<void> | void;
}

const statusLabel: Record<GenAiGenerationJob['status'], string> = {
  queued: 'Queued', submitting: 'Submitting', running: 'Generating', succeeded: 'Complete',
  failed: 'Failed', cancelled: 'Cancelled', 'unknown-submit': 'Checking status'
};

interface MenuState { readonly x: number; readonly y: number; readonly job: GenAiGenerationJob }
interface HistoryTile {
  readonly key: string;
  readonly job: GenAiGenerationJob;
  readonly result?: GenAiGenerationResult;
  readonly aspectRatio: number;
}
const GAP = 3;
const FOOTER = 27;
const TARGET_ROW_HEIGHT = 180;

const parseAspectRatio = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  if (typeof value !== 'string') return undefined;
  const pair = value.trim().match(/^(\d+(?:\.\d+)?)\s*[:x/]\s*(\d+(?:\.\d+)?)$/i);
  if (!pair) return undefined;
  const width = Number(pair[1]); const height = Number(pair[2]);
  return width > 0 && height > 0 ? width / height : undefined;
};

const requestedAspectRatio = (job: GenAiGenerationJob): number => {
  const fields = job.request.fields;
  const ratio = parseAspectRatio(fields.aspectRatio ?? fields.aspect_ratio ?? fields.ratio);
  if (ratio) return ratio;
  const width = Number(fields.width ?? fields.outputWidth);
  const height = Number(fields.height ?? fields.outputHeight);
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
    ? width / height
    : 1;
};

/** One chronological gallery for running and completed project generations. */
export const AiHistoryPanel = ({ jobs, loading = false, error, previews = {}, onRequestPreview,
  onOpenResult, onRecreate, onRevealResult, onDeleteJob }: AiHistoryPanelProps) => {
  const [gridElement, setGridElement] = React.useState<HTMLDivElement | null>(null);
  const [width, setWidth] = React.useState(0);
  const [ratios, setRatios] = React.useState<Record<string, number>>({});
  const [menu, setMenu] = React.useState<MenuState>();
  const [busyJob, setBusyJob] = React.useState<string>();
  const [actionError, setActionError] = React.useState<string>();
  const [hiddenJobs, setHiddenJobs] = React.useState<ReadonlySet<string>>(new Set());

  React.useLayoutEffect(() => {
    if (!gridElement) return;
    const measure = () => setWidth(gridElement.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(gridElement);
    return () => observer.disconnect();
  }, [gridElement]);
  React.useEffect(() => {
    for (const job of jobs) for (const result of job.results) onRequestPreview?.(result.assetId);
  }, [jobs, onRequestPreview]);

  const run = async (job: GenAiGenerationJob, action?: (job: GenAiGenerationJob) => Promise<void> | void) => {
    if (!action) return false;
    setBusyJob(job.id); setActionError(undefined);
    try { await action(job); return true; } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : String(reason));
      return false;
    } finally { setBusyJob(undefined); }
  };

  const visibleJobs = jobs.filter(({ id }) => !hiddenJobs.has(id));
  const tiles: readonly HistoryTile[] = visibleJobs.flatMap((job) => job.results.length
    ? job.results.map((result) => ({
      key: `${job.id}:${result.assetId}`, job, result,
      aspectRatio: result.width && result.height
        ? result.width / result.height
        : ratios[result.assetId] ?? requestedAspectRatio(job)
    }))
    : [{ key: `${job.id}:pending`, job, aspectRatio: requestedAspectRatio(job) }]);
  const tilesByKey = new Map(tiles.map((tile) => [tile.key, tile]));
  const layout = buildJustifiedLayout(tiles, width, TARGET_ROW_HEIGHT, GAP, FOOTER);
  const menuHasResult = Boolean(menu?.job.results.length);
  const menuOptions: Array<ContextMenuOption<string>> = menu ? [
    ...(menuHasResult ? [
      { value: 'open', label: 'Open', disabled: !onOpenResult, onClick: () => onOpenResult?.(menu.job) },
      { value: 'reveal', label: 'Open file location', disabled: !onRevealResult,
        onClick: () => { void run(menu.job, onRevealResult); } }
    ] : []),
    { value: 'recreate', label: 'Recreate', disabled: !onRecreate,
      onClick: () => onRecreate?.(menu.job) },
    ...(menuHasResult ? [{
      value: 'delete', label: 'Delete', separatorBefore: true, disabled: !onDeleteJob || busyJob === menu.job.id,
      onClick: () => { void run(menu.job, onDeleteJob).then((deleted) => {
        if (deleted) setHiddenJobs((current) => new Set(current).add(menu.job.id));
      }); }
    }] : [])
  ] : [];

  return <aside className="lighttable-panel" aria-label="AI history">
    <div className="lighttable-panel__controls genai-history">
      {error || actionError ? <div className="lighttable-panel__error">{actionError ?? error}</div> : null}
      {loading && !visibleJobs.length ? <div className="lighttable-panel__empty">Loading generation history…</div>
        : !visibleJobs.length ? <div className="lighttable-panel__empty">Generated images and active jobs will appear here.</div>
          : <section className="genai-history__history" aria-label="Generation history">
            <h3>History</h3><div ref={setGridElement} className="genai-history__grid" style={{ height: layout.height }}>
              {layout.items.map((item) => {
                const tile = tilesByKey.get(item.key)!;
                const preview = tile.result ? previews[tile.result.assetId] : undefined;
                return <article key={item.key} className="genai-history__card" style={{
                  transform: `translate(${item.x}px, ${item.y}px)`, width: item.width, height: item.height + FOOTER
                }} onDoubleClick={() => { if (tile.result) onOpenResult?.(tile.job); }} onContextMenu={(event) => {
                  event.preventDefault(); setMenu({ x: event.clientX, y: event.clientY, job: tile.job });
                }}>
                  <div className={`genai-history__preview${tile.result ? '' : ' genai-history__preview--pending'}`} style={{ height: item.height }}>
                    {preview ? <img className="genai-history__thumbnail" src={preview} alt="" draggable={false}
                      onLoad={(event) => { const image = event.currentTarget; if (image.naturalHeight && tile.result) {
                        setRatios((current) => ({ ...current, [tile.result!.assetId]: image.naturalWidth / image.naturalHeight }));
                      } }} /> : tile.result ? <span>Image</span> : <span className="genai-history__status">
                        <strong>{statusLabel[tile.job.status]}</strong>
                        {tile.job.error ? <small>{tile.job.error}</small> : null}
                      </span>}
                  </div>
                  <div className="genai-history__footer" title={tile.result?.fileName ?? tile.job.request.prompt}>
                    <span aria-hidden="true">▧</span><strong>{tile.result?.fileName ?? tile.job.request.prompt ?? 'Untitled generation'}</strong>
                  </div>
                </article>;
              })}
            </div>
          </section>}
    </div>
    <ContextMenu open={Boolean(menu)} x={menu?.x ?? 0} y={menu?.y ?? 0}
      onClose={() => setMenu(undefined)} options={menuOptions} />
  </aside>;
};
