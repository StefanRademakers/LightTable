import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ActionButton } from '../../../ui/ActionButton';
import { useDialogAccessibility } from '../../../ui/useDialogAccessibility';
import type {
  LightTableReleaseInfo,
  LightTableReleaseService,
  LightTableUpdateResult
} from '../../../platform/LightTableHost';

export const AboutUpdateDialog: React.FC<{
  readonly open: boolean;
  readonly release?: LightTableReleaseService;
  readonly dirtyDocuments: boolean;
  readonly onClose: () => void;
}> = ({ open, release, dirtyDocuments, onClose }) => {
  const { dialogRef, onDialogKeyDown } = useDialogAccessibility<HTMLElement>(open, onClose);
  const [info, setInfo] = useState<LightTableReleaseInfo | null>(null);
  const [update, setUpdate] = useState<LightTableUpdateResult | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (!open || !release) return;
    let canceled = false;
    void release.info().then((value) => { if (!canceled) setInfo(value); });
    return () => { canceled = true; };
  }, [open, release]);

  if (!open) return null;
  const downloaded = update?.status === 'downloaded' ? update : null;
  return createPortal(
    <div className="modal-backdrop lighttable-dialog-backdrop" onMouseDown={onClose}>
      <section
        ref={dialogRef}
        className="modal lighttable-about"
        role="dialog"
        aria-modal="true"
        aria-label="About LightTable"
        tabIndex={-1}
        data-editor-native-tab-navigation
        onKeyDown={onDialogKeyDown}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="modal__header lighttable-about__header">
          <div><h2 className="modal__title">LightTable</h2><p>Desktop release and update status</p></div>
        </header>
        <div className="lighttable-about__body">
          <dl>
            <div><dt>Version</dt><dd>{info?.version ?? 'Loading…'}</dd></div>
            <div><dt>Channel</dt><dd>{info?.channel ?? '—'}</dd></div>
            <div><dt>Build</dt><dd>{info?.build ?? '—'}</dd></div>
            <div><dt>Signature</dt><dd>{info?.signed ? 'Signed production build' : 'Unsigned local/test build'}</dd></div>
          </dl>
          {update ? (
            <div className="lighttable-about__update" role="status">
              {update.status === 'downloaded' ? (
                <><strong>Version {update.version} downloaded and verified.</strong><p>{update.releaseNotes}</p></>
              ) : update.status === 'current' ? <p>LightTable is up to date.</p>
                : update.status === 'older' ? <p>The signed feed contains an older build.</p>
                  : update.status === 'channel-blocked' ? <p>No update is available for this channel.</p>
                    : <p>{'message' in update ? update.message : 'No update is available.'}</p>}
            </div>
          ) : null}
          {!release ? <p className="muted">Updates are unavailable in this host.</p> : null}
          {downloaded && !downloaded.canInstall ? (
            <p className="muted">The update was verified, but this build has no production installer provider.</p>
          ) : null}
        </div>
        <footer className="modal__footer lighttable-about__footer">
          <div className="lighttable-about__actions">
            <ActionButton
              disabled={checking || !release}
              onClick={() => {
                if (!release) return;
                setChecking(true);
                void release.checkForUpdates().then(setUpdate).finally(() => setChecking(false));
              }}
            >{checking ? 'Checking…' : 'Check for updates'}</ActionButton>
            {downloaded ? (
              <ActionButton
                disabled={!downloaded.canInstall || dirtyDocuments}
                title={dirtyDocuments ? 'Save or close dirty documents before restarting.' : undefined}
                onClick={() => void release?.restartToInstall({ dirtyDocuments })}
              >Restart to update</ActionButton>
            ) : null}
          </div>
          <ActionButton onClick={onClose}>Close</ActionButton>
        </footer>
      </section>
    </div>,
    document.body
  );
};
