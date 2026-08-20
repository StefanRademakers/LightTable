import React from 'react';
import {
  LIGHTTABLE_COMMAND_PARAMETER_PROPERTIES,
  LIGHTTABLE_COMMAND_EXAMPLES,
  LIGHTTABLE_COMMAND_SCHEMAS,
  type LightTableCommandId
} from '@lighttable/command-contract';
import { ActionButton } from '../../../../ui/ActionButton';
import { CommandParameterEditor } from './CommandParameterEditor';
import {
  ACTION_CATEGORY_LABELS,
  actionExposureLabel,
  type ActionCatalogItem
} from '../../../application/actions/actionCatalogModel';

interface ActionCatalogRowProps {
  readonly item: ActionCatalogItem;
  readonly running: boolean;
  readonly runBlocked: boolean;
  readonly onRun: (command: LightTableCommandId, parameters: unknown) => void;
}

export const ActionCatalogRow: React.FC<ActionCatalogRowProps> = ({
  item,
  running,
  runBlocked,
  onRun
}) => {
  const { definition, available, unavailableReason } = item;
  const parameters = Object.entries(LIGHTTABLE_COMMAND_PARAMETER_PROPERTIES[definition.id]);
  const schema = LIGHTTABLE_COMMAND_SCHEMAS[definition.id]?.input;
  const example = LIGHTTABLE_COMMAND_EXAMPLES[definition.id]?.[0];
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
            onClick={() => onRun(definition.id, {})}>
            {running ? 'Running…' : 'Run'}
          </ActionButton>
        : schema
          ? <CommandParameterEditor schema={schema} initialParameters={example}
              disabled={!available || runBlocked}
              running={running} onRun={(values) => onRun(definition.id, values)} />
          : <p className="lighttable-actions-panel__parameters">
              This command still has legacy property metadata; schema-driven editing is not available yet.
            </p>}
    </div>
  </details>;
};
