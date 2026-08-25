import { ButtonBase } from '../../ui/ButtonBase';
import React from 'react';
import type { GenAiAssetId, GenAiAssetReference, GenAiGenerationJob, GenAiProjectAssetSection } from '@lighttable/genai-core';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { ContextMenu, type ContextMenuOption } from '../../ui/ContextMenu';
import { TextInputDialog } from '../../ui/TextInputDialog';
import { PanelSection } from '../../ui/PanelSection';
import { buildJustifiedLayout } from './justifiedLayout';
import { writeProjectAssetDrag } from './projectAssetDrag';
import { lightTableIcon } from '../../assets/icons';
import { SearchField } from '../../ui/SearchField';

export interface ProjectAssetBrowserProps {
  readonly jobs: readonly GenAiGenerationJob[];
  readonly assets: readonly GenAiAssetReference[];
  readonly sections?: readonly GenAiProjectAssetSection[];
  readonly loading?: boolean;
  readonly error?: string;
  readonly previews?: Readonly<Record<string, string>>;
  readonly onRequestPreview?: (assetId: GenAiAssetId) => void;
  readonly onOpenResult?: (job: GenAiGenerationJob) => void;
  readonly onOpenAsset?: (asset: GenAiAssetReference) => void;
  /** Restores persisted generation settings into the editor; it never submits. */
  readonly onRecreate?: (job: GenAiGenerationJob) => void;
  readonly onAddReference?: (asset: GenAiAssetReference) => void;
  readonly onRevealAsset?: (asset: GenAiAssetReference) => Promise<void> | void;
  readonly onRenameAsset?: (asset: GenAiAssetReference, name: string) => Promise<GenAiAssetReference> | void;
  readonly onDeleteAsset?: (asset: GenAiAssetReference) => Promise<void> | void;
  readonly onDeleteJob?: (job: GenAiGenerationJob) => Promise<void> | void;
  readonly onRefreshAssets?: () => Promise<void> | void;
}

interface MenuState { readonly x: number; readonly y: number; readonly asset?: GenAiAssetReference; readonly job?: GenAiGenerationJob }
const GAP = 3;
const FOOTER = 27;
const TARGET_ROW_HEIGHT = 180;

const sectionName = (asset: GenAiAssetReference): string => asset.section?.trim()
  || (asset.relativePath?.includes('/') ? asset.relativePath.split('/')[0] : 'Root');
const withoutExtension = (name: string): string => name.replace(/\.[^.]+$/u, '');
const normalizeSearchText = (value: string): string => value.normalize('NFKD')
  .replace(/[\u0300-\u036f]/gu, '').toLocaleLowerCase().trim();

export const projectAssetMatchesQuery = (
  asset: GenAiAssetReference,
  query: string,
  job?: GenAiGenerationJob
): boolean => {
  const needle = normalizeSearchText(query);
  if (!needle) return true;
  return normalizeSearchText([
    asset.label,
    asset.relativePath,
    asset.section,
    job?.request.prompt,
    job?.request.modelId,
    job?.request.providerId
  ].filter(Boolean).join(' ')).includes(needle);
};

const generationJobMatchesQuery = (job: GenAiGenerationJob, query: string): boolean => {
  const needle = normalizeSearchText(query);
  if (!needle) return true;
  return normalizeSearchText([
    job.request.prompt,
    job.request.modelId,
    job.request.providerId,
    job.status
  ].join(' ')).includes(needle);
};

export const requestedGenerationAspectRatio = (job: GenAiGenerationJob): number => {
  const ratioEntry = job.request.output?.aspectRatio ?? Object.entries(job.request.fields).find(([key, value]) =>
    /aspect.*ratio|ratio.*aspect/iu.test(key) && typeof value === 'string'
  )?.[1];
  const match = typeof ratioEntry === 'string'
    ? ratioEntry.match(/^\s*(\d+(?:\.\d+)?)\s*[:/]\s*(\d+(?:\.\d+)?)\s*$/u)
    : null;
  if (match) {
    const width = Number(match[1]); const height = Number(match[2]);
    if (width > 0 && height > 0) return width / height;
  }
  const width = Number(job.request.fields.width);
  const height = Number(job.request.fields.height);
  return width > 0 && height > 0 ? width / height : 1;
};

type GalleryTile =
  | { readonly key: string; readonly kind: 'asset'; readonly asset: GenAiAssetReference; readonly aspectRatio: number }
  | { readonly key: string; readonly kind: 'pending'; readonly job: GenAiGenerationJob; readonly aspectRatio: number };

const AssetGallery = ({ assets, pendingJobs = [], previews, onRequestPreview, onOpen, onContextMenu, onJobContextMenu }: {
  readonly assets: readonly GenAiAssetReference[];
  readonly pendingJobs?: readonly GenAiGenerationJob[];
  readonly previews: Readonly<Record<string, string>>;
  readonly onRequestPreview?: (assetId: GenAiAssetId) => void;
  readonly onOpen?: (asset: GenAiAssetReference) => void;
  readonly onContextMenu: (event: React.MouseEvent, asset: GenAiAssetReference) => void;
  readonly onJobContextMenu: (event: React.MouseEvent, job: GenAiGenerationJob) => void;
}) => {
  const [element, setElement] = React.useState<HTMLDivElement | null>(null);
  const [width, setWidth] = React.useState(0);
  const [ratios, setRatios] = React.useState<Record<string, number>>({});
  const requestedPreviews = React.useRef(new Set<GenAiAssetId>());
  React.useLayoutEffect(() => {
    if (!element) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const nextWidth = Math.round(element.clientWidth);
        setWidth((current) => current === nextWidth ? current : nextWidth);
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [element]);
  React.useEffect(() => {
    const visibleIds = new Set(assets.map(({ id }) => id));
    for (const requestedId of requestedPreviews.current) {
      if (!visibleIds.has(requestedId)) requestedPreviews.current.delete(requestedId);
    }
    assets.forEach((asset) => {
      if (previews[asset.id] || requestedPreviews.current.has(asset.id)) return;
      requestedPreviews.current.add(asset.id);
      onRequestPreview?.(asset.id);
    });
  }, [assets, onRequestPreview, previews]);
  const tiles: GalleryTile[] = [
    ...pendingJobs.map((job): GalleryTile => ({
      key: `pending:${job.id}`, kind: 'pending', job, aspectRatio: requestedGenerationAspectRatio(job)
    })),
    ...assets.map((asset): GalleryTile => ({
      key: String(asset.id), kind: 'asset', asset, aspectRatio: ratios[asset.id] ?? 1
    }))
  ];
  const byKey = new Map(tiles.map((tile) => [tile.key, tile]));
  const layout = buildJustifiedLayout(tiles, width, TARGET_ROW_HEIGHT, GAP, FOOTER);
  return <div ref={setElement} className="genai-history__grid" style={{ height: layout.height }}>
    {layout.items.map((item) => {
      const tile = byKey.get(item.key)!;
      if (tile.kind === 'pending') {
        const state = tile.job.status === 'queued' ? 'Queued'
          : tile.job.status === 'preparing-inputs' ? 'Preparing media'
            : tile.job.status === 'ready-to-submit' ? 'Ready'
              : tile.job.status === 'submitting' ? 'Submitting'
                : tile.job.status === 'unknown-submit' ? 'Needs review'
                  : tile.job.status === 'succeeded' ? 'Finalizing' : 'Running';
        return <article key={tile.key} className="genai-history__card" style={{
          transform: `translate(${item.x}px, ${item.y}px)`, width: item.width, height: item.height + FOOTER
        }} onContextMenu={(event) => onJobContextMenu(event, tile.job)}>
          <div className="genai-history__preview genai-history__preview--pending" style={{ height: item.height }}>
            <span className="genai-history__spinner" aria-hidden="true" />
            <strong>{state}</strong>
          </div>
          <div className="genai-history__footer" title={tile.job.request.prompt}>
            <span aria-hidden="true">▧</span><strong>AI render</strong>
          </div>
        </article>;
      }
      const asset = tile.asset; const preview = previews[asset.id as string];
      return <article key={asset.id} className="genai-history__card" draggable style={{
        transform: `translate(${item.x}px, ${item.y}px)`, width: item.width, height: item.height + FOOTER
      }} onDragStart={(event) => writeProjectAssetDrag(event.dataTransfer, asset.id, asset.label)}
        onDoubleClick={() => onOpen?.(asset)}
        onContextMenu={(event) => onContextMenu(event, asset)}>
        <div className="genai-history__preview" style={{ height: item.height }}>
          {preview ? <img className="genai-history__thumbnail" src={preview} alt="" draggable={false} onLoad={(event) => {
            const image = event.currentTarget;
            if (image.naturalHeight) {
              const nextRatio = image.naturalWidth / image.naturalHeight;
              setRatios((current) => Math.abs((current[asset.id] ?? 0) - nextRatio) < 0.0001
                ? current
                : { ...current, [asset.id]: nextRatio });
            }
          }} /> : <span>Image</span>}
        </div>
        <div className="genai-history__footer" title={asset.label}><span aria-hidden="true">▧</span><strong>{asset.label}</strong></div>
      </article>;
    })}
  </div>;
};

export const ProjectAssetBrowser = ({ jobs, assets, sections = [], loading = false, error, previews = {}, onRequestPreview,
  onOpenResult, onOpenAsset, onRecreate, onAddReference, onRevealAsset, onRenameAsset, onDeleteAsset,
  onDeleteJob, onRefreshAssets }: ProjectAssetBrowserProps) => {
  const [openSections, setOpenSections] = React.useState<ReadonlySet<string>>(new Set(['AI History']));
  const [menu, setMenu] = React.useState<MenuState>();
  const [renameAsset, setRenameAsset] = React.useState<GenAiAssetReference>();
  const [deleteTarget, setDeleteTarget] = React.useState<{ asset?: GenAiAssetReference; job?: GenAiGenerationJob }>();
  const [actionError, setActionError] = React.useState<string>();
  const [searchQuery, setSearchQuery] = React.useState('');
  const searchInput = React.useRef<HTMLInputElement>(null);
  const normalizedQuery = normalizeSearchText(searchQuery);
  const searching = normalizedQuery.length > 0;
  const jobByAssetId = React.useMemo(() => new Map(
    jobs.flatMap((job) => job.results.map((result) => [result.assetId, job] as const))
  ), [jobs]);
  const allGroups = React.useMemo(() => {
    const next = new Map<string, GenAiAssetReference[]>();
    assets.forEach((asset) => {
      const name = sectionName(asset);
      next.set(name, [...(next.get(name) ?? []), asset]);
    });
    return next;
  }, [assets]);
  const groups = React.useMemo(() => {
    if (!searching) return allGroups;
    const next = new Map<string, GenAiAssetReference[]>();
    allGroups.forEach((sectionAssets, name) => {
      const sectionMatches = normalizeSearchText(name).includes(normalizedQuery);
      const matches = sectionMatches ? sectionAssets : sectionAssets.filter((asset) =>
        projectAssetMatchesQuery(asset, normalizedQuery, jobByAssetId.get(asset.id))
      );
      if (matches.length) next.set(name, matches);
    });
    return next;
  }, [allGroups, jobByAssetId, normalizedQuery, searching]);
  let orderedSections = [...new Set([...sections.map(({ label }) => label), ...allGroups.keys()])]
    .sort((left, right) => left === 'AI History' ? -1 : right === 'AI History' ? 1 : left.localeCompare(right));
  const visibleAssetIds = new Set(assets.map(({ id }) => id));
  const allPendingJobs = jobs.filter((job) => !['failed', 'cancelled'].includes(job.status)
    && (!job.results.length || job.results.every(({ assetId }) => !visibleAssetIds.has(assetId))));
  const pendingJobs = searching
    ? allPendingJobs.filter((job) => generationJobMatchesQuery(job, normalizedQuery))
    : allPendingJobs;
  if ((allPendingJobs.length || jobs.some((job) => job.results.length)) && !orderedSections.includes('AI History')) {
    orderedSections.unshift('AI History');
  }
  if (searching) orderedSections = orderedSections.filter((name) => groups.has(name)
    || (name === 'AI History' && pendingJobs.length > 0));

  const run = async (action: () => Promise<unknown> | void) => {
    setActionError(undefined);
    try { await action(); } catch (reason) { setActionError(reason instanceof Error ? reason.message : String(reason)); }
  };
  const context = (event: React.MouseEvent, asset: GenAiAssetReference) => {
    event.preventDefault(); setMenu({ x: event.clientX, y: event.clientY, asset, job: jobByAssetId.get(asset.id) });
  };
  const menuOptions: Array<ContextMenuOption<string>> = menu ? [
    { value: 'open', label: 'Open', disabled: !menu.asset || (!onOpenAsset && !onOpenResult), onClick: () => {
      if (menu.job && onOpenResult) onOpenResult(menu.job); else if (menu.asset) onOpenAsset?.(menu.asset);
    } },
    { value: 'reveal', label: 'Open file location', disabled: !menu.asset || !onRevealAsset,
      onClick: () => { if (menu.asset) void run(() => onRevealAsset!(menu.asset!)); } },
    { value: 'reference', label: 'Add as reference', disabled: !menu.asset || !onAddReference,
      onClick: () => { if (menu.asset) onAddReference?.(menu.asset); } },
    ...(menu.job ? [{ value: 'recreate', label: 'Recreate', disabled: !onRecreate,
      onClick: () => onRecreate?.(menu.job!) }] : []),
    { value: 'rename', label: 'Rename…', separatorBefore: true, disabled: !menu.asset || !onRenameAsset,
      onClick: () => setRenameAsset(menu.asset) },
    { value: 'delete', label: 'Delete…', disabled: (!menu.asset && !menu.job) || (!onDeleteAsset && !onDeleteJob),
      onClick: () => setDeleteTarget({ asset: menu.asset, job: menu.job }) }
  ] : [];

  return <aside className="lighttable-panel" aria-label="Project assets">
    <header className="project-asset-browser__header">
      <SearchField ref={searchInput} aria-label="Search project assets" placeholder="Search assets"
        value={searchQuery} onChange={(event) => setSearchQuery(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return;
          event.stopPropagation();
          if (searchQuery) setSearchQuery(''); else event.currentTarget.blur();
        }} onClear={() => {
          setSearchQuery('');
          requestAnimationFrame(() => searchInput.current?.focus());
        }} />
    </header>
    <div className="lighttable-panel__controls genai-history">
      {error || actionError ? <div className="lighttable-panel__error">{actionError ?? error}</div> : null}
      {loading && !assets.length ? <div className="lighttable-panel__empty">Loading project assets…</div> : null}
      {orderedSections.map((name) => {
        const expanded = searching || openSections.has(name);
        const sectionAssets = groups.get(name) ?? [];
        const displayedAssets = name === 'AI History' ? [...sectionAssets].sort((left, right) => {
          const leftJob = jobByAssetId.get(left.id); const rightJob = jobByAssetId.get(right.id);
          const leftTime = leftJob?.updatedAt ?? (Date.parse(left.modifiedAt ?? '') || 0);
          const rightTime = rightJob?.updatedAt ?? (Date.parse(right.modifiedAt ?? '') || 0);
          return rightTime - leftTime || left.label.localeCompare(right.label);
        }) : sectionAssets;
        return <PanelSection key={name} label={name} expanded={expanded} actions={onRefreshAssets ? <ButtonBase
          type="button" className="lighttable-group__reset" aria-label={`Rescan ${name}`}
          title="Rescan project folders" onClick={() => void run(onRefreshAssets)}>
          <img src={lightTableIcon('settings_reset.png')} alt="" aria-hidden="true" />
        </ButtonBase> : undefined} onExpandedChange={(nextExpanded) => setOpenSections((current) => {
          if (searching) return current;
          const next = new Set(current); if (nextExpanded) next.add(name); else next.delete(name); return next;
        })}>
          {displayedAssets.length || (name === 'AI History' && pendingJobs.length)
            ? <AssetGallery assets={displayedAssets} pendingJobs={name === 'AI History' ? pendingJobs : []}
              previews={previews} onRequestPreview={onRequestPreview} onOpen={onOpenAsset} onContextMenu={context}
              onJobContextMenu={(event, job) => {
                event.preventDefault(); setMenu({ x: event.clientX, y: event.clientY, job });
              }} />
            : <p className="lighttable-panel__empty">No images in this folder.</p>}
        </PanelSection>;
      })}
      {!orderedSections.length && !loading ? <div className="lighttable-panel__empty">
        {searching ? `No assets match “${searchQuery.trim()}”.` : 'Project images will appear here.'}
      </div> : null}
    </div>
    <ContextMenu open={Boolean(menu)} x={menu?.x ?? 0} y={menu?.y ?? 0} onClose={() => setMenu(undefined)} options={menuOptions} />
    <TextInputDialog open={Boolean(renameAsset)} compact title="Rename file" initialValue={renameAsset ? withoutExtension(renameAsset.label) : ''}
      selectAllOnOpen onCancel={() => setRenameAsset(undefined)} onConfirm={async (name) => {
        if (!renameAsset || !onRenameAsset) return;
        await run(() => onRenameAsset(renameAsset, name)); setRenameAsset(undefined);
      }} />
    <ConfirmDialog open={Boolean(deleteTarget)} title="Delete file?" danger confirmLabel="Delete" onCancel={() => setDeleteTarget(undefined)}
      description={deleteTarget?.asset
        ? `“${deleteTarget.asset.label}” will be moved to the system Trash. This cannot be undone in LightTable.`
        : 'Remove this unfinished generation from history?'} onConfirm={async () => {
          if (!deleteTarget) return;
          await run(() => deleteTarget.asset && onDeleteAsset
            ? onDeleteAsset(deleteTarget.asset)
            : deleteTarget.job && onDeleteJob ? onDeleteJob(deleteTarget.job) : undefined);
          setDeleteTarget(undefined);
        }} />
  </aside>;
};
