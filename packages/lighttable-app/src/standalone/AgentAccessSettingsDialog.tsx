import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type {
  LightTableAgentAccessService,
  LightTableAgentAccessStatus
} from '../platform/LightTableHost';
import { ActionButton } from '../ui/ActionButton';
import { useDialogAccessibility } from '../ui/useDialogAccessibility';

const unavailable: LightTableAgentAccessStatus = {
  supported: false, enabled: false, state: 'stopped'
};

export const AgentAccessSettingsDialog: React.FC<{
  readonly open: boolean;
  readonly service?: LightTableAgentAccessService;
  readonly onClose: () => void;
}> = ({ open, service, onClose }) => {
  const { dialogRef, onDialogKeyDown } = useDialogAccessibility<HTMLElement>(open, onClose);
  const [status, setStatus] = useState<LightTableAgentAccessStatus>(unavailable);
  const [port, setPort] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !service) return;
    let canceled = false;
    void service.status().then((value) => { if (!canceled) setStatus(value); });
    const unsubscribe = service.subscribe((value) => { if (!canceled) setStatus(value); });
    return () => { canceled = true; unsubscribe(); };
  }, [open, service]);

  if (!open) return null;
  const run = (operation: () => Promise<LightTableAgentAccessStatus>) => {
    setBusy(true);
    void operation().then(setStatus).finally(() => setBusy(false));
  };
  return createPortal(
    <div className="lighttable-psd-report__backdrop" onMouseDown={onClose}>
      <section ref={dialogRef} className="lighttable-psd-report lighttable-agent-settings"
        role="dialog" aria-modal="true" aria-label="Settings" tabIndex={-1}
        data-editor-native-tab-navigation onKeyDown={onDialogKeyDown}
        onMouseDown={(event) => event.stopPropagation()}>
        <header className="lighttable-psd-report__header">
          <div><h2>Settings</h2><p>Agent Access</p></div>
          <ActionButton onClick={onClose}>Close</ActionButton>
        </header>
        <div className="lighttable-agent-settings__body">
          <h3>Local Agent Access</h3>
          <p>Allow an authenticated agent on this computer to use LightTable's real commands. Access is off by default and binds only to 127.0.0.1.</p>
          {!service ? <p role="status">Agent Access is available in the desktop app only.</p> : (
            <>
              <label className="lighttable-agent-settings__toggle">
                <input type="checkbox" checked={status.enabled} disabled={busy}
                  onChange={(event) => event.currentTarget.checked
                    ? run(() => service.enable(port ? { port: Number(port) } : undefined))
                    : run(() => service.disable())} />
                <span>{status.enabled ? 'Enabled on this device' : 'Enable Agent Access'}</span>
              </label>
              <label className="lighttable-agent-settings__port">Preferred local port
                <input type="number" min="1024" max="65535" placeholder="Automatic"
                  value={port} disabled={status.enabled || busy}
                  onChange={(event) => setPort(event.currentTarget.value)} />
              </label>
              <dl>
                <div><dt>Status</dt><dd>{status.state}</dd></div>
                <div><dt>Address</dt><dd>{status.address ?? 'Not listening'}</dd></div>
                <div><dt>Device</dt><dd>{status.deviceId ?? 'Created when enabled'}</dd></div>
              </dl>
              {status.token ? (
                <label className="lighttable-agent-settings__token">Connection token
                  <input readOnly value={status.token} onFocus={(event) => event.currentTarget.select()} />
                </label>
              ) : null}
              {status.error ? <p className="lighttable-agent-settings__error" role="alert">{status.error}</p> : null}
              <div className="lighttable-agent-settings__actions">
                <ActionButton disabled={busy} onClick={() => run(() => service.rotateCredentials())}>Rotate credentials</ActionButton>
                <ActionButton disabled={busy || !status.enabled} onClick={() => run(() => service.disable())}>Stop</ActionButton>
              </div>
              <p className="lighttable-agent-settings__note">Rotating credentials immediately invalidates the previous token. Stopping closes every local connection without closing documents.</p>
            </>
          )}
        </div>
      </section>
    </div>,
    document.body
  );
};
