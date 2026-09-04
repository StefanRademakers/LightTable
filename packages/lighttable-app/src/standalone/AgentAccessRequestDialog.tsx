import { Button, Dialog, Text } from '@lighttable/ui';
import React, { useEffect, useRef, useState } from 'react';
import type { LightTableAgentAccessService, LightTableAgentTunnelStatus } from '../platform/LightTableHost';

export const AgentAccessRequestDialog: React.FC<{
  readonly service?: LightTableAgentAccessService;
}> = ({ service }) => {
  const [status, setStatus] = useState<LightTableAgentTunnelStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lifecycleRef = useRef(0);
  const request = status?.clients.find((client) => !client.approved) ?? null;
  const perform = (action: () => Promise<LightTableAgentTunnelStatus>) => {
    const lifecycle = lifecycleRef.current;
    setBusy(true);
    setError(null);
    void action().then((value) => {
      if (lifecycleRef.current === lifecycle) setStatus(value);
    }).catch((reason) => {
      if (lifecycleRef.current === lifecycle) setError(reason instanceof Error ? reason.message : String(reason));
    }).finally(() => {
      if (lifecycleRef.current === lifecycle) setBusy(false);
    });
  };
  const close = () => {
    if (!service || !request || busy) return;
    perform(() => service.revokeClient(request.id));
  };
  useEffect(() => {
    if (!service) return;
    const lifecycle = ++lifecycleRef.current;
    let canceled = false;
    setBusy(false);
    void service.tunnelStatus().then((value) => { if (!canceled && lifecycleRef.current === lifecycle) setStatus(value); }).catch((reason) => {
      if (!canceled && lifecycleRef.current === lifecycle) setError(reason instanceof Error ? reason.message : String(reason));
    });
    const unsubscribe = service.subscribeTunnel((value) => {
      if (!canceled && lifecycleRef.current === lifecycle) setStatus(value);
    });
    return () => { canceled = true; lifecycleRef.current += 1; unsubscribe(); };
  }, [service]);

  if (!service || !request) return null;
  const wantsEdit = request.requestedScopes.includes('edit');
  const approve = (persistent: boolean) => {
    perform(() => service.approveClient(request.id, request.requestedScopes, persistent));
  };

  return (
    <Dialog open size="wide" title={`Allow ${request.name} to ${wantsEdit ? 'edit' : 'read'} documents?`}
      aria-label={`${request.name} requests LightTable access`}
      onDismiss={close} footer={<>
        <Button tabIndex={0} disabled={busy} onClick={close}>Deny</Button>
        {wantsEdit ? <Button tabIndex={0} disabled={busy}
          onClick={() => perform(() => service.approveClient(request.id, ['read'], false))}>Allow read only</Button> : null}
        <Button tabIndex={0} disabled={busy} onClick={() => approve(false)}>Allow once</Button>
        <Button tabIndex={0} disabled={busy} onClick={() => approve(true)}>Always allow</Button>
      </>}>
        <Text as="p">{request.name} is requesting permission to {wantsEdit
          ? 'inspect and change open LightTable documents.'
          : 'inspect open LightTable documents without changing them.'}</Text>
        <Text as="p" tone="muted">Always allow is saved only for this exact agent identity on the currently paired server. You can revoke it later in Preferences.</Text>
        {error ? <Text as="p" className="lighttable-agent-settings__error" role="alert">{error}</Text> : null}
    </Dialog>
  );
};
