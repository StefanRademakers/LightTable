import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { LightTableHost } from '../platform/LightTableHost';
import { ActionButton } from '../ui/ActionButton';
import { FormInput } from '../ui/FormInput';
import { SwitchControl } from '../ui/SwitchControl';
import { useDialogAccessibility } from '../ui/useDialogAccessibility';
import { AgentAccessSettingsPanel } from './AgentAccessSettingsDialog';
import {
  normalizeProjectPreferenceFolders,
  type ApplicationPreferences
} from './applicationPreferences';
import type { LightTableRecoveryLocation } from '../platform/LightTableRecoveryStore';
import {
  DEFAULT_PROJECT_FOLDER_MAPPINGS,
  normalizeProjectUserFolders,
  type ProjectUserFolder,
  type ProjectStorageLocation
} from '../lighttable/application/projects/projectManifest';

type PreferencesPage = 'file-handling' | 'projects' | 'tools' | 'agent-access';

const PROJECT_FOLDER_FIELDS: readonly {
  readonly location: ProjectStorageLocation;
  readonly label: string;
}[] = [
  { location: 'characters', label: 'Characters' },
  { location: 'props', label: 'Props' },
  { location: 'environments', label: 'Environments' },
  { location: 'sets', label: 'Sets' }
];

export interface PreferencesDialogProps {
  readonly open: boolean;
  readonly host: LightTableHost;
  readonly preferences: ApplicationPreferences;
  readonly onCancel: () => void;
  readonly onSave: (preferences: ApplicationPreferences) => void;
}

const intervalLabel = (intervalMs: number) => intervalMs < 60_000
  ? `${intervalMs / 1_000} seconds`
  : `${intervalMs / 60_000} minute${intervalMs === 60_000 ? '' : 's'}`;

export const PreferencesDialog: React.FC<PreferencesDialogProps> = ({
  open,
  host,
  preferences,
  onCancel,
  onSave
}) => {
  const { dialogRef, onDialogKeyDown } = useDialogAccessibility<HTMLFormElement>(open, onCancel);
  const [page, setPage] = useState<PreferencesPage>('file-handling');
  const [draft, setDraft] = useState(preferences);
  const [location, setLocation] = useState<LightTableRecoveryLocation | null>(null);
  const [locationBusy, setLocationBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [newProjectFolderName, setNewProjectFolderName] = useState('');
  const [newProjectFolderPath, setNewProjectFolderPath] = useState('');
  const updateUserFolders = (userFolders: readonly ProjectUserFolder[]) => setDraft({
    ...draft,
    projects: { ...draft.projects, userFolders }
  });

  useEffect(() => {
    if (!open) return;
    setDraft(preferences);
    setPage('file-handling');
    setSaveError(null);
    setNewProjectFolderName('');
    setNewProjectFolderPath('');
    let active = true;
    void host.recoveryLocation?.current().then((value) => { if (active) setLocation(value); });
    return () => { active = false; };
  }, [host.recoveryLocation, open, preferences]);

  if (!open) return null;
  const storageLabel = location?.label ?? (host.kind === 'electron'
    ? 'LightTable application data · recovery-v1'
    : 'Private browser storage (OPFS)');

  return createPortal(
    <div className="modal-backdrop lighttable-dialog-backdrop" onMouseDown={onCancel}>
      <form
        ref={dialogRef}
        className="modal lighttable-preferences"
        role="dialog"
        aria-modal="true"
        aria-label="Preferences"
        tabIndex={-1}
        data-editor-native-tab-navigation
        onKeyDown={onDialogKeyDown}
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          if (locationBusy) return;
          const folders = normalizeProjectPreferenceFolders(draft.projects.folders);
          const userFolders = normalizeProjectUserFolders(draft.projects.userFolders);
          if (!folders || !userFolders) {
            setPage('projects');
            setSaveError('Project folders must be relative paths inside the project and cannot contain . or .. segments.');
            return;
          }
          setLocationBusy(true);
          setSaveError(null);
          void (location && host.recoveryLocation
            ? host.recoveryLocation.apply(location)
            : Promise.resolve(location)
          ).then(() => onSave({ ...draft, projects: { folders, userFolders } })).catch((reason) => {
            setSaveError(reason instanceof Error ? reason.message : String(reason));
          }).finally(() => setLocationBusy(false));
        }}
      >
        <div className="modal__header lighttable-preferences__header">
          <h3 className="modal__title">Preferences</h3>
        </div>
        <div className="lighttable-preferences__layout">
          <nav className="lighttable-preferences__navigation" aria-label="Preference categories">
            <button type="button" className={page === 'file-handling' ? 'is-active' : undefined}
              aria-current={page === 'file-handling' ? 'page' : undefined}
              onClick={() => setPage('file-handling')}>File Handling</button>
            <button type="button" className={page === 'projects' ? 'is-active' : undefined}
              aria-current={page === 'projects' ? 'page' : undefined}
              onClick={() => setPage('projects')}>Projects</button>
            <button type="button" className={page === 'tools' ? 'is-active' : undefined}
              aria-current={page === 'tools' ? 'page' : undefined}
              onClick={() => setPage('tools')}>Tools</button>
            <button type="button" className={page === 'agent-access' ? 'is-active' : undefined}
              aria-current={page === 'agent-access' ? 'page' : undefined}
              onClick={() => setPage('agent-access')}>Agent Access</button>
          </nav>
          <div className="lighttable-preferences__content">
            {page === 'file-handling' ? (
              <section aria-labelledby="preferences-autosave-heading">
                <div className="lighttable-preferences__section-heading">
                  <div>
                    <h4 id="preferences-autosave-heading">Autosave &amp; recovery</h4>
                    <p>Keep a private recovery copy while a document has unsaved changes.</p>
                  </div>
                  <SwitchControl checked={draft.autosave.enabled}
                    label="Enable autosave and crash recovery"
                    onCheckedChange={(enabled) => setDraft({ ...draft, autosave: {
                      ...draft.autosave, enabled
                    } })} />
                </div>
                <div className="lighttable-preferences__fields" aria-disabled={!draft.autosave.enabled}>
                  <label>
                    <span>Save recovery copy</span>
                    <select className="form-input" disabled={!draft.autosave.enabled}
                      value={draft.autosave.intervalMs}
                      onChange={(event) => setDraft({ ...draft, autosave: {
                        ...draft.autosave, intervalMs: Number(event.currentTarget.value)
                      } })}>
                      {[30_000, 60_000, 120_000, 300_000, 600_000].map((value) => (
                        <option key={value} value={value}>Every {intervalLabel(value)}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Location</span>
                    <div className="lighttable-preferences__location-row">
                      <div className="lighttable-preferences__location" title={location?.path ?? storageLabel}
                        aria-label={`Autosave location: ${storageLabel}`}>{storageLabel}</div>
                      {location?.canChoose ? (
                        <ActionButton disabled={locationBusy} onClick={() => {
                          setLocationBusy(true);
                          void host.recoveryLocation?.choose().then((value) => {
                            if (value) setLocation(value);
                          }).finally(() => setLocationBusy(false));
                        }}>Choose…</ActionButton>
                      ) : null}
                      {location?.custom ? (
                        <ActionButton disabled={locationBusy} onClick={() => {
                          setLocationBusy(true);
                          void host.recoveryLocation?.reset().then(setLocation)
                            .finally(() => setLocationBusy(false));
                        }}>Reset</ActionButton>
                      ) : null}
                    </div>
                  </label>
                </div>
                <p className="lighttable-preferences__note">
                  Recovery copies are removed after a successful save. Turning autosave off or changing its location does not delete existing recovery copies.
                </p>
                {saveError ? <p className="lighttable-preferences__error" role="alert">{saveError}</p> : null}
              </section>
            ) : page === 'projects' ? (
              <section aria-labelledby="preferences-projects-heading">
                <div className="lighttable-preferences__section-heading">
                  <div>
                    <h4 id="preferences-projects-heading">Project folders</h4>
                    <p>Choose the folder layout used when LightTable creates a new project.</p>
                  </div>
                  <ActionButton type="button" onClick={() => setDraft({
                    ...draft,
                    projects: { folders: DEFAULT_PROJECT_FOLDER_MAPPINGS, userFolders: [] }
                  })}>Reset defaults</ActionButton>
                </div>
                <div className="lighttable-preferences__project-table" aria-label="Project folder mappings">
                  <div className="lighttable-preferences__project-table-heading" aria-hidden="true">
                    <span>Folder name</span>
                    <span>Relative path</span>
                    <span />
                  </div>
                  {PROJECT_FOLDER_FIELDS.map(({ location: folder, label }) => (
                    <div className="lighttable-preferences__project-folder" key={folder}>
                      <div className="lighttable-preferences__project-folder-name">{label}</div>
                      <FormInput value={draft.projects.folders[folder]}
                        aria-label={`${label} project folder`}
                        onChange={(event) => setDraft({
                          ...draft,
                          projects: {
                            ...draft.projects,
                            folders: {
                              ...draft.projects.folders,
                              [folder]: event.currentTarget.value
                            }
                          }
                        })} />
                      <span className="lighttable-preferences__project-folder-kind">Standard</span>
                    </div>
                  ))}
                  {draft.projects.userFolders.map((folder, index) => (
                    <div className="lighttable-preferences__project-folder" key={`custom-${index}`}>
                      <FormInput value={folder.name} aria-label={`Additional folder ${index + 1} name`}
                        onChange={(event) => updateUserFolders(draft.projects.userFolders.map((entry, entryIndex) => (
                          entryIndex === index ? { ...entry, name: event.currentTarget.value } : entry
                        )))} />
                      <FormInput value={folder.path} aria-label={`Additional folder ${index + 1} path`}
                        onChange={(event) => updateUserFolders(draft.projects.userFolders.map((entry, entryIndex) => (
                          entryIndex === index ? { ...entry, path: event.currentTarget.value } : entry
                        )))} />
                      <div className="lighttable-preferences__project-folder-actions">
                        <ActionButton size="compact" type="button" disabled={index === 0}
                          aria-label={`Move ${folder.name} up`} title="Move up" onClick={() => {
                            const next = [...draft.projects.userFolders];
                            [next[index - 1], next[index]] = [next[index], next[index - 1]];
                            updateUserFolders(next);
                          }}>Up</ActionButton>
                        <ActionButton size="compact" type="button"
                          disabled={index === draft.projects.userFolders.length - 1}
                          aria-label={`Move ${folder.name} down`} title="Move down" onClick={() => {
                            const next = [...draft.projects.userFolders];
                            [next[index], next[index + 1]] = [next[index + 1], next[index]];
                            updateUserFolders(next);
                          }}>Down</ActionButton>
                        <ActionButton size="compact" type="button" aria-label={`Remove ${folder.name}`}
                          onClick={() => updateUserFolders(draft.projects.userFolders.filter((_, entryIndex) => entryIndex !== index))}>Remove</ActionButton>
                      </div>
                    </div>
                  ))}
                  <div className="lighttable-preferences__project-folder-add">
                    <FormInput value={newProjectFolderName} placeholder="New folder name"
                      aria-label="New project folder name"
                      onChange={(event) => setNewProjectFolderName(event.currentTarget.value)} />
                    <FormInput value={newProjectFolderPath} placeholder="Relative path (e.g. References/Style)"
                      aria-label="New project folder relative path"
                      onChange={(event) => setNewProjectFolderPath(event.currentTarget.value)} />
                    <ActionButton type="button" disabled={!newProjectFolderName.trim() || !newProjectFolderPath.trim()}
                      onClick={() => {
                        updateUserFolders([...draft.projects.userFolders, {
                          name: newProjectFolderName.trim(), path: newProjectFolderPath.trim()
                        }]);
                        setNewProjectFolderName('');
                        setNewProjectFolderPath('');
                      }}>Add folder</ActionButton>
                  </div>
                </div>
                <p className="lighttable-preferences__note">
                  Paths are relative to the project folder. These defaults only affect new projects; existing projects keep their own mappings. AI renders, input, history and Trash remain stable, visible folders on disk; cache, thumbnails, indexes and temporary data stay internal under .lighttable.
                </p>
                {saveError ? <p className="lighttable-preferences__error" role="alert">{saveError}</p> : null}
              </section>
            ) : page === 'tools' ? (
              <section aria-labelledby="preferences-tools-heading">
                <h4 id="preferences-tools-heading" className="lighttable-preferences__page-title">Tools</h4>
                <div className="lighttable-preferences__option-list">
                  <div className="lighttable-preferences__option">
                    <div>
                      <strong>Zoom with scroll wheel</strong>
                      <p>Use the mouse wheel to zoom around the pointer. When off, the wheel pans the canvas.</p>
                    </div>
                    <SwitchControl checked={draft.tools.zoomWithScrollWheel}
                      label="Zoom with scroll wheel"
                      onCheckedChange={(zoomWithScrollWheel) => setDraft({ ...draft, tools: {
                        ...draft.tools, zoomWithScrollWheel
                      } })} />
                  </div>
                  <div className="lighttable-preferences__option">
                    <div>
                      <strong>Open mask editing on double-click</strong>
                      <p>Double-click a layer-mask thumbnail to make it active and show the mask for direct editing.</p>
                    </div>
                    <SwitchControl checked={draft.tools.openMaskEditingOnDoubleClick}
                      label="Open mask editing on double-click"
                      onCheckedChange={(openMaskEditingOnDoubleClick) => setDraft({ ...draft, tools: {
                        ...draft.tools, openMaskEditingOnDoubleClick
                      } })} />
                  </div>
                </div>
              </section>
            ) : (
              <section aria-labelledby="preferences-agent-heading">
                <h4 id="preferences-agent-heading" className="lighttable-preferences__page-title">Agent Access</h4>
                <AgentAccessSettingsPanel active service={host.agentAccess} />
              </section>
            )}
          </div>
        </div>
        <div className="modal__footer lighttable-preferences__footer">
          <ActionButton disabled={locationBusy} onClick={onCancel}>Cancel</ActionButton>
          <ActionButton disabled={locationBusy} type="submit">{locationBusy ? 'Saving…' : 'Save'}</ActionButton>
        </div>
      </form>
    </div>,
    document.body
  );
};
