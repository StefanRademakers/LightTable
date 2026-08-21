import React, { useEffect, useState } from 'react';
import type {
  LightTableAgentAccessService,
  LightTableAgentAccessStatus,
  LightTableAgentClientScope,
  LightTableLocalMcpTestStatus,
  LightTableAgentTunnelStatus
} from '../platform/LightTableHost';
import { ActionButton } from '../ui/ActionButton';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { SwitchControl } from '../ui/SwitchControl';

const unavailable: LightTableAgentAccessStatus = {
  supported: false, enabled: false, state: 'stopped'
};
const tunnelUnavailable: LightTableAgentTunnelStatus = {
  state: 'offline', deviceId: 'unavailable', clients: [], events: []
};
const localMcpUnavailable: LightTableLocalMcpTestStatus = {
  state: 'stopped', restartCodexRequired: false
};

type ConnectionMode = 'local' | 'online';
const activeLocalStates = new Set(['starting', 'running', 'authorizing']);
const activeTunnelStates = new Set(['pairing', 'connecting', 'connected', 'degraded']);
const isBuiltInLocalTunnel = (serverId?: string) => Boolean(serverId?.startsWith('lighttable-local-'));
const scopesLabel = (scopes: readonly LightTableAgentClientScope[]) => scopes.includes('edit')
  ? 'Read and edit documents' : 'Read documents';

export const AgentAccessSettingsPanel: React.FC<{
  readonly service?: LightTableAgentAccessService;
  readonly active: boolean;
}> = ({ service, active }) => {
  const [status, setStatus] = useState<LightTableAgentAccessStatus>(unavailable);
  const [port, setPort] = useState('');
  const [serverUrl, setServerUrl] = useState('');
  const [pairingCode, setPairingCode] = useState('');
  const [mode, setMode] = useState<ConnectionMode>('local');
  const [tunnel, setTunnel] = useState<LightTableAgentTunnelStatus>(tunnelUnavailable);
  const [localMcp, setLocalMcp] = useState<LightTableLocalMcpTestStatus>(localMcpUnavailable);
  const [busy, setBusy] = useState(false);
  const [confirmDeviceRevoke, setConfirmDeviceRevoke] = useState(false);

  useEffect(() => {
    if (!active || !service) return;
    let canceled = false;
    void service.status().then((value) => { if (!canceled) setStatus(value); });
    void service.tunnelStatus().then((value) => {
      if (canceled) return;
      setTunnel(value);
      if (value.serverUrl && !isBuiltInLocalTunnel(value.serverId)) {
        setServerUrl(value.serverUrl);
        setMode('online');
      }
    });
    void service.localMcpStatus().then((value) => { if (!canceled) setLocalMcp(value); });
    const unsubscribe = service.subscribe((value) => { if (!canceled) setStatus(value); });
    const unsubscribeTunnel = service.subscribeTunnel((value) => {
      if (!canceled) {
        setTunnel(value);
        if (value.serverUrl && !isBuiltInLocalTunnel(value.serverId)) setServerUrl(value.serverUrl);
      }
    });
    const unsubscribeLocalMcp = service.subscribeLocalMcp((value) => { if (!canceled) setLocalMcp(value); });
    return () => { canceled = true; unsubscribe(); unsubscribeTunnel(); unsubscribeLocalMcp(); };
  }, [active, service]);

  if (!active) return null;
  const run = (operation: () => Promise<LightTableAgentAccessStatus>) => {
    setBusy(true); void operation().then(setStatus).finally(() => setBusy(false));
  };
  const runTunnel = (operation: () => Promise<LightTableAgentTunnelStatus>) => {
    setBusy(true); void operation().then(setTunnel).finally(() => setBusy(false));
  };
  const runLocalMcp = (operation: () => Promise<LightTableLocalMcpTestStatus>) => {
    setBusy(true); void operation().then(setLocalMcp).finally(() => setBusy(false));
  };
  const localActive = activeLocalStates.has(localMcp.state);
  const tunnelActive = activeTunnelStates.has(tunnel.state);
  const localTunnel = isBuiltInLocalTunnel(tunnel.serverId);
  const onlinePaired = Boolean(tunnel.serverUrl && !localTunnel);
  const connectionAllowed = mode === 'local' ? localActive : onlinePaired && tunnelActive;
  const visibleClients = mode === 'local' ? (localTunnel ? tunnel.clients : [])
    : (onlinePaired ? tunnel.clients : []);
  const setConnectionAllowed = (allowed: boolean) => {
    if (!service) return;
    if (mode === 'local') runLocalMcp(() => allowed ? service.startLocalMcp() : service.stopLocalMcp());
    else runTunnel(() => allowed ? service.reconnectServer() : service.disconnectServer());
  };
  const approve = (clientId: string, requested: readonly LightTableAgentClientScope[], persistent: boolean) => {
    if (!service) return;
    runTunnel(() => service.approveClient(clientId, requested, persistent));
  };

  return (
    <div className="lighttable-agent-settings__body">
      {!service ? <p role="status">Agent connections are available in the desktop app only.</p> : <>
        <div className="lighttable-agent-settings__primary">
          <div>
            <h3>Allow agent connections</h3>
            <p>Let approved AI applications inspect or edit open LightTable documents.</p>
          </div>
          <SwitchControl checked={connectionAllowed} disabled={busy || (mode === 'online' && !onlinePaired)}
            label="Allow agent connections" onCheckedChange={setConnectionAllowed} />
        </div>

        <fieldset className="lighttable-agent-settings__modes" disabled={busy || connectionAllowed}>
          <legend>Connection</legend>
          <label className={mode === 'local' ? 'is-selected' : undefined}>
            <input type="radio" name="agent-connection-mode" checked={mode === 'local'}
              onChange={() => setMode('local')} />
            <span><strong>Local test mode</strong><small>Codex and LightTable on this computer</small></span>
          </label>
          <label className={mode === 'online' ? 'is-selected' : undefined}>
            <input type="radio" name="agent-connection-mode" checked={mode === 'online'}
              onChange={() => setMode('online')} />
            <span><strong>Online MCP server</strong><small>A trusted server paired with this installation</small></span>
          </label>
        </fieldset>

        {mode === 'local' ? <section className="lighttable-agent-settings__card" aria-labelledby="local-agent-heading">
          <div className="lighttable-agent-settings__card-heading">
            <div><h3 id="local-agent-heading">Local Codex</h3>
              <p>{localActive ? 'Ready for local MCP requests.' : 'Turn on agent connections to start the local MCP service.'}</p></div>
            <span className={`lighttable-agent-settings__status is-${localMcp.state}`}>{localMcp.state}</span>
          </div>
          {localMcp.message ? <p role="status">{localMcp.message}</p> : null}
          {localMcp.error ? <p className="lighttable-agent-settings__error" role="alert">{localMcp.error}</p> : null}
          <div className="lighttable-agent-settings__actions">
            <ActionButton disabled={busy || !localActive}
              onClick={() => runLocalMcp(() => service.authorizeCodex())}>Connect Codex…</ActionButton>
          </div>
          <p className="lighttable-agent-settings__note">Needed once per Codex installation. A newly connected MCP profile becomes available after opening or reloading a Codex session.</p>
        </section> : <section className="lighttable-agent-settings__card" aria-labelledby="online-agent-heading">
          <div className="lighttable-agent-settings__card-heading">
            <div><h3 id="online-agent-heading">Online MCP server</h3>
              <p>LightTable connects outward; no public port is opened on this computer.</p></div>
            <span className={`lighttable-agent-settings__status is-${tunnel.state}`}>{tunnel.state}</span>
          </div>
          {!onlinePaired ? <>
            <label>Server URL<input type="url" placeholder="https://mcp.example.com" value={serverUrl}
              disabled={busy} onChange={(event) => setServerUrl(event.currentTarget.value)} /></label>
            <label>One-time pairing code<input type="text" autoComplete="one-time-code" maxLength={64}
              value={pairingCode} disabled={busy}
              onChange={(event) => setPairingCode(event.currentTarget.value)} /></label>
            <div className="lighttable-agent-settings__actions">
              <ActionButton disabled={busy || !serverUrl || pairingCode.length < 6}
                onClick={() => {
                  setBusy(true);
                  void service.pairServer(serverUrl, pairingCode).then((value) => {
                    setTunnel(value); if (value.state === 'connected') setPairingCode('');
                  }).finally(() => setBusy(false));
                }}>Pair server</ActionButton>
            </div>
          </> : <dl>
            <div><dt>Server</dt><dd>{tunnel.serverId}</dd></div>
            <div><dt>Address</dt><dd>{tunnel.serverUrl}</dd></div>
          </dl>}
          {tunnel.error ? <p className="lighttable-agent-settings__error" role="alert">{tunnel.error}</p> : null}
        </section>}

        <section className="lighttable-agent-settings__card" aria-labelledby="connected-agents-heading">
          <div className="lighttable-agent-settings__card-heading">
            <div><h3 id="connected-agents-heading">Connected agents</h3>
              <p>Permissions belong to an exact agent identity on the paired server.</p></div>
          </div>
          {!visibleClients.length ? <p className="lighttable-agent-settings__empty">No agent has requested access yet.</p>
            : <div className="lighttable-agent-settings__clients">
              {visibleClients.map((client) => <div key={client.id}>
                <span><strong>{client.name}</strong><small>{client.approved
                  ? `${scopesLabel(client.scopes)} · ${client.persistent ? 'Always allowed' : 'Allowed for this connection'}`
                  : `Requests: ${scopesLabel(client.requestedScopes)}`}</small></span>
                {client.approved ? <>
                  {client.requestedScopes.includes('edit') && !client.scopes.includes('edit') ? <>
                    <ActionButton size="compact" disabled={busy}
                      onClick={() => approve(client.id, ['read', 'edit'], false)}>Allow edit</ActionButton>
                    <ActionButton size="compact" disabled={busy}
                      onClick={() => approve(client.id, ['read', 'edit'], true)}>Always allow edit</ActionButton>
                  </> : null}
                  <ActionButton size="compact" disabled={busy}
                    onClick={() => runTunnel(() => service.revokeClient(client.id))}>Revoke</ActionButton>
                </> : <>
                  {client.requestedScopes.includes('edit') ? <ActionButton size="compact" disabled={busy}
                    onClick={() => approve(client.id, ['read'], false)}>Allow read only</ActionButton> : null}
                  <ActionButton size="compact" disabled={busy}
                    onClick={() => approve(client.id, client.requestedScopes, false)}>Allow once</ActionButton>
                  <ActionButton size="compact" disabled={busy}
                    onClick={() => approve(client.id, client.requestedScopes, true)}>Always allow</ActionButton>
                  <ActionButton size="compact" disabled={busy}
                    onClick={() => runTunnel(() => service.revokeClient(client.id))}>Deny</ActionButton>
                </>}
              </div>)}
            </div>}
        </section>

        {tunnel.activity ? <div className="lighttable-agent-settings__activity" aria-label="Current Agent action">
          <span><strong>{tunnel.activity.name}</strong><small>{tunnel.activity.status}</small></span>
          <progress max={1} value={tunnel.activity.progress}>{Math.round(tunnel.activity.progress * 100)}%</progress>
          {tunnel.activity.results?.length ? <ul className="lighttable-agent-settings__results" aria-label="Agent action results">
            {tunnel.activity.results.map((result) => <li key={result.id}>
              <strong>{result.mediaType === 'image/png' ? 'Preview' : 'Export'}</strong><span>{result.name}</span>
            </li>)}
          </ul> : null}
          <div className="lighttable-agent-settings__actions">
            <ActionButton disabled={busy || tunnel.activity.status !== 'running' || !tunnel.activity.taskId}
              onClick={() => runTunnel(() => service.cancelActivity())}>Cancel</ActionButton>
            <ActionButton disabled={busy || tunnel.activity.status !== 'completed'}
              onClick={() => runTunnel(() => service.undoActivity())}>Undo Agent Action</ActionButton>
          </div>
        </div> : null}

        <details className="lighttable-agent-settings__advanced">
          <summary>Advanced and diagnostics</summary>
          <dl>
            <div><dt>Connection</dt><dd>{tunnel.state}</dd></div>
            <div><dt>Server</dt><dd>{tunnel.serverId ?? 'Not paired'}</dd></div>
            <div><dt>Device</dt><dd>{tunnel.deviceId}</dd></div>
            <div><dt>Last activity</dt><dd>{tunnel.lastActivity ? new Date(tunnel.lastActivity).toLocaleString() : 'None'}</dd></div>
            {localMcp.endpoint ? <div><dt>Local endpoint</dt><dd>{localMcp.endpoint}</dd></div> : null}
          </dl>
          {tunnel.events.length ? <div className="lighttable-agent-settings__events" aria-label="Recent Agent Access activity">
            {tunnel.events.slice(-5).map((event) => <p key={event.id}><time>{new Date(event.at).toLocaleTimeString()}</time>{event.detail}</p>)}
          </div> : null}
          <div className="lighttable-agent-settings__advanced-block">
            <h4>Direct local automation endpoint</h4>
            <p>Development-only low-level access. Normal MCP use does not require this endpoint.</p>
            <label className="lighttable-agent-settings__toggle">
              <input type="checkbox" checked={status.enabled} disabled={busy}
                onChange={(event) => event.currentTarget.checked
                  ? run(() => service.enable(port ? { port: Number(port) } : undefined))
                  : run(() => service.disable())} />
              <span>{status.enabled ? 'Direct endpoint enabled' : 'Enable direct endpoint'}</span>
            </label>
            <label className="lighttable-agent-settings__port">Preferred port
              <input type="number" min="1024" max="65535" placeholder="Automatic" value={port}
                disabled={status.enabled || busy} onChange={(event) => setPort(event.currentTarget.value)} />
            </label>
            <dl>
              <div><dt>Status</dt><dd>{status.state}</dd></div>
              <div><dt>Address</dt><dd>{status.address ?? 'Not listening'}</dd></div>
              <div><dt>Device</dt><dd>{status.deviceId ?? 'Created when enabled'}</dd></div>
            </dl>
            {status.token ? <label className="lighttable-agent-settings__token">Connection token
              <input readOnly value={status.token} onFocus={(event) => event.currentTarget.select()} />
            </label> : null}
            {status.error ? <p className="lighttable-agent-settings__error" role="alert">{status.error}</p> : null}
            <div className="lighttable-agent-settings__actions">
              <ActionButton disabled={busy} onClick={() => run(() => service.rotateCredentials())}>Rotate credentials</ActionButton>
              <ActionButton disabled={busy || !status.enabled} onClick={() => run(() => service.disable())}>Stop</ActionButton>
            </div>
          </div>
          {tunnel.serverUrl ? <ActionButton disabled={busy} onClick={() => setConfirmDeviceRevoke(true)}>
            Unpair this LightTable installation…
          </ActionButton> : null}
        </details>

        <ConfirmDialog open={confirmDeviceRevoke} title="Unpair LightTable from the MCP server?"
          description="This removes this installation's server pairing and every saved agent permission. Connecting again requires a new pairing."
          confirmLabel="Unpair" danger onCancel={() => setConfirmDeviceRevoke(false)}
          onConfirm={() => { setConfirmDeviceRevoke(false); runTunnel(() => service.revokeDevice()); }} />
      </>}
    </div>
  );
};
