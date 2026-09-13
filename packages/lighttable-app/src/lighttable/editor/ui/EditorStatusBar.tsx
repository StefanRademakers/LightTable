import { EditorStatusBar as StatusBar, EditorStatusMeta, EditorStatusSpacer, EditorStatusText, MaskIcon, SegmentedControl } from '@lighttable/ui';
import { ButtonBase } from '../../../ui/ButtonBase';
import React from 'react';
import { lightTableIcon } from '../../../assets/icons';

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
  { preset: 'photo-edit', label: 'Photo edit', icon: 'photo.png' },
  { preset: 'video', label: 'Video', icon: 'media_video.png' }
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
  <StatusBar className="lighttable-toolbar">
    <ButtonBase
      className="lighttable-toolbar__dock-toggle"
      type="button"
      disabled={!leftDockAvailable}
      aria-label={`${leftDockVisible ? 'Hide' : 'Show'} left panels`}
      aria-pressed={leftDockVisible}
      title={`${leftDockVisible ? 'Hide' : 'Show'} left panels`}
      onClick={onToggleLeftDock}
    >
      <MaskIcon
        src={lightTableIcon(`column_left_${leftDockVisible ? 'active' : 'inactive'}.png`)}
        mode="luminance"
      />
    </ButtonBase>
    <SegmentedControl
      variant="quiet"
      className="lighttable-toolbar__workspace-switches"
      label="Workspaces"
      value={selectedWorkspacePreset(workspacePreset)}
      onChange={(preset) => onWorkspacePresetChange?.(preset)}
      options={WORKSPACE_SWITCHES.map(({ preset, label, icon }) => ({
        value: preset,
        label,
        icon: <MaskIcon src={lightTableIcon(icon)} mode="luminance" />,
        ariaLabel: `Switch to ${label} workspace`,
        title: `${label} workspace`
      }))}
    />
    <EditorStatusText
      className={`lighttable-toolbar__status${error ? ' lighttable-toolbar__status--error' : ''}`}
      tone={error ? 'error' : 'normal'}
      title={status || undefined}
    >
      {status}
    </EditorStatusText>
    <EditorStatusMeta
      className={`lighttable-toolbar__meta${reportAvailable ? ' lighttable-toolbar__meta--report' : ''}`}
      interactive={reportAvailable}
      role={reportAvailable ? 'button' : undefined}
      tabIndex={-1}
      onClick={reportAvailable ? onOpenReport : undefined}
      onKeyDown={reportAvailable ? (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        onOpenReport?.();
      } : undefined}
      title={metaTitle}
    >
      {meta}
    </EditorStatusMeta>
    <EditorStatusSpacer />
    <ButtonBase
      className="lighttable-toolbar__dock-toggle"
      type="button"
      disabled={!rightDockAvailable}
      aria-label={`${rightDockVisible ? 'Hide' : 'Show'} right panels`}
      aria-pressed={rightDockVisible}
      title={`${rightDockVisible ? 'Hide' : 'Show'} right panels`}
      onClick={onToggleRightDock}
    >
      <MaskIcon
        src={lightTableIcon(`column_right_${rightDockVisible ? 'active' : 'inactive'}.png`)}
        mode="luminance"
      />
    </ButtonBase>
  </StatusBar>
);
