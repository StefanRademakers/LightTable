import { Button } from '@lighttable/ui';
import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { LightTableAgentAccessService, LightTableAgentTunnelStatus } from '../platform/LightTableHost';

import { useDialogAccessibility } from '../ui/useDialogAccessibility';

export const AgentAccessRequestDialog: React.FC<{
  readonly service?: LightTableAgentAccessService;
}> = ({ service }) => {
  const [status, setStatus] = useState<LightTableAgentTunnelStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = status?.clients.find((client) => !client.approved) ?? null;
  const close = () => {
    if (!service || !request || busy) return;
    setBusy(true); setError(null);
    void service.revokeClient(request.id).then(setStatus)
      .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setBusy(false));
  };
  const { dialogRef, onDialogKeyDown } = useDialogAccessibility<HTMLDivElement>(Boolean(request), close);

  useEffect(() => {
    if (!service) return;
    let canceled = false;
    void service.tunnelStatus().then((value) => { if (!canceled) setStatus(value); }).catch((reason) => {
      if (!canceled) setError(reason instanceof Error ? reason.message : String(reason));
    });
    const unsubscribe = service.subscribeTunnel((value) => { if (!canceled) setStatus(value); });
    return () => { canceled = true; unsubscribe(); };
  }, [service]);

  if (!service || !request) return null;
  const wantsEdit = request.requestedScopes.includes('edit');
  const approve = (persistent: boolean) => {
    setBusy(true); setError(null);
    void service.approveClient(request.id, request.requestedScopes, persistent).then(setStatus)
      .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setBusy(false));
  };

  return createPortal(
    <div className="modal-backdrop modal-backdrop--confirm">
      <div ref={dialogRef} className="modal lighttable-agent-request" role="dialog" aria-modal="true"
        aria-label={`${request.name} requests LightTable access`} tabIndex={-1}
        data-editor-native-tab-navigation onKeyDown={onDialogKeyDown}
        onClick={(event) => event.stopPropagation()}>
        <div className="modal__header"><h3 className="modal__title">Allow {request.name} to {wantsEdit ? 'edit' : 'read'} documents?</h3></div>
        <p>{request.name} is requesting permission to {wantsEdit
          ? 'inspect and change open LightTable documents.'
          : 'inspect open LightTable documents without changing them.'}</p>
        <p className="muted">Always allow is saved only for this exact agent identity on the currently paired server. You can revoke it later in Preferences.</p>
        {error ? <p className="lighttable-agent-settings__error" role="alert">{error}</p> : null}
        <div className="modal__footer">
          <Button tabIndex={0} disabled={busy} onClick={close}>Deny</Button>
          {wantsEdit ? <Button tabIndex={0} disabled={busy}
            onClick={() => {
              setBusy(true); setError(null);
              void service.approveClient(request.id, ['read'], false).then(setStatus)
                .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)))
                .finally(() => setBusy(false));
            }}>Allow read only</Button> : null}
          <Button tabIndex={0} disabled={busy} onClick={() => approve(false)}>Allow once</Button>
          <Button tabIndex={0} disabled={busy} onClick={() => approve(true)}>Always allow</Button>
        </div>
      </div>
    </div>,
    document.body
  );
};
