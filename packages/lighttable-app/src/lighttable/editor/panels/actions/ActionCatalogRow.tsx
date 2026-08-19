import React from 'react';
import type { LightTableCommandId } from '@lighttable/command-contract';
import { ActionButton } from '../../../../ui/ActionButton';
import {
  ACTION_CATEGORY_LABELS,
  actionExposureLabel,
  type ActionCatalogItem
} from '../../../application/actions/actionCatalogModel';

interface ActionCatalogRowProps {
  readonly item: ActionCatalogItem;
  readonly running: boolean;
  readonly runBlocked: boolean;
  readonly onRun: (command: LightTableCommandId) => void;
}

export const ActionCatalogRow: React.FC<ActionCatalogRowProps> = ({
  item,
  running,
  runBlocked,
  onRun
}) => {
  const { definition, available, unavailableReason } = item;
  return <details className="lighttable-actions-panel__action">
    <summary>
      <span>
        <strong>{definition.label}</strong>
        <code>{definition.id}</code>
      </span>
      <span className={available ? 'is-available' : 'is-unavailable'}>
        {available ? 'Available' : 'Unavailable'}
      </span>
    </summary>
    <div className="lighttable-actions-panel__action-body">
      <p>{definition.description}</p>
      <dl>
        <div><dt>Category</dt><dd>{ACTION_CATEGORY_LABELS[definition.category]}</dd></div>
        <div><dt>Scope</dt><dd>{definition.scope}</dd></div>
        <div><dt>Effect</dt><dd>{definition.effect}</dd></div>
        <div><dt>Exposure</dt><dd>{actionExposureLabel(definition)}</dd></div>
      </dl>
      {!available && unavailableReason
        ? <p className="lighttable-actions-panel__reason">{unavailableReason}</p>
        : null}
      {!definition.agentAccess && definition.agentAccessReason
        ? <p className="lighttable-actions-panel__reason">
            Agent Access: {definition.agentAccessReason}
          </p>
        : null}
      {definition.invocation === 'direct'
        ? <ActionButton size="control" disabled={!available || runBlocked}
            onClick={() => onRun(definition.id)}>
            {running ? 'Running…' : 'Run'}
          </ActionButton>
        : <p className="lighttable-actions-panel__parameters">
            Parameters required; the typed editor for this command is not implemented yet.
          </p>}
    </div>
  </details>;
};
