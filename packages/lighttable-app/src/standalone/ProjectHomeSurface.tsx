import { Button } from '@lighttable/ui';
import React from 'react';
import type {
  GenAiAssetId,
  GenAiAssetReference,
  GenAiGenerationJob,
  GenAiProjectAssetCatalog
} from '@lighttable/genai-core';

import { EditorMenuBar } from '../lighttable/editor/ui/EditorMenuBar';
import type { EditorMenuId } from '../lighttable/editor/menus/createEditorMenuOptions';
import type { MenuOption } from '@lighttable/ui';
import { ProjectAssetBrowser } from '../genai/ui/ProjectAssetBrowser';
import type {
  LightTableGenAiService,
  LightTableProjectSummary
} from '../platform/LightTableHost';
import { lightTableIcon } from '../assets/icons';
import { workspaceSurfaceCan, type WorkspaceSurface } from './workspaceSurface';

interface ProjectHomeSurfaceProps {
  readonly project: LightTableProjectSummary;
  readonly service?: LightTableGenAiService;
  readonly surface: WorkspaceSurface;
  readonly importing: boolean;
  readonly error: string | null;
  readonly onBrowse: () => void;
  readonly onNewDocument: () => void;
  readonly onOpenFile: () => void;
  readonly onOpenAsset: (asset: GenAiAssetReference) => void;
  readonly onImportFiles: (files: readonly File[]) => void;
  readonly onCloseProject: () => void;
  readonly onRevealProject: () => void;
}

const emptyCatalog: GenAiProjectAssetCatalog = { sections: [], assets: [] };

export const ProjectHomeSurface = ({
  project,
  service,
  surface,
  importing,
  error,
  onBrowse,
  onNewDocument,
  onOpenFile,
  onOpenAsset,
  onImportFiles,
  onCloseProject,
  onRevealProject
}: ProjectHomeSurfaceProps) => {
  const [catalog, setCatalog] = React.useState<GenAiProjectAssetCatalog>(emptyCatalog);
  const [jobs, setJobs] = React.useState<readonly GenAiGenerationJob[]>([]);
  const [previews, setPreviews] = React.useState<Record<string, string>>({});
  const [loading, setLoading] = React.useState(Boolean(service));
  const [catalogError, setCatalogError] = React.useState<string>();
  const generation = React.useRef(0);
  const fileInput = React.useRef<HTMLInputElement>(null);

  const refresh = React.useCallback(async () => {
    if (!service) return;
    const current = ++generation.current;
    setLoading(true);
    try {
      const [nextCatalog, nextJobs] = await Promise.all([
        service.loadProjectAssetCatalog(project.id),
        service.listJobs(project.id)
      ]);
      if (current !== generation.current) return;
      setCatalog(nextCatalog);
      setJobs(nextJobs);
      setCatalogError(undefined);
    } catch (reason) {
      if (current === generation.current) {
        setCatalogError(reason instanceof Error ? reason.message : String(reason));
      }
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, [project.id, service]);

  React.useEffect(() => {
    void refresh();
    const unsubscribe = service?.subscribeProjectAssets(project.id, () => void refresh());
    return () => {
      generation.current += 1;
      unsubscribe?.();
    };
  }, [project.id, refresh, service]);

  const requestPreview = React.useCallback((assetId: GenAiAssetId) => {
    if (!service || previews[assetId]) return;
    void service.loadProjectAssetPreview(project.id, assetId).then((preview) => {
      if (preview) setPreviews((current) => current[assetId]
        ? current
        : { ...current, [assetId]: preview });
    }).catch(() => undefined);
  }, [previews, project.id, service]);

  const optionsFor = React.useCallback((id: EditorMenuId): Array<MenuOption<string>> => {
    if (id !== 'file') return [];
    return [
      { value: 'open', label: 'Open...', onClick: onOpenFile },
      { value: 'import', label: 'Import to Project...', onClick: onBrowse },
      { value: 'new-document', label: 'New Document...', onClick: onNewDocument },
      { value: 'close-project', label: `Close Project (${project.name})`, separatorBefore: true, onClick: onCloseProject }
    ];
  }, [onBrowse, onCloseProject, onNewDocument, onOpenFile, project.name]);
  const menuEnabled = React.useCallback((id: EditorMenuId) => (
    id === 'file'
  ), []);

  return <main className="lighttable-project-home"
    onDragOver={(event) => {
      if (!event.dataTransfer.types.includes('Files')) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    }}
    onDrop={(event) => {
      if (!event.dataTransfer.types.includes('Files')) return;
      event.preventDefault();
      onImportFiles(Array.from(event.dataTransfer.files));
    }}>
    <input ref={fileInput} type="file" hidden multiple onChange={(event) => {
      const files = Array.from(event.currentTarget.files ?? []);
      event.currentTarget.value = '';
      if (files.length) onImportFiles(files);
    }} />
    <header className="modal__header concept-art-editor__header lighttable__header">
      <div className="lighttable__header-left">
        <EditorMenuBar optionsFor={optionsFor} enabledFor={menuEnabled}
          projectName={project.name} onRevealProject={onRevealProject} />
      </div>
    </header>
    <div className="lighttable-project-home__options" aria-hidden="true" />
    <div className="lighttable-project-home__body">
      <section className="lighttable-project-home__main" aria-labelledby="project-home-title">
        <div className="lighttable-project-home__hero">
          <img src={lightTableIcon('image.png')} alt="" aria-hidden />
          <h1 id="project-home-title">{project.name}</h1>
          <p>Drop media to add to {project.name}<br />or click to browse</p>
          <div className="lighttable-project-home__actions">
            <Button type="button"
              disabled={importing || !workspaceSurfaceCan(surface, 'project-assets')}
              onClick={() => fileInput.current?.click()}>Browse / Import</Button>
            <Button type="button"
              onClick={onNewDocument}>New Document</Button>
          </div>
          {importing ? <p role="status">Importing media...</p> : null}
          {error ? <p className="lighttable-project-home__warning" role="alert">{error}</p> : null}
        </div>
      </section>
      <aside className="lighttable-project-home__assets" aria-label="Project assets">
        <header><h2>Assets</h2></header>
        <ProjectAssetBrowser
          jobs={jobs}
          assets={catalog.assets}
          sections={catalog.sections}
          loading={loading}
          error={catalogError}
          previews={previews}
          onRequestPreview={requestPreview}
          onOpenAsset={onOpenAsset}
          onRevealAsset={service ? (asset) => service.revealProjectAsset(project.id, asset.id) : undefined}
          onRenameAsset={service ? (asset, name) => service.renameProjectAsset(project.id, asset.id, name) : undefined}
          onDeleteAsset={service ? (asset) => service.deleteProjectAsset(project.id, asset.id) : undefined}
          onRefreshAssets={refresh}
        />
      </aside>
    </div>
    <footer className="lighttable-project-home__status">Project Home</footer>
  </main>;
};
