import type { ToolId } from '../../editor/session/editorSession';

export type ToolCommitAvailability =
  | 'presentation-only'
  | 'ui-and-command'
  | 'playback-command-only'
  | 'canonical-owner-only'
  | 'not-exposed';

export interface ToolAutomationDefinition {
  readonly interaction: 'presentation' | 'discrete' | 'continuous';
  readonly availability: ToolCommitAvailability;
  readonly capabilities: readonly string[];
  readonly note: string;
}

const presentation = (note: string): ToolAutomationDefinition => ({
  interaction: 'presentation', availability: 'presentation-only', capabilities: [], note
});
const owner = (interaction: 'discrete' | 'continuous', capabilities: readonly string[], note: string): ToolAutomationDefinition => ({
  interaction, availability: 'canonical-owner-only', capabilities, note
});
const uiCommand = (interaction: 'discrete' | 'continuous', capabilities: readonly string[],
  note: string): ToolAutomationDefinition => ({
  interaction, availability: 'ui-and-command', capabilities, note
});

/**
 * Truthful automation status for every toolbar tool.
 *
 * This describes committed document operations, not toolbar button activation.
 * A canonical owner is useful foundation but is not called Actions/MCP support
 * until the real UI commit is captured and equivalence-tested.
 */
export const TOOL_AUTOMATION_CATALOG = {
  view: presentation('Canvas navigation is viewport presentation.'),
  zoom: { interaction: 'presentation', availability: 'ui-and-command',
    capabilities: ['view.setZoom'], note: 'Zoom state has a semantic command; click-drag zoom remains local.' },
  transform: uiCommand('continuous', ['layer.setTransform'],
    'Single-layer affine UI commits record one final matrix; groups, masks and projective transforms remain open.'),
  'select-rectangle': uiCommand('continuous', ['selection.applyShape'],
    'The UI records one final rectangle only after successful selection rasterization.'),
  'select-ellipse': uiCommand('continuous', ['selection.applyShape'],
    'The UI records one final ellipse only after successful selection rasterization.'),
  'select-horizontal': uiCommand('discrete', ['selection.applyShape'],
    'The UI records one final row selection.'),
  'select-vertical': uiCommand('discrete', ['selection.applyShape'],
    'The UI records one final column selection.'),
  'select-free': uiCommand('continuous', ['selection.applyShape'],
    'The UI records the bounded final outline, never pointer-move commands.'),
  'select-polygonal': uiCommand('continuous', ['selection.applyShape'],
    'The UI records the bounded final polygon, never intermediate clicks.'),
  'select-object': owner('continuous', [], 'Smart-selection owner exists; model/result contract is not exposed.'),
  'select-magic-wand': owner('discrete', [], 'Magic Wand owner exists; sampled selection contract is not exposed.'),
  'vector-pen': uiCommand('continuous', ['vector.create', 'vector.update'],
    'Open/closed and resumed Pen paths publish once after commit; anchor and handle previews remain local.'),
  'vector-add-anchor': uiCommand('discrete', ['vector.update'], 'One-shot add records the final native path.'),
  'vector-delete-anchor': uiCommand('discrete', ['vector.update', 'vector.remove'], 'One-shot delete records the final native path or its removal.'),
  'vector-convert-anchor': uiCommand('continuous', ['vector.update'], 'Click/drag conversion records once after commit; previews remain local.'),
  'vector-select': presentation('Vector target selection is editor presentation state.'),
  'vector-direct-select': uiCommand('continuous', ['vector.update'],
    'Selection/marquee remain presentation; anchor, handle and segment edits record once after commit.'),
  'shape-rectangle': uiCommand('continuous', ['vector.create', 'vector.update'],
    'The toolbar publishes one native Rectangle only after its local preview commits.'),
  'shape-ellipse': uiCommand('continuous', ['vector.create', 'vector.update'],
    'The toolbar publishes one native Ellipse only after its local preview commits.'),
  'shape-triangle': uiCommand('continuous', ['vector.create', 'vector.update'],
    'The toolbar publishes one native Triangle only after its local preview commits.'),
  'shape-line': uiCommand('continuous', ['vector.create', 'vector.update'],
    'The toolbar publishes one native Line only after its local preview commits.'),
  'text-point': { interaction: 'discrete', availability: 'ui-and-command',
    capabilities: ['text.create', 'text.replaceRange', 'text.format', 'text.setLayout'],
    note: 'Point text already enters through semantic commands.' },
  'text-paragraph': { interaction: 'continuous', availability: 'ui-and-command',
    capabilities: ['text.create', 'text.replaceRange', 'text.format', 'text.setLayout'],
    note: 'Paragraph text creation and editing already use semantic commands.' },
  'text-vertical': { interaction: 'discrete', availability: 'ui-and-command',
    capabilities: ['text.create', 'text.replaceRange', 'text.format', 'text.setLayout'],
    note: 'Vertical text uses the shared text contract.' },
  'text-path': owner('discrete', ['text.create'], 'Path text has a canonical owner but is not in the current text.create schema.'),
  gradient: uiCommand('continuous', ['vector.create', 'vector.update', 'raster.applyGradient'],
    'Fill-layer and raster modes publish one final paint after commit; drag previews remain local.'),
  fill: uiCommand('discrete', ['raster.fill'],
    'One successful GPU fill publishes one explicit layer/channel operation; pixels and selection stay local.'),
  brush: uiCommand('continuous', ['tool.commitGesture:brush-stroke'],
    'Actions captures one bounded stroke only while recording; pointer updates stay on the local paint hot path.'),
  erase: uiCommand('continuous', ['tool.commitGesture:brush-stroke'],
    'Erase records through the same bounded stroke contract with erase=true.'),
  'healing-brush': uiCommand('continuous', ['tool.commitGesture:brush-stroke'],
    'Final stroke carries a document-relative sampled source; source pixels and dabs remain local.'),
  'clone-stamp': uiCommand('continuous', ['tool.commitGesture:brush-stroke'],
    'Final stroke carries a document-relative sampled source; source pixels and dabs remain local.'),
  dodge: uiCommand('continuous', ['tool.commitGesture:brush-stroke'],
    'One bounded tone stroke publishes after commit; pointer updates stay on the local paint hot path.'),
  burn: uiCommand('continuous', ['tool.commitGesture:brush-stroke'],
    'One bounded tone stroke publishes after commit; pointer updates stay on the local paint hot path.'),
  sponge: uiCommand('continuous', ['tool.commitGesture:brush-stroke'],
    'One bounded tone stroke publishes after commit; pointer updates stay on the local paint hot path.'),
  warp: uiCommand('continuous', ['warp.applyStroke'],
    'UI previews remain frame-coalesced; one bounded layer-source stroke publishes after history commit.'),
  'face-warp': owner('discrete', ['faceWarp.applyOperation'], 'Semantic operations exist but remain experimentally excluded from MCP.' )
} as const satisfies Record<ToolId, ToolAutomationDefinition>;

export const toolAutomationDefinition = (tool: ToolId): ToolAutomationDefinition => (
  TOOL_AUTOMATION_CATALOG[tool]
);
