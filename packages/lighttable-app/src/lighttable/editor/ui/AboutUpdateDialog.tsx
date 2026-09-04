import { Button, Dialog } from '@lighttable/ui';
import React, { useEffect, useRef, useState } from 'react';
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
  const [info, setInfo] = useState<LightTableReleaseInfo | null>(null);
  const [update, setUpdate] = useState<LightTableUpdateResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const operationRef = useRef(0);

  useEffect(() => () => {
    operationRef.current += 1;
  }, []);

  useEffect(() => {
    const operation = ++operationRef.current;
    if (!open || !release) return;
    let canceled = false;
    setChecking(false);
    setError(null);
    void release.info().then((value) => {
      if (!canceled && operationRef.current === operation) setInfo(value);
    }).catch((reason) => {
      if (!canceled && operationRef.current === operation) {
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    });
    return () => { canceled = true; };
  }, [open, release]);

  const downloaded = update?.status === 'downloaded' ? update : null;
  return (
    <Dialog open={open} title="About LightTable" size="wide" onDismiss={onClose}
      footer={<>
        <Button tabIndex={0}
          disabled={checking || !release}
          onClick={() => {
            if (!release) return;
            const operation = ++operationRef.current;
            setChecking(true);
            setError(null);
            void release.checkForUpdates().then((result) => {
              if (operationRef.current === operation) setUpdate(result);
            }).catch((reason) => {
              if (operationRef.current === operation) {
                setError(reason instanceof Error ? reason.message : String(reason));
              }
            }).finally(() => {
              if (operationRef.current === operation) setChecking(false);
            });
          }}
        >{checking ? 'Checking…' : 'Check for updates'}</Button>
        {downloaded ? (
          <Button tabIndex={0}
            disabled={!downloaded.canInstall || dirtyDocuments}
            title={dirtyDocuments ? 'Save or close dirty documents before restarting.' : undefined}
            onClick={() => void release?.restartToInstall({ dirtyDocuments })}
          >Restart to update</Button>
        ) : null}
        <Button tabIndex={0} onClick={onClose}>Close</Button>
      </>}>
      <div className="lighttable-about__content">
        <div className="lighttable-about__body">
          <section className="lighttable-about__section" aria-labelledby="lighttable-about-release">
            <div className="lighttable-about__section-heading">
              <h3 id="lighttable-about-release">LightTable</h3>
              <p>Desktop image editor</p>
            </div>
            <dl>
              <div><dt>Version</dt><dd>{info?.version ?? 'Loading…'}</dd></div>
              <div><dt>Channel</dt><dd>{info?.channel ?? '—'}</dd></div>
              <div><dt>Build</dt><dd>{info?.build ?? '—'}</dd></div>
              <div><dt>Signature</dt><dd>{info?.signed ? 'Signed production build' : 'Unsigned local/test build'}</dd></div>
            </dl>
          </section>
          <section className="lighttable-about__section" aria-labelledby="lighttable-about-publisher">
            <h3 id="lighttable-about-publisher">Publisher</h3>
            <dl>
              <div><dt>Author</dt><dd>Stefan Rademakers</dd></div>
              <div><dt>Copyright</dt><dd>Mediavibe Holding B.V.</dd></div>
            </dl>
          </section>
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
          {error ? <p className="lighttable-file-drop__error" role="alert">{error}</p> : null}
          {downloaded && !downloaded.canInstall ? (
            <p className="muted">The update was verified, but this build has no production installer provider.</p>
          ) : null}
        </div>
      </div>
    </Dialog>
  );
};
