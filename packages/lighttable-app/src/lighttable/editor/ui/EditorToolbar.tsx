import { ButtonBase } from '../../../ui/ButtonBase';
import React from 'react';
import { ColorSwatchField } from '../../../ui/ColorSwatchField';
import { lightTableIcon } from '../../../assets/icons';
import type { ToolId } from '../session/editorSession';
import {
  FILL_TOOL_DEFINITIONS,
  LASSO_TOOL_DEFINITIONS,
  MARQUEE_TOOL_DEFINITIONS,
  PATH_SELECTION_TOOL_DEFINITIONS,
  PEN_TOOL_DEFINITIONS,
  SHAPE_TOOL_DEFINITIONS,
  SMART_SELECTION_TOOL_DEFINITIONS,
  TEXT_TOOL_DEFINITIONS,
  TONE_TOOL_DEFINITIONS,
  toolbarToolDefinitions,
  type ToolDefinition
} from '../tools/toolRegistry';

interface EditorToolbarProps {
  documentKind?: 'image' | 'video' | 'model-3d';
  activeTool: ToolId;
  foregroundColor: string;
  backgroundColor: string;
  onToolChange: (tool: ToolId) => void;
  onZoomActual: () => void;
  onForegroundColorChange: (color: string) => void;
  onBackgroundColorChange: (color: string) => void;
  onSwapColors: () => void;
  onResetColors: () => void;
}

interface ToolButtonProps {
  tool: ToolDefinition;
  active: boolean;
  detailed?: boolean;
  popupOpen?: boolean;
  onMouseDown?: () => void;
  onKeyDown?: React.KeyboardEventHandler<HTMLButtonElement>;
  onClick: () => void;
  onDoubleClick?: React.MouseEventHandler<HTMLButtonElement>;
}

export const ToolButton: React.FC<ToolButtonProps> = ({
  tool,
  active,
  detailed = false,
  popupOpen,
  onMouseDown,
  onKeyDown,
  onClick,
  onDoubleClick
}) => (
  <ButtonBase
    type="button"
    className={`lighttable-toolbox__button${detailed ? ' lighttable-toolbox__button--detailed' : ''}${active ? ' lighttable-toolbox__button--active' : ''}`}
    onMouseDown={onMouseDown}
    onKeyDown={onKeyDown}
    onClick={onClick}
    onDoubleClick={onDoubleClick}
    aria-pressed={active}
    aria-haspopup={popupOpen === undefined ? undefined : 'true'}
    aria-expanded={popupOpen}
    aria-label={tool.shortcutLabel ? `${tool.label} (${tool.shortcutLabel})` : tool.label}
    title={tool.shortcutLabel ? `${tool.label} (${tool.shortcutLabel})` : tool.label}
  >
    <img src={lightTableIcon(tool.iconName)} alt="" aria-hidden="true" />
    {detailed ? <>
      <span className="lighttable-toolbox__button-label">{tool.label}</span>
      <span className="lighttable-toolbox__button-shortcut" aria-hidden="true">{tool.shortcutLabel ?? ''}</span>
    </> : null}
  </ButtonBase>
);

interface ToolFamilySlotProps {
  activeTool: ToolId;
  definitions: readonly ToolDefinition[];
  expanded: boolean;
  label: string;
  onExpandedToolChosen: () => void;
  onToolChange: (tool: ToolId) => void;
}

const ToolFamilySlot: React.FC<ToolFamilySlotProps> = ({
  activeTool,
  definitions,
  expanded,
  label,
  onExpandedToolChosen,
  onToolChange
}) => {
  const activeDefinition = definitions.find(({ id }) => id === activeTool);
  const [rememberedDefinition, setRememberedDefinition] = React.useState<ToolDefinition>(
    activeDefinition ?? definitions[0]!
  );
  const [open, setOpen] = React.useState(false);
  const [generation, setGeneration] = React.useState(0);
  const flyoutId = React.useId();
  const groupRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (activeDefinition) setRememberedDefinition(activeDefinition);
  }, [activeDefinition]);

  React.useEffect(() => {
    if (!open || expanded) return undefined;
    const timeout = window.setTimeout(() => setOpen(false), 3_000);
    return () => window.clearTimeout(timeout);
  }, [expanded, generation, open]);

  React.useEffect(() => {
    if (!expanded) setOpen(false);
  }, [expanded]);

  React.useEffect(() => {
    if (!open || expanded) return undefined;
    const closeOnOutsidePointer = (event: globalThis.PointerEvent) => {
      if (!groupRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer, true);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer, true);
  }, [expanded, open]);

  const master = activeDefinition ?? rememberedDefinition;
  const flyoutVisible = expanded || open;
  const showFlyout = () => {
    setOpen(true);
    setGeneration((value) => value + 1);
  };

  return (
    <div
      ref={groupRef}
      className="lighttable-toolbox__group"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <ToolButton
        tool={master}
        active={Boolean(activeDefinition)}
        popupOpen={flyoutVisible}
        onMouseDown={showFlyout}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown') return;
          event.preventDefault();
          showFlyout();
          window.requestAnimationFrame(() => {
            event.currentTarget.parentElement
              ?.querySelector<HTMLButtonElement>('.lighttable-toolbox__flyout .lighttable-toolbox__button')
              ?.focus();
          });
        }}
        onClick={() => {
          onToolChange(master.id);
          showFlyout();
        }}
      />
      <ButtonBase
        type="button"
        className="lighttable-toolbox__group-menu-button"
        aria-label={`Show ${label.toLowerCase()}`}
        aria-haspopup="true"
        aria-expanded={flyoutVisible}
        aria-controls={flyoutId}
        title={`Show ${label.toLowerCase()}`}
        onMouseDown={showFlyout}
        onClick={showFlyout}
      ><span aria-hidden="true" /></ButtonBase>
      {flyoutVisible ? (
        <div
          id={flyoutId}
          className={`lighttable-toolbox__flyout${expanded ? ' lighttable-toolbox__flyout--expanded' : ''}`}
          role="toolbar"
          aria-orientation={expanded ? 'horizontal' : 'vertical'}
          data-editor-native-tab-navigation
          aria-label={label}
          onKeyDown={(event) => {
            const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('.lighttable-toolbox__button')];
            const index = Math.max(0, buttons.indexOf(document.activeElement as HTMLButtonElement));
            if (event.key === 'Escape') {
              event.preventDefault();
              setOpen(false);
              event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(':scope > .lighttable-toolbox__button')?.focus();
              return;
            }
            const previousKey = expanded ? 'ArrowLeft' : 'ArrowUp';
            const nextKey = expanded ? 'ArrowRight' : 'ArrowDown';
            if (![previousKey, nextKey, 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const next = event.key === 'Home' ? 0
              : event.key === 'End' ? buttons.length - 1
                : (index + (event.key === nextKey ? 1 : -1) + buttons.length) % buttons.length;
            buttons[next]?.focus();
          }}
        >
          {definitions.map((tool) => (
            <ToolButton
              key={tool.id}
              tool={tool}
              active={activeTool === tool.id}
              detailed={!expanded}
              onClick={() => {
                setRememberedDefinition(tool);
                setOpen(false);
                if (expanded) onExpandedToolChosen();
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
  if (MARQUEE_TOOL_DEFINITIONS.some(({ id }) => id === tool.id)) {
    return { definitions: MARQUEE_TOOL_DEFINITIONS, label: 'Marquee tools' };
  }
  if (LASSO_TOOL_DEFINITIONS.some(({ id }) => id === tool.id)) {
    return { definitions: LASSO_TOOL_DEFINITIONS, label: 'Lasso tools' };
  }
  if (SMART_SELECTION_TOOL_DEFINITIONS.some(({ id }) => id === tool.id)) {
    return { definitions: SMART_SELECTION_TOOL_DEFINITIONS, label: 'Smart selection tools' };
  }
  if (tool.id.startsWith('shape-')) {
    return { definitions: SHAPE_TOOL_DEFINITIONS, label: 'Shape tools' };
  }
  if (tool.id === 'vector-pen'
    || tool.id === 'vector-add-anchor'
    || tool.id === 'vector-delete-anchor'
    || tool.id === 'vector-convert-anchor') {
    return { definitions: PEN_TOOL_DEFINITIONS, label: 'Pen tools' };
  }
  if (PATH_SELECTION_TOOL_DEFINITIONS.some(({ id }) => id === tool.id)) {
    return { definitions: PATH_SELECTION_TOOL_DEFINITIONS, label: 'Path selection tools' };
  }
  if (tool.role === 'text') {
    return { definitions: TEXT_TOOL_DEFINITIONS, label: 'Text tools' };
  }
  if (tool.id === 'gradient' || tool.id === 'fill') {
    return { definitions: FILL_TOOL_DEFINITIONS, label: 'Gradient and fill tools' };
  }
  if (TONE_TOOL_DEFINITIONS.some(({ id }) => id === tool.id)) {
    return { definitions: TONE_TOOL_DEFINITIONS, label: 'Tone tools' };
  }
  return null;
};

export const EditorToolbar: React.FC<EditorToolbarProps> = ({
  documentKind = 'image',
  activeTool,
  foregroundColor,
  backgroundColor,
  onToolChange,
  onZoomActual,
  onForegroundColorChange,
  onBackgroundColorChange,
  onSwapColors,
  onResetColors
}) => {
  const [expanded, setExpanded] = React.useState(false);
  const toolbarRef = React.useRef<HTMLElement>(null);

  React.useEffect(() => {
    if (!expanded) return undefined;
    const closeOnOutsidePointer = (event: globalThis.PointerEvent) => {
      if (!toolbarRef.current?.contains(event.target as Node)) setExpanded(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setExpanded(false);
      }
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer, true);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer, true);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [expanded]);

  if (documentKind !== 'image') {
    // The toolbox rail is part of the persistent workspace geometry. Keep it
    // mounted for every document kind so Dockview always occupies the second
    // grid column; only its document-specific commands change. Video and 3D
    // intentionally expose no image-editing tools yet.
    return (
      <nav
        ref={toolbarRef}
        className="lighttable-toolbox"
        aria-label={documentKind === 'video' ? 'Video tools' : '3D tools'}
        data-editor-floating-surface
        data-document-kind={documentKind}
      >
        <div className="lighttable-toolbox__content" />
      </nav>
    );
  }

  return (
    <nav ref={toolbarRef} className="lighttable-toolbox" aria-label="Image tools"
      data-editor-floating-surface>
      <div className="lighttable-toolbox__content">
      {toolbarToolDefinitions(import.meta.env.DEV).map((tool) => {
        const family = toolFamilyFor(tool);
        if (!family) {
          return (
            <ToolButton
              key={tool.id}
              tool={tool}
              active={activeTool === tool.id}
              onClick={() => onToolChange(tool.id)}
              onDoubleClick={tool.id === 'zoom' ? onZoomActual : undefined}
            />
          );
        }
        if (tool.id !== family.definitions[0]?.id) return null;
        return (
          <ToolFamilySlot
            key={family.label}
            activeTool={activeTool}
            definitions={family.definitions}
            expanded={expanded}
            label={family.label}
            onExpandedToolChosen={() => setExpanded(false)}
            onToolChange={onToolChange}
          />
        );
      })}
      <ButtonBase
        type="button"
        className={`lighttable-toolbox__button lighttable-toolbox__expand-all${expanded ? ' lighttable-toolbox__button--active' : ''}`}
        aria-expanded={expanded}
        aria-label={expanded ? 'Collapse all tool submenus' : 'Expand all tool submenus'}
        title={expanded ? 'Collapse all tool submenus' : 'Expand all tool submenus'}
        onClick={() => setExpanded((current) => !current)}
      >
        <img src={lightTableIcon('more_horizontal.png')} alt="" aria-hidden="true" />
      </ButtonBase>
      <div className="lighttable-toolbox__colors" aria-label="Foreground and background colors">
        <ButtonBase
          type="button"
          className="lighttable-toolbox__reset-colors"
          onClick={onResetColors}
          title="Reset foreground and background colors"
          aria-label="Reset foreground and background colors"
        >
          <span />
          <span />
        </ButtonBase>
        <ButtonBase
          type="button"
          className="lighttable-toolbox__swap-colors"
          onClick={onSwapColors}
          title="Swap foreground and background colors (X)"
          aria-label="Swap foreground and background colors"
        >
          ↔
        </ButtonBase>
        <ColorSwatchField className="lighttable-toolbox__color lighttable-toolbox__color--background"
          size="chip" value={backgroundColor} onChange={onBackgroundColorChange}
          ariaLabel="Background color" />
        <ColorSwatchField className="lighttable-toolbox__color lighttable-toolbox__color--foreground"
          size="chip" value={foregroundColor} onChange={onForegroundColorChange}
          ariaLabel="Foreground color" />
      </div>
    </div>
    </nav>
  );
};
