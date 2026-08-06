import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type {
  LightTableAgentAccessService,
  LightTableAgentAccessStatus,
  LightTableAgentTunnelStatus
} from '../platform/LightTableHost';
import { ActionButton } from '../ui/ActionButton';
import { useDialogAccessibility } from '../ui/useDialogAccessibility';

const unavailable: LightTableAgentAccessStatus = {
  supported: false, enabled: false, state: 'stopped'
};
const tunnelUnavailable: LightTableAgentTunnelStatus = {
  state: 'offline', deviceId: 'unavailable', clients: [], events: []
};

export const AgentAccessSettingsDialog: React.FC<{
  readonly open: boolean;
  readonly service?: LightTableAgentAccessService;
  readonly onClose: () => void;
}> = ({ open, service, onClose }) => {
  const { dialogRef, onDialogKeyDown } = useDialogAccessibility<HTMLElement>(open, onClose);
  const [status, setStatus] = useState<LightTableAgentAccessStatus>(unavailable);
  const [port, setPort] = useState('');
  const [serverUrl, setServerUrl] = useState('');
  const [pairingCode, setPairingCode] = useState('');
  const [tunnel, setTunnel] = useState<LightTableAgentTunnelStatus>(tunnelUnavailable);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !service) return;
    let canceled = false;
    void service.status().then((value) => { if (!canceled) setStatus(value); });
    void service.tunnelStatus().then((value) => {
      if (!canceled) { setTunnel(value); if (value.serverUrl) setServerUrl(value.serverUrl); }
    });
    const unsubscribe = service.subscribe((value) => { if (!canceled) setStatus(value); });
    const unsubscribeTunnel = service.subscribeTunnel((value) => {
      if (!canceled) { setTunnel(value); if (value.serverUrl) setServerUrl(value.serverUrl); }
    });
    return () => { canceled = true; unsubscribe(); unsubscribeTunnel(); };
  }, [open, service]);

  if (!open) return null;
  const run = (operation: () => Promise<LightTableAgentAccessStatus>) => {
    setBusy(true);
    void operation().then(setStatus).finally(() => setBusy(false));
  };
  const runTunnel = (operation: () => Promise<LightTableAgentTunnelStatus>) => {
    setBusy(true); void operation().then(setTunnel).finally(() => setBusy(false));
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
              <div className="lighttable-agent-settings__server">
                <h3>Server connection</h3>
                <p>Connect outbound to your authenticated LightTable MCP server. No public port is opened on this computer.</p>
                <label>Server URL<input type="url" placeholder="https://mcp.example.com" value={serverUrl}
                  disabled={busy || tunnel.state === 'connected'} onChange={(event) => setServerUrl(event.currentTarget.value)} /></label>
                <label>One-time pairing code<input type="text" autoComplete="one-time-code" maxLength={64}
                  value={pairingCode} disabled={busy || tunnel.state === 'connected'}
                  onChange={(event) => setPairingCode(event.currentTarget.value)} /></label>
                <div className="lighttable-agent-settings__actions">
                  <ActionButton disabled={busy || !serverUrl || pairingCode.length < 6 || tunnel.state === 'connected'}
                    onClick={() => {
                      setBusy(true);
                      void service.pairServer(serverUrl, pairingCode).then((value) => {
                        setTunnel(value); if (value.state === 'connected') setPairingCode('');
                      }).finally(() => setBusy(false));
                    }}>Pair</ActionButton>
                  <ActionButton disabled={busy || (tunnel.state !== 'degraded' && tunnel.state !== 'offline') || !tunnel.serverUrl}
                    onClick={() => runTunnel(() => service.reconnectServer())}>Reconnect</ActionButton>
                  <ActionButton disabled={busy || tunnel.state === 'offline'}
                    onClick={() => runTunnel(() => service.disconnectServer())}>Disconnect</ActionButton>
                </div>
                <dl>
                  <div><dt>Connection</dt><dd>{tunnel.state}</dd></div>
                  <div><dt>Server</dt><dd>{tunnel.serverId ?? 'Not paired'}</dd></div>
                  <div><dt>Device</dt><dd>{tunnel.deviceId}</dd></div>
                  <div><dt>Activity</dt><dd>{tunnel.lastActivity ? new Date(tunnel.lastActivity).toLocaleString() : 'None'}</dd></div>
                </dl>
                {tunnel.error ? <p className="lighttable-agent-settings__error" role="alert">{tunnel.error}</p> : null}
                {tunnel.clients.length ? <div className="lighttable-agent-settings__clients">
                  <h4>Clients</h4>
                  {tunnel.clients.map((client) => <div key={client.id}>
                    <span><strong>{client.name}</strong><small>{client.approved ? client.scopes.join(' + ') : `Requests ${client.requestedScopes.join(' + ')}`}</small></span>
                    {client.approved
                      ? <ActionButton onClick={() => runTunnel(() => service.revokeClient(client.id))}>Revoke</ActionButton>
                      : <><ActionButton onClick={() => runTunnel(() => service.approveClient(client.id, ['read']))}>Allow read</ActionButton>
                        {client.requestedScopes.includes('edit') ? <ActionButton onClick={() => runTunnel(() => service.approveClient(client.id, ['read', 'edit']))}>Allow edit</ActionButton> : null}</>}
                  </div>)}
                </div> : null}
                {tunnel.activity ? <div className="lighttable-agent-settings__activity" aria-label="Current Agent action">
                  <span><strong>{tunnel.activity.name}</strong><small>{tunnel.activity.status}</small></span>
                  <progress max={1} value={tunnel.activity.progress}>{Math.round(tunnel.activity.progress * 100)}%</progress>
                  {tunnel.activity.results?.length ? <ul className="lighttable-agent-settings__results" aria-label="Agent action results">
                    {tunnel.activity.results.map((result) => <li key={result.id}>
                      <strong>{result.mediaType === 'image/png' ? 'Preview' : 'Export'}</strong>
                      <span>{result.name}</span>
                    </li>)}
                  </ul> : null}
                  <div className="lighttable-agent-settings__actions">
                    <ActionButton disabled={busy || tunnel.activity.status !== 'running' || !tunnel.activity.taskId}
                      onClick={() => runTunnel(() => service.cancelActivity())}>Cancel</ActionButton>
                    <ActionButton disabled={busy || tunnel.activity.status !== 'completed'}
                      onClick={() => runTunnel(() => service.undoActivity())}>Undo Agent Action</ActionButton>
                  </div>
                </div> : null}
                {tunnel.events.length ? <div className="lighttable-agent-settings__events" aria-label="Recent Agent Access activity">
                  {tunnel.events.slice(-5).map((event) => <p key={event.id}><time>{new Date(event.at).toLocaleTimeString()}</time>{event.detail}</p>)}
                </div> : null}
                <ActionButton disabled={busy || !tunnel.serverUrl} onClick={() => runTunnel(() => service.revokeDevice())}>Revoke this device</ActionButton>
              </div>
            </>
          )}
        </div>
      </section>
    </div>,
    document.body
  );
};
