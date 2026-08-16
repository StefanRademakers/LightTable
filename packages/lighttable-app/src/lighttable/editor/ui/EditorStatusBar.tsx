import React from 'react';
import { lightTableIcon } from '../../../assets/icons';
import { SegmentedControl } from '../../../ui/SegmentedControl';
import type { LightTableWorkspacePreset } from '../workspace/workspaceLayoutPersistence';
import type { SelectableLightTableWorkspacePreset } from '../workspace/workspacePresets';

export interface EditorStatusBarProps {
  status: string;
  error: boolean;
  meta: string;
  metaTitle?: string;
  reportAvailable?: boolean;
  onOpenReport?: () => void;
  leftDockAvailable?: boolean;
  leftDockVisible?: boolean;
  rightDockAvailable?: boolean;
  rightDockVisible?: boolean;
  onToggleLeftDock?: () => void;
  onToggleRightDock?: () => void;
  workspacePreset?: LightTableWorkspacePreset;
  onWorkspacePresetChange?: (preset: SelectableLightTableWorkspacePreset) => void;
}

const WORKSPACE_SWITCHES: readonly {
  preset: SelectableLightTableWorkspacePreset;
  label: string;
  icon: string;
}[] = [
  { preset: 'ai-generation', label: 'Gen AI', icon: 'genai.png' },
  { preset: 'grading', label: 'Grading', icon: 'add_adjustment_layer.png' },
  { preset: 'photo-edit', label: 'Photo edit', icon: 'photo.png' }
];

const selectedWorkspacePreset = (
  preset: LightTableWorkspacePreset
): SelectableLightTableWorkspacePreset | '' => (
  WORKSPACE_SWITCHES.some((item) => item.preset === preset)
    ? preset as SelectableLightTableWorkspacePreset
    : ''
);

export const EditorStatusBar: React.FC<EditorStatusBarProps> = ({
  status,
  error,
  meta,
  metaTitle,
  reportAvailable = false,
  onOpenReport,
  leftDockAvailable = false,
  leftDockVisible = false,
  rightDockAvailable = false,
  rightDockVisible = false,
  onToggleLeftDock,
  onToggleRightDock,
  workspacePreset = 'default',
  onWorkspacePresetChange
}) => (
  <footer className="lighttable-toolbar">
    <button
      className="lighttable-toolbar__dock-toggle"
      type="button"
      disabled={!leftDockAvailable}
      aria-label={`${leftDockVisible ? 'Hide' : 'Show'} left panels`}
      aria-pressed={leftDockVisible}
      title={`${leftDockVisible ? 'Hide' : 'Show'} left panels`}
      onClick={onToggleLeftDock}
    >
      <img
        src={lightTableIcon(`column_left_${leftDockVisible ? 'active' : 'inactive'}.png`)}
        alt=""
      />
    </button>
    <SegmentedControl
      className="lighttable-toolbar__workspace-switches"
      variant="low-attention"
      ariaLabel="Workspaces"
      value={selectedWorkspacePreset(workspacePreset)}
      onChange={(preset) => onWorkspacePresetChange?.(preset)}
      options={WORKSPACE_SWITCHES.map(({ preset, label, icon }) => ({
        value: preset,
        label,
        icon: <img src={lightTableIcon(icon)} alt="" aria-hidden="true" />,
        ariaLabel: `Switch to ${label} workspace`,
        title: `${label} workspace`
      }))}
    />
    <div
      className={`lighttable-toolbar__status${error ? ' lighttable-toolbar__status--error' : ''}`}
      title={status || undefined}
    >
      {status}
    </div>
    <div
      className={`lighttable-toolbar__meta${reportAvailable ? ' lighttable-toolbar__meta--report' : ''}`}
      role={reportAvailable ? 'button' : undefined}
      tabIndex={reportAvailable ? 0 : undefined}
      onClick={reportAvailable ? onOpenReport : undefined}
      onKeyDown={reportAvailable ? (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        onOpenReport?.();
      } : undefined}
      title={metaTitle}
    >
      {meta}
    </div>
    <div aria-hidden="true" />
    <button
      className="lighttable-toolbar__dock-toggle"
      type="button"
      disabled={!rightDockAvailable}
      aria-label={`${rightDockVisible ? 'Hide' : 'Show'} right panels`}
      aria-pressed={rightDockVisible}
      title={`${rightDockVisible ? 'Hide' : 'Show'} right panels`}
      onClick={onToggleRightDock}
    >
      <img
        src={lightTableIcon(`column_right_${rightDockVisible ? 'active' : 'inactive'}.png`)}
        alt=""
      />
    </button>
  </footer>
);
