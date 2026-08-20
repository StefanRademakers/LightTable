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
  'vector-add-anchor': owner('discrete', ['vector.update'], 'Vector update can express the result; UI routing is open.'),
  'vector-delete-anchor': owner('discrete', ['vector.update'], 'Vector update can express the result; UI routing is open.'),
  'vector-convert-anchor': owner('discrete', ['vector.update'], 'Vector update can express the result; UI routing is open.'),
  'vector-select': presentation('Vector target selection is editor presentation state.'),
  'vector-direct-select': presentation('Vector anchor selection is editor presentation state.'),
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
  gradient: owner('continuous', ['vector.create', 'vector.update'], 'Vector gradient output is expressible; raster/fill-layer gesture routing is open.'),
  fill: owner('discrete', [], 'GPU fill owner exists; sampled fill properties/result are not exposed.'),
  brush: uiCommand('continuous', ['tool.commitGesture:brush-stroke'],
    'Actions captures one bounded stroke only while recording; pointer updates stay on the local paint hot path.'),
  erase: uiCommand('continuous', ['tool.commitGesture:brush-stroke'],
    'Erase records through the same bounded stroke contract with erase=true.'),
  'healing-brush': owner('continuous', [], 'Renderer-backed sampled stroke owner exists; source/operator contract is open.'),
  'clone-stamp': owner('continuous', [], 'Renderer-backed sampled stroke owner exists; source/operator contract is open.'),
  dodge: owner('continuous', [], 'Tone-brush owner exists; committed operator settings are not exposed.'),
  burn: owner('continuous', [], 'Tone-brush owner exists; committed operator settings are not exposed.'),
  sponge: owner('continuous', [], 'Tone-brush owner exists; committed operator settings are not exposed.'),
  warp: owner('continuous', [], 'Warp session owner exists; final mesh/operation schema and replay are open.'),
  'face-warp': owner('discrete', ['faceWarp.applyOperation'], 'Semantic operations exist but remain experimentally excluded from MCP.' )
} as const satisfies Record<ToolId, ToolAutomationDefinition>;

export const toolAutomationDefinition = (tool: ToolId): ToolAutomationDefinition => (
  TOOL_AUTOMATION_CATALOG[tool]
);
