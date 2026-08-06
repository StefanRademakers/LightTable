import React from 'react';
import type { AutomationTaskEvent } from '../../application/commands/automationTaskEventStore';

export interface AgentActivityPanelProps {
  readonly events: readonly AutomationTaskEvent[];
  readonly onCancel: (taskId: string) => void;
}

export const AgentActivityPanel: React.FC<AgentActivityPanelProps> = ({ events, onCancel }) => {
  const latest = new Map<string, AutomationTaskEvent>();
  for (const event of events) latest.set(event.taskId, event);
  const tasks = [...latest.values()].reverse();
  return <aside className="lighttable-panel lighttable-agent-activity" aria-label="Agent activity">
    <div className="lighttable-agent-activity__title">Agent activity</div>
    {tasks.length === 0
      ? <p className="lighttable-panel__empty">No agent operations yet.</p>
      : <div className="lighttable-panel__controls">{tasks.map((event) => <section className="lighttable-agent-activity__task" key={event.taskId}>
          <div className="lighttable-agent-activity__row">
            <span>{event.message ?? event.taskId}</span>
            <span>{event.status}</span>
          </div>
          {event.progress !== null && <progress max={1} value={event.progress} aria-label="Agent progress" />}
          {event.operationId && <div className="lighttable-agent-activity__hint">Current: {event.operationId}</div>}
          {event.status === 'running' || event.status === 'progress'
            ? <button type="button" className="lighttable-button" onClick={() => onCancel(event.taskId)}>Cancel</button>
            : event.status === 'completed'
              ? <div className="lighttable-agent-activity__hint">History: Undo {event.message ?? 'agent operation'}</div>
              : null}
        </section>)}</div>}
  </aside>;
};
