import React, { useMemo, useState } from 'react';
import {
  LIGHTTABLE_COMMAND_DEFINITIONS,
  type LightTableCommandCategory,
  type LightTableCommandDefinition,
  type LightTableCommandId
} from '@lighttable/command-contract';
import { FormSelect } from '../../../../ui/FormSelect';
import { SearchField } from '../../../../ui/SearchField';
import {
  ACTION_CATEGORY_LABELS,
  buildActionCatalogGroups
} from '../../../application/actions/actionCatalogModel';
import type {
  CommandCapabilitySummary,
  LightTableCommandResult
} from '../../../application/commands/lightTableCommandContract';
import { ActionCatalogRow } from './ActionCatalogRow';

export interface CommandCatalogViewProps {
  readonly capabilities: readonly CommandCapabilitySummary[] | null;
  readonly onExecute: (
    command: LightTableCommandId,
    parameters: unknown
  ) => Promise<LightTableCommandResult> | null;
  readonly definitions?: readonly LightTableCommandDefinition[];
}

export const CommandCatalogView: React.FC<CommandCatalogViewProps> = ({
  capabilities,
  onExecute,
  definitions = LIGHTTABLE_COMMAND_DEFINITIONS
}) => {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<'all' | LightTableCommandCategory>('all');
  const [running, setRunning] = useState<LightTableCommandId | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const groups = useMemo(
    () => buildActionCatalogGroups(definitions, capabilities, { query, category }),
    [capabilities, category, definitions, query]
  );
  const visibleCount = groups.reduce((total, group) => total + group.items.length, 0);
  const categories = [...new Set(definitions.map((definition) => definition.category))];

  const execute = async (command: LightTableCommandId, parameters: unknown) => {
    setRunning(command);
    setResult(null);
    try {
      const pending = onExecute(command, parameters);
      if (!pending) return setResult('The local command service is unavailable.');
      const response = await pending;
      setResult(response.status === 'rejected'
        ? `${command}: ${response.message}`
        : `${command}: ${response.status}`);
    } catch (reason) {
      setResult(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setRunning(null);
    }
  };

  return <div className="lighttable-command-catalog">
    <header className="lighttable-command-catalog__filters">
      <span>{visibleCount} of {definitions.length} commands</span>
      <SearchField aria-label="Search commands" placeholder="Search commands" value={query}
        onChange={(event) => setQuery(event.currentTarget.value)} onClear={() => setQuery('')} />
      <FormSelect aria-label="Command category" value={category}
        onChange={(event) => setCategory(event.currentTarget.value as typeof category)}>
        <option value="all">All categories</option>
        {categories.map((value) => <option key={value} value={value}>
          {ACTION_CATEGORY_LABELS[value]}
        </option>)}
      </FormSelect>
    </header>
    {result ? <p className="lighttable-actions-panel__result" role="status">{result}</p> : null}
    <div className="lighttable-actions-panel__list">
      {groups.length === 0 ? <p className="lighttable-panel__empty">No matching commands.</p> : null}
      {groups.map((group) => <section key={group.category} aria-labelledby={`command-${group.category}`}>
        <h3 id={`command-${group.category}`}>{group.label}</h3>
        {group.items.map((item) => <ActionCatalogRow key={item.definition.id} item={item}
          running={running === item.definition.id} runBlocked={running !== null}
          onRun={(command, parameters) => void execute(command, parameters)} />)}
      </section>)}
    </div>
  </div>;
};
