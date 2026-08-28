import { ButtonBase } from '../ui/ButtonBase';
import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type {
  LightTableAiProviderConfig,
  LightTableHost,
  LightTableLocalAiModelStatus
} from '../platform/LightTableHost';
import { ActionButton } from '../ui/ActionButton';
import { FormInput } from '../ui/FormInput';
import { FormSelect } from '../ui/FormSelect';
import { SwitchControl } from '../ui/SwitchControl';
import { useDialogAccessibility } from '../ui/useDialogAccessibility';
import { AgentAccessSettingsPanel } from './AgentAccessSettingsDialog';
import {
  BUILT_IN_LOCAL_AI_PROVIDER_ID,
  DEFAULT_LOCAL_AI_PROVIDER,
  normalizeProjectPreferenceFolders,
  type ApplicationPreferences
} from './applicationPreferences';
import type { LightTableRecoveryLocation } from '../platform/LightTableRecoveryStore';
import type { GenAiProviderSnapshot } from '@lighttable/genai-core';
import {
  DEFAULT_PROJECT_FOLDER_MAPPINGS,
  normalizeProjectUserFolders,
  type ProjectUserFolder,
  type ProjectUserStorageLocation
} from '../lighttable/application/projects/projectManifest';

type PreferencesPage = 'file-handling' | 'projects' | 'tools' | 'ai-providers' | 'agent-access';

const PROJECT_FOLDER_FIELDS: readonly {
  readonly location: ProjectUserStorageLocation;
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

const formatModelBytes = (bytes: number) => bytes > 0 ? `${(bytes / 1_000_000_000).toFixed(1)} GB` : '';

const localModelMessage = (status: LightTableLocalAiModelStatus | null) => {
  if (!status) return 'Checking model installation…';
  if (status.error) return status.error;
  if (status.installing) {
    const progress = status.totalBytes > 0 ? Math.round(status.installedBytes / status.totalBytes * 100) : 0;
    return `Installing ${status.currentFile ?? status.displayName} · ${progress}%`;
  }
  if (status.ready) return `Model installed${status.totalBytes > 0 ? ` · ${formatModelBytes(status.totalBytes)}` : ''}`;
  return `Model download required${status.totalBytes > 0 ? ` · ${formatModelBytes(status.totalBytes)}` : ''}`;
};

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
  const [genAiProviders, setGenAiProviders] = useState<readonly GenAiProviderSnapshot[]>([]);
  const [localAiModel, setLocalAiModel] = useState<LightTableLocalAiModelStatus | null>(null);
  const [providerTest, setProviderTest] = useState<{ readonly id: string; readonly busy: boolean; readonly message?: string } | null>(null);
  const updateUserFolders = (userFolders: readonly ProjectUserFolder[]) => setDraft({
    ...draft,
    projects: { ...draft.projects, userFolders }
  });
  const updateProvider = (providerId: string, update: (provider: LightTableAiProviderConfig) => LightTableAiProviderConfig) => {
    setDraft((current) => ({ ...current, genAi: {
      ...current.genAi,
      providers: current.genAi.providers.map((provider) => provider.id === providerId ? update(provider) : provider)
    } }));
  };
  const removeProvider = (providerId: string) => setDraft((current) => ({ ...current, genAi: {
    ...current.genAi,
    createProviderId: current.genAi.createProviderId === providerId ? 'openart' : current.genAi.createProviderId,
    editProviderId: current.genAi.editProviderId === providerId ? 'openart' : current.genAi.editProviderId,
    providers: current.genAi.providers.filter((provider) => provider.id !== providerId)
  } }));
  const configuredProviderOptions = [
    ...genAiProviders.filter(({ id }) => id === 'openart' || id === 'higgsfield'),
    ...draft.genAi.providers.filter(({ enabled }) => enabled).map((provider) => ({
      id: provider.id as GenAiProviderSnapshot['id'],
      label: provider.displayName,
      status: genAiProviders.find(({ id }) => id === provider.id)?.status ?? 'disconnected' as const,
      message: genAiProviders.find(({ id }) => id === provider.id)?.message
    }))
  ];

  useEffect(() => {
    if (!open) return;
    setDraft(preferences);
    setPage('file-handling');
    setSaveError(null);
    setNewProjectFolderName('');
    setProviderTest(null);
    let active = true;
    void host.recoveryLocation?.current().then((value) => { if (active) setLocation(value); });
    void host.genAi?.getProviderSnapshots().then((value) => {
      if (active) setGenAiProviders(value);
    }).catch(() => undefined);
    void host.localAi?.status().then((value) => { if (active) setLocalAiModel(value); }).catch(() => undefined);
    const unsubscribeGenAi = host.genAi?.subscribe((snapshot) => {
      if (!active) return;
      setGenAiProviders((current) => [...current.filter(({ id }) => id !== snapshot.id), snapshot]);
    });
    const unsubscribeLocalAi = host.localAi?.subscribe((status) => { if (active) setLocalAiModel(status); });
    return () => { active = false; unsubscribeGenAi?.(); unsubscribeLocalAi?.(); };
  }, [host.genAi, host.localAi, host.recoveryLocation, open, preferences]);

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
          ).then(() => onSave({ ...draft, projects: {
            folders, createFolders: draft.projects.createFolders, userFolders
          } })).catch((reason) => {
            setSaveError(reason instanceof Error ? reason.message : String(reason));
          }).finally(() => setLocationBusy(false));
        }}
      >
        <div className="modal__header lighttable-preferences__header">
          <h3 className="modal__title">Preferences</h3>
        </div>
        <div className="lighttable-preferences__layout">
          <nav className="lighttable-preferences__navigation" aria-label="Preference categories">
            <ButtonBase type="button" className={page === 'file-handling' ? 'is-active' : undefined}
              aria-current={page === 'file-handling' ? 'page' : undefined}
              onClick={() => setPage('file-handling')}>File Handling</ButtonBase>
            <ButtonBase type="button" className={page === 'projects' ? 'is-active' : undefined}
              aria-current={page === 'projects' ? 'page' : undefined}
              onClick={() => setPage('projects')}>Projects</ButtonBase>
            <ButtonBase type="button" className={page === 'tools' ? 'is-active' : undefined}
              aria-current={page === 'tools' ? 'page' : undefined}
              onClick={() => setPage('tools')}>Tools</ButtonBase>
            <ButtonBase type="button" className={page === 'ai-providers' ? 'is-active' : undefined}
              aria-current={page === 'ai-providers' ? 'page' : undefined}
              onClick={() => setPage('ai-providers')}>AI Providers</ButtonBase>
            <ButtonBase type="button" className={page === 'agent-access' ? 'is-active' : undefined}
              aria-current={page === 'agent-access' ? 'page' : undefined}
              onClick={() => setPage('agent-access')}>Agent Access</ButtonBase>
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
                    <FormSelect disabled={!draft.autosave.enabled}
                      value={draft.autosave.intervalMs}
                      onChange={(event) => setDraft({ ...draft, autosave: {
                        ...draft.autosave, intervalMs: Number(event.currentTarget.value)
                      } })}>
                      {[30_000, 60_000, 120_000, 300_000, 600_000].map((value) => (
                        <option key={value} value={value}>Every {intervalLabel(value)}</option>
                      ))}
                    </FormSelect>
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
                    projects: {
                      folders: DEFAULT_PROJECT_FOLDER_MAPPINGS,
                      createFolders: PROJECT_FOLDER_FIELDS.map(({ location }) => location),
                      userFolders: []
                    }
                  })}>Reset defaults</ActionButton>
                </div>
                <div className="lighttable-preferences__project-table" aria-label="Project folder mappings">
                  {[
                    ...PROJECT_FOLDER_FIELDS
                      .filter(({ location }) => draft.projects.createFolders.includes(location))
                      .map(({ location, label }) => ({ kind: 'standard' as const, location, label })),
                    ...draft.projects.userFolders.map((folder, index) => ({
                      kind: 'custom' as const, folder, index, label: folder.name
                    }))
                  ].sort((left, right) => left.label.localeCompare(right.label, undefined, { sensitivity: 'base' }))
                    .map((entry) => entry.kind === 'standard' ? (
                      <div className="lighttable-preferences__project-folder" key={entry.location}>
                        <div className="lighttable-preferences__project-folder-name">{entry.label}</div>
                        <ButtonBase className="lighttable-preferences__project-folder-remove" type="button"
                          aria-label={`Do not create ${entry.label} in new projects`}
                          title="Do not create this folder in new projects"
                          onClick={() => setDraft({ ...draft, projects: {
                            ...draft.projects,
                            createFolders: draft.projects.createFolders.filter((folder) => folder !== entry.location)
                          } })}>×</ButtonBase>
                      </div>
                    ) : (
                      <div className="lighttable-preferences__project-folder" key={`custom-${entry.index}`}>
                        <div className="lighttable-preferences__project-folder-name">{entry.folder.name}</div>
                        <ButtonBase className="lighttable-preferences__project-folder-remove" type="button"
                          aria-label={`Do not create ${entry.folder.name} in new projects`}
                          title="Do not create this folder in new projects"
                          onClick={() => updateUserFolders(draft.projects.userFolders.filter((_, index) => index !== entry.index))}>×</ButtonBase>
                      </div>
                    ))}
                  <div className="lighttable-preferences__project-folder-add">
                    <FormInput value={newProjectFolderName} placeholder="New folder name"
                      aria-label="New project folder name"
                      onChange={(event) => setNewProjectFolderName(event.currentTarget.value)} />
                    <ActionButton type="button" disabled={!newProjectFolderName.trim()}
                      onClick={() => {
                        const name = newProjectFolderName.trim();
                        updateUserFolders([...draft.projects.userFolders, {
                          name, path: name
                        }]);
                        setNewProjectFolderName('');
                      }}>Add folder</ActionButton>
                  </div>
                </div>
                <p className="lighttable-preferences__note">
                  Paths are relative to the project folder. Removing a row only stops LightTable from creating that folder in new projects; it never deletes folders from disk or changes existing projects. Custom folders already on disk remain discoverable in the asset browser. AI References, AI History and Trash remain system-managed.
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
                  <div className="lighttable-preferences__option">
                    <div>
                      <strong>Preserve local transform axes</strong>
                      <p>Keep a layer's oriented transform frame after confirming. When off, each new transform starts from document-aligned axes.</p>
                    </div>
                    <SwitchControl checked={draft.tools.preserveTransformLocalAxes}
                      label="Preserve local transform axes"
                      onCheckedChange={(preserveTransformLocalAxes) => setDraft({ ...draft, tools: {
                        ...draft.tools, preserveTransformLocalAxes
                      } })} />
                  </div>
                </div>
              </section>
            ) : page === 'ai-providers' ? (
              <section aria-labelledby="preferences-ai-providers-heading">
                <div className="lighttable-preferences__section-heading">
                  <div>
                    <h4 id="preferences-ai-providers-heading">AI providers</h4>
                    <p>Choose which independent provider powers the shared GenAI panel.</p>
                  </div>
                </div>
                <div className="lighttable-preferences__fields">
                  <label>
                    <span>Image Create</span>
                    <FormSelect value={draft.genAi.createProviderId}
                      onChange={(event) => setDraft({ ...draft, genAi: {
                        ...draft.genAi, createProviderId: event.currentTarget.value
                      } })}>
                      {configuredProviderOptions.map((provider) => (
                        <option key={provider.id} value={provider.id}>{provider.label}</option>
                      ))}
                    </FormSelect>
                  </label>
                  <label>
                    <span>Image Edit</span>
                    <FormSelect value={draft.genAi.editProviderId}
                      onChange={(event) => setDraft({ ...draft, genAi: {
                        ...draft.genAi, editProviderId: event.currentTarget.value
                      } })}>
                      {configuredProviderOptions.map((provider) => (
                        <option key={provider.id} value={provider.id}>{provider.label}</option>
                      ))}
                    </FormSelect>
                  </label>
                </div>
                <div className="lighttable-preferences__option-list">
                  {draft.genAi.providers.map((provider) => {
                    const builtIn = provider.id === BUILT_IN_LOCAL_AI_PROVIDER_ID;
                    const test = providerTest?.id === provider.id ? providerTest : null;
                    const runtime = genAiProviders.find(({ id }) => id === provider.id);
                    return <div className="lighttable-preferences__option" key={`config-${provider.id}`}>
                      <div className="lighttable-preferences__fields">
                        <label><span>Name</span><FormInput value={provider.displayName}
                          onChange={(event) => updateProvider(provider.id, (current) => ({
                            ...current, displayName: event.currentTarget.value
                          }))} /></label>
                        <label><span>Base URL</span><FormInput value={provider.transport.baseUrl}
                          onChange={(event) => updateProvider(provider.id, (current) => ({
                            ...current, transport: { ...current.transport, baseUrl: event.currentTarget.value }
                          }))} /></label>
                        <label><span>API token</span><FormInput type="password" autoComplete="off" placeholder="Optional"
                          value={provider.transport.apiToken ?? ''}
                          onChange={(event) => updateProvider(provider.id, (current) => ({
                            ...current, transport: { ...current.transport, apiToken: event.currentTarget.value || undefined }
                          }))} /></label>
                        <div className="lighttable-preferences__location-row">
                          <SwitchControl checked={provider.enabled} label={`Enable ${provider.displayName}`}
                            onCheckedChange={(enabled) => updateProvider(provider.id, (current) => ({ ...current, enabled }))} />
                          <span>Enabled</span>
                          {builtIn ? <><SwitchControl checked={provider.localProcess?.autoStart === true}
                            label="Auto start local service" onCheckedChange={(autoStart) => updateProvider(provider.id,
                              (current) => ({ ...current, localProcess: { autoStart } }))} /><span>Auto start</span></> : null}
                          <SwitchControl checked={provider.transport.allowRemote === true} label="Allow remote endpoint"
                            onCheckedChange={(allowRemote) => updateProvider(provider.id, (current) => ({
                              ...current, transport: { ...current.transport, allowRemote }
                            }))} /><span>Allow remote</span>
                        </div>
                        <div className="lighttable-preferences__location-row">
                          {builtIn && !localAiModel?.ready ? (
                            <ActionButton type="button" disabled={!host.localAi || localAiModel?.installing}
                              onClick={() => void host.localAi?.install()}>
                              {localAiModel?.installing ? 'Installing…' : 'Install model'}
                            </ActionButton>
                          ) : (
                            <ActionButton type="button" disabled={!host.genAi || !provider.enabled
                              || runtime?.status === 'connecting'} onClick={() => void (runtime?.status === 'connected'
                                ? host.genAi!.disconnectProvider(provider.id as GenAiProviderSnapshot['id'])
                                : host.genAi!.connectProvider(provider.id as GenAiProviderSnapshot['id']))}>
                              {runtime?.status === 'connected' ? 'Disconnect'
                                : runtime?.status === 'connecting' ? 'Connecting…' : 'Connect'}
                            </ActionButton>
                          )}
                          <ActionButton type="button" disabled={!host.localAi || test?.busy === true} onClick={() => {
                            setProviderTest({ id: provider.id, busy: true });
                            void host.localAi?.testProvider(provider).then((result) => setProviderTest({
                              id: provider.id, busy: false, message: result.message
                            })).catch((reason) => setProviderTest({ id: provider.id, busy: false,
                              message: reason instanceof Error ? reason.message : String(reason) }));
                          }}>{test?.busy ? 'Testing…' : 'Test'}</ActionButton>
                          <ActionButton type="button" disabled={!host.localAi} onClick={() => void host.localAi
                            ?.configureProviders(draft.genAi.providers)
                            .then(() => host.genAi?.connectProvider(provider.id as GenAiProviderSnapshot['id']))}>Refresh capabilities</ActionButton>
                          <ActionButton type="button" disabled={!host.localAi}
                            onClick={() => void host.localAi?.openProviderHelp(provider)}>Open API help</ActionButton>
                          {!builtIn ? <ActionButton type="button"
                            onClick={() => removeProvider(provider.id)}>Remove</ActionButton> : null}
                        </div>
                        <p>{builtIn ? localModelMessage(localAiModel)
                          : runtime?.message ?? (runtime?.status === 'connected' ? 'Connected' : 'Not connected')}</p>
                        {test?.message ? <p>{test.message}</p> : null}
                      </div>
                    </div>;
                  })}
                  <ActionButton type="button" onClick={() => {
                    const id = `local-http-${Date.now().toString(36)}`;
                    setDraft((current) => ({ ...current, genAi: { ...current.genAi, providers: [
                      ...current.genAi.providers,
                      { ...DEFAULT_LOCAL_AI_PROVIDER, id, displayName: 'Local AI Provider',
                        transport: { ...DEFAULT_LOCAL_AI_PROVIDER.transport }, localProcess: undefined }
                    ] } }));
                  }}>Add provider</ActionButton>
                </div>
                <p className="lighttable-preferences__note">
                  Providers implement LightTable's small HTTP AI protocol. Loopback is the safe default; enable remote access only for a trusted HTTPS endpoint. This integration is independent from OpenArt, Agent Access and LightTable MCP.
                </p>
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
