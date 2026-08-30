import { ButtonBase } from '../../../ui/ButtonBase';
import React from 'react';
import { Toolbar, ToolButton as PackageToolButton, type ToolbarTool, type ToolbarGroup } from '@lighttable/ui';
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

export const toolbarTool = (tool: ToolDefinition): ToolbarTool<ToolId> => ({
  value: tool.id, label: tool.label, shortcut: tool.shortcutLabel,
  icon: <img src={lightTableIcon(tool.iconName)} alt="" />
});

/** Domain adapter also used in the contextual tool settings panel. */
export const ToolButton = ({ tool, ...props }: { tool: ToolDefinition; active: boolean; detailed?: boolean; onClick: () => void }) =>
  <PackageToolButton {...toolbarTool(tool)} {...props} />;

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
  const items: Array<ToolbarTool<ToolId> | ToolbarGroup<ToolId>> = [];
  for (const tool of toolbarToolDefinitions(import.meta.env.DEV)) {
    if (documentKind !== 'image') {
      if (documentKind === 'video' && (tool.id === 'view' || tool.id === 'zoom')) {
        items.push({ ...toolbarTool(tool), onDoubleClick: tool.id === 'zoom' ? onZoomActual : undefined });
      }
      continue;
    }
    const family = toolFamilyFor(tool);
    if (!family) items.push({ ...toolbarTool(tool), onDoubleClick: tool.id === 'zoom' ? onZoomActual : undefined });
    else if (tool.id === family.definitions[0]?.id) items.push({ value: family.label, label: family.label, tools: family.definitions.map(toolbarTool) });
  }
  return <Toolbar items={items} value={activeTool} onChange={onToolChange}
    label={documentKind === 'image' ? 'Image tools' : documentKind === 'video' ? 'Video tools' : '3D tools'}
    data-document-kind={documentKind} data-editor-floating-surface data-editor-native-tab-navigation
    extension={documentKind === 'image' ? (
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
    ) : undefined} />;
};
