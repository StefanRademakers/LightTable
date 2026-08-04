import React from 'react';
import { lightTableIcon } from '../../../assets/icons';
import type { ToolId } from '../session/editorSession';
import {
  SELECTION_TOOL_DEFINITIONS,
  SHAPE_TOOL_DEFINITIONS,
  TEXT_TOOL_DEFINITIONS,
  TOOL_DEFINITIONS,
  type ToolDefinition
} from '../tools/toolRegistry';

interface EditorToolbarProps {
  activeTool: ToolId;
  foregroundColor: string;
  backgroundColor: string;
  onToolChange: (tool: ToolId) => void;
  onForegroundColorChange: (color: string) => void;
  onBackgroundColorChange: (color: string) => void;
  onSwapColors: () => void;
  onResetColors: () => void;
}

interface ToolButtonProps {
  tool: ToolDefinition;
  active: boolean;
  popupOpen?: boolean;
  onClick: () => void;
}

export const ToolButton: React.FC<ToolButtonProps> = ({
  tool,
  active,
  popupOpen,
  onClick
}) => (
  <button
    type="button"
    className={`lighttable-toolbox__button${active ? ' lighttable-toolbox__button--active' : ''}`}
    onClick={onClick}
    aria-pressed={active}
    aria-haspopup={popupOpen === undefined ? undefined : 'true'}
    aria-expanded={popupOpen}
    aria-label={tool.shortcutLabel ? `${tool.label} (${tool.shortcutLabel})` : tool.label}
    title={tool.shortcutLabel ? `${tool.label} (${tool.shortcutLabel})` : tool.label}
  >
    <img src={lightTableIcon(tool.iconName)} alt="" aria-hidden="true" />
  </button>
);

interface ToolFamilySlotProps {
  activeTool: ToolId;
  definitions: readonly ToolDefinition[];
  label: string;
  onToolChange: (tool: ToolId) => void;
}

const ToolFamilySlot: React.FC<ToolFamilySlotProps> = ({
  activeTool,
  definitions,
  label,
  onToolChange
}) => {
  const activeDefinition = definitions.find(({ id }) => id === activeTool);
  const [rememberedDefinition, setRememberedDefinition] = React.useState<ToolDefinition>(
    activeDefinition ?? definitions[0]!
  );
  const [open, setOpen] = React.useState(false);
  const [generation, setGeneration] = React.useState(0);

  React.useEffect(() => {
    if (activeDefinition) setRememberedDefinition(activeDefinition);
  }, [activeDefinition]);

  React.useEffect(() => {
    if (!open) return undefined;
    const timeout = window.setTimeout(() => setOpen(false), 3_000);
    return () => window.clearTimeout(timeout);
  }, [generation, open]);

  const master = activeDefinition ?? rememberedDefinition;
  const showFlyout = () => {
    setOpen(true);
    setGeneration((value) => value + 1);
  };

  return (
    <div
      className="lighttable-toolbox__group"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <ToolButton
        tool={master}
        active={Boolean(activeDefinition)}
        popupOpen={open}
        onClick={() => {
          onToolChange(master.id);
          showFlyout();
        }}
      />
      <button
        type="button"
        className="lighttable-toolbox__group-menu-button"
        aria-label={`Show ${label.toLowerCase()}`}
        aria-haspopup="true"
        aria-expanded={open}
        title={`Show ${label.toLowerCase()}`}
        onClick={showFlyout}
      ><span aria-hidden="true" /></button>
      {open ? (
        <div className="lighttable-toolbox__flyout" role="toolbar" aria-label={label}>
          {definitions.map((tool) => (
            <ToolButton
              key={tool.id}
              tool={tool}
              active={activeTool === tool.id}
              onClick={() => {
                setRememberedDefinition(tool);
                setOpen(false);
                onToolChange(tool.id);
              }}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
};

export const toolFamilyFor = (tool: ToolDefinition) => {
  if (tool.role === 'selection') {
    return { definitions: SELECTION_TOOL_DEFINITIONS, label: 'Selection tools' };
  }
  if (tool.id.startsWith('shape-')) {
    return { definitions: SHAPE_TOOL_DEFINITIONS, label: 'Shape tools' };
  }
  if (tool.role === 'text') {
    return { definitions: TEXT_TOOL_DEFINITIONS, label: 'Text tools' };
  }
  return null;
};

export const EditorToolbar: React.FC<EditorToolbarProps> = ({
  activeTool,
  foregroundColor,
  backgroundColor,
  onToolChange,
  onForegroundColorChange,
  onBackgroundColorChange,
  onSwapColors,
  onResetColors
}) => (
  <nav className="lighttable-toolbox" aria-label="Image tools">
    <div className="lighttable-toolbox__content">
      {TOOL_DEFINITIONS.map((tool) => {
        const family = toolFamilyFor(tool);
        if (!family) {
          return (
            <ToolButton
              key={tool.id}
              tool={tool}
              active={activeTool === tool.id}
              onClick={() => onToolChange(tool.id)}
            />
          );
        }
        if (tool.id !== family.definitions[0]?.id) return null;
        return (
          <ToolFamilySlot
            key={family.label}
            activeTool={activeTool}
            definitions={family.definitions}
            label={family.label}
            onToolChange={onToolChange}
          />
        );
      })}
      <div className="lighttable-toolbox__colors" aria-label="Foreground and background colors">
        <button
          type="button"
          className="lighttable-toolbox__reset-colors"
          onClick={onResetColors}
          title="Reset foreground and background colors"
          aria-label="Reset foreground and background colors"
        >
          <span />
          <span />
        </button>
        <button
          type="button"
          className="lighttable-toolbox__swap-colors"
          onClick={onSwapColors}
          title="Swap foreground and background colors (X)"
          aria-label="Swap foreground and background colors"
        >
          ↔
        </button>
        <label
          className="lighttable-toolbox__color lighttable-toolbox__color--background"
          style={{ backgroundColor }}
          title="Background color"
        >
          <input
            type="color"
            value={backgroundColor}
            onChange={(event) => onBackgroundColorChange(event.currentTarget.value)}
            aria-label="Background color"
          />
        </label>
        <label
          className="lighttable-toolbox__color lighttable-toolbox__color--foreground"
          style={{ backgroundColor: foregroundColor }}
          title="Foreground color"
        >
          <input
            type="color"
            value={foregroundColor}
            onChange={(event) => onForegroundColorChange(event.currentTarget.value)}
            aria-label="Foreground color"
          />
        </label>
      </div>
    </div>
  </nav>
);
