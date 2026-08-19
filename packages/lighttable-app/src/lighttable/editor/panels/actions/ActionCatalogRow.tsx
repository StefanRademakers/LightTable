import React from 'react';
import {
  LIGHTTABLE_COMMAND_PARAMETER_PROPERTIES,
  type LightTableCommandId
} from '@lighttable/command-contract';
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
  const parameters = Object.entries(LIGHTTABLE_COMMAND_PARAMETER_PROPERTIES[definition.id]);
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
      <div className="lighttable-actions-panel__parameters">
        <strong>Properties</strong>
        {parameters.length > 0
          ? <dl>{parameters.map(([name, type]) => <div key={name}>
              <dt><code>{name}</code></dt><dd>{type}</dd>
            </div>)}</dl>
          : <p>None</p>}
      </div>
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
            Property editing is not implemented yet; recorded executions remain replayable.
          </p>}
    </div>
  </details>;
};
