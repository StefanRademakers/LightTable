import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { LightTableHost } from '../platform/LightTableHost';
import { ActionButton } from '../ui/ActionButton';
import { SwitchControl } from '../ui/SwitchControl';
import { useDialogAccessibility } from '../ui/useDialogAccessibility';
import { AgentAccessSettingsPanel } from './AgentAccessSettingsDialog';
import type { ApplicationPreferences } from './applicationPreferences';
import type { LightTableRecoveryLocation } from '../platform/LightTableRecoveryStore';

type PreferencesPage = 'file-handling' | 'agent-access';

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

  useEffect(() => {
    if (!open) return;
    setDraft(preferences);
    setPage('file-handling');
    setSaveError(null);
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
          setLocationBusy(true);
          setSaveError(null);
          void (location && host.recoveryLocation
            ? host.recoveryLocation.apply(location)
            : Promise.resolve(location)
          ).then(() => onSave(draft)).catch((reason) => {
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
