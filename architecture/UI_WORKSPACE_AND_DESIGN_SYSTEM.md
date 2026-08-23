# UI, workspace and design system

LightTable owns its entire UI, CSS, icons and interaction language. Hosts mount
the product and provide capabilities; StoryBuilder is not a design-system or
asset dependency. The same shared UI runs in web and Electron.

## High-level UI governance decision

The UI is treated as a product feature and a future reusable suite library, not
as styling added independently by feature screens. Buttons, selectors, sliders,
fields, lists, paint controls and containers should compose a small set of
canonical production primitives. A feature-specific implementation is allowed
only when its interaction really differs; visual similarity alone is a reason
to reuse an existing primitive.

The Style Guide is the living visual catalog for those real production
components. Stable metadata connects each rendered control to its canonical
identity, usage count and source locations. This supports a bidirectional
workflow: inspect a control in the running application to find its definition
and status, or select a catalog entry to reveal its mounted instances in the
application. Unregistered interactive elements are shown separately as cleanup
candidates, so established good controls remain distinguishable from accidental
one-off implementations.

Inspection is optional development tooling, not application architecture. It
reads DOM metadata and draws temporary overlays but has no access to documents,
layers, tools, rendering or editor state. Normal web and desktop builds omit
the inspector runtime and its UX entirely; an explicit UI-devtools build adds
the catalog and two-way inspection host. This keeps UI governance strict without
making the production application depend on the governance tools.

## Workspace

The workspace supports multiple open documents and exactly one active
document. Document tabs switch the canonical document, history, document
selection/active layer, viewport and source/revision context beneath one
persistent editor/canvas runtime. The active tool, tool options and Dockview
layout are application/editor state: they remain stable across document tabs
and workspace presets. If the active document cannot support a tool, the
overlay and controls project that capability explicitly; they do not silently
change document content or resurrect a document-private tool state.

Only one Dockview shell, canvas and `LightTableEditorOverlay` are mounted.
Inactive `DocumentSession`s retain canonical data and history, not hidden
workspace trees or active render loops. Rebinding must commit/cancel any live
gesture through its controller, reject stale async results and render the newly
active session without copying pixels between documents.

Panels have stable IDs and can be docked, tabbed, resized and floated. Dockview
owns the panel/group layout mechanics and serialized layout graph;
`workspacePanelRegistry.ts` owns which LightTable panels exist and their fresh
workspace placement. LightTable owns panel content, constraints, tokens and
interaction policy. Neither Dockview state nor DOM nodes are document content.
Properties, Layers, Scopes, Debug and future media/AI/3D panels use this same
registry/host contract. Properties is a contextual shell: Grade, Lens Fx,
Text and Layer Effects remain independently owned editors, and exactly one is
mounted for the current Layers-tree target. Floating panels must remain recoverable on
window/display changes.

The built-in fresh-workspace profile currently creates:

- a floating `Layers` group within the document host at roughly 260 x 370;
- `Channels` and `Scopes` as initially inactive tabs in that group;
- a 250-pixel `Properties` group docked to the right of the document host;
- `Assets`, `GenAI`, `Agent`, `Actions` and `Debug` as tabs in the Properties group.

`Actions` is the local discovery and proving surface for the semantic command
catalog. It groups commands by product category and shows live availability,
scope, effect class and current Agent/MCP rollout. Direct parameter-free
commands can be played through the normal application command service;
parameter commands remain read-only until a typed editor exists. The panel is
not a JSON console, document-state owner or alternate automation executor.

A valid persisted Dockview layout takes precedence over these fresh-workspace
positions. This is workspace preference only: switching documents must not
replace it, and opening a saved image document must not deserialize Dockview
nodes into the scene model.

The status bar exposes direct, keyboard-focusable switches for the three
primary workspace presets. `Photo edit` uses the canonical fresh layout;
`Gen AI` docks GenAI/Agent left and activates Assets right; `Grading` activates
Scopes in a left column while retaining contextual Properties on the right and Layers as a
floating group. Applying a preset persists its Dockview graph. A manual dock
change marks that graph `custom` and clears the active preset indication.
Switching presets rearranges/activates panels only. It must preserve the active
document, canonical layers/pixels, current tool and valid floating-panel
placement. Returning to a preset restores that preset's persisted layout rather
than manufacturing a layout from document data.

## Design tokens and controls

Shared visual meaning uses LightTable-owned tokens for surfaces, headers, tab
strips, active tabs, borders, text hierarchy, selection, focus, sliders,
scrollbars and layer states. Repeated controls use shared components; a new
feature must not introduce a private dropdown, button, slider or switch style.

Feature-specific layout may have local CSS, but it composes the shared tokens
and primitives. Removing visible browser focus rings requires an intentional
keyboard-focus replacement, not `outline: none` globally.

Component CSS owns internal geometry under the component's own root class.
Containers may define flow, available width, clipping and placement, but must
not silently restyle a descendant component. A genuine contextual geometry
change is an explicit component variant, such as `AdjustmentSlider`'s
`layer-row`, `tool-bar` and `tool-panel` layouts. The Style Guide follows the same rule: specimen wrappers
provide available space but do not repair or fork component internals. Run
`npm run audit:ui-boundary` to enforce the source boundary and reject every
feature stylesheet that reaches into a UI-owned component root.

### Canonical Layers tree

The Layers tree has one geometry contract. `layerTreeGeometry.ts` owns numeric
geometry used by React and its `--lt-layer-*` CSS counterparts own layout:
28-pixel minimum rows, 16-pixel nesting, 42-pixel square thumbnail cells,
40-pixel maximum thumbnail content and a fixed 46-pixel status column. Content
may be smaller but may never resize a slot or create horizontal overflow.
Raster, vector and text thumbnails are evaluated previews, including their
layer transform, and use `object-fit: contain`; they are not stretched document
snapshots.

The row-state vocabulary is deliberately small and ordered: base, hover,
multi-selected, then active target. Multi-selection uses the selected surface;
the active target adds the accent border and active surface. Keyboard focus
adds the shared focus ring without changing selection. Pixel and mask targets
use the accent inside their bounded thumbnail. A disclosure exists only for a
group or for a layer with present attached processing or Layer Effects. An
attached local Grade is shown as an indented Grade-icon + `Grade` child beneath its
owning raster layer; it is not compressed into the row's status column, which
remains available for Layer Effects and other layer state. Mask cells and
processing/effect children exist only when their canonical data exists;
disabled-but-present items remain shown with their visibility state. Dormant
default effects are never synthesized in the tree. Drawable-layer disclosures
for attached processing and Layer Effects sit at the trailing edge of the row;
group hierarchy disclosures remain before the group thumbnail.

New adjustment layers, including Grade Layers, start with an enabled, linked,
full-white raster mask. The adjustment and mask thumbnails are both visible in
the new layer row immediately; removing that mask remains an explicit user
action. Layer-local attached Grade does not synthesize a separate layer mask.

### Canonical property controls

Panels use these primitives rather than feature-local visual copies:

- `ActionButton` for labelled actions, with `regular`, 28-pixel `control` and
  `compact` density variants; these are contextual densities of one component,
  while disabled and destructive are states/intent, not additional button
  families. `SquareIconButton` is the icon-only action;
- `SwitchControl` for an entire section/effect and a native labelled checkbox
  for a compatibility boolean inside a section;
- `AdjustmentSlider` / `PanelNumberSlider` for continuous numeric values and
  `MixedNumberInput` or `ToolOptionNumber` for precise/mixed values;
- `PanelSelectField` or `ToolOptionSelect` for finite choices;
- `ColorSwatchField` as the shared manual/sampled solid-color value,
  projected by `PanelColorSwatch` and `ToolOptionColor`, plus the shared
  gradient editor for gradient paint values;
- `PanelAngleControl` for dial, keyboard and numeric angle input;
- `PanelAdvancedDisclosure` for Photoshop/interchange parameters that are
  preserved but are not part of the frequent editing path.
- `PanelFileField` for a labelled file action with click and drop support, and
  `lighttable-property-stack` when multiple full-width property rows must be
  stacked with canonical spacing.

Grade and Lens Fx share `AdjustmentSlider` and `SwitchControl`; Text and vector
Shape/Gradient properties share `ToolOptionControls`; Layer Styles now compose
the same panel controls. Common controls stay visible first. Compatibility
controls remain editable under **Advanced** and are never discarded. Layer
Styles are an editor inside contextual Properties, not a modal property language.

`GradientField` is the canonical compact gradient preview/dropdown trigger in
toolbars and property rows. The shared gradient editor owns only the
domain-specific ramp and draggable stops; its buttons, colors and numeric
controls compose `ActionButton`, `PanelColorField` and `PanelNumberSlider`.
A gradient feature must not add private range, button or swatch styling.

In a UI-devtools build, the live catalog is available from **View > UI Style
Guide...**. It uses the
production components themselves and groups them into Foundations, Actions,
Fields, Selection, Sliders, Paint & color, Gradients, Lists & navigation,
Containers, Layout & geometry, Coverage & usage, Feedback, Adjustment dialogs
and Dialogs. Actions execute commands;
persistent choices such as checkboxes, switches and segmented controls belong
to Selection. Every new shared control or canonical dialog
composition must be added there. The catalog is also a visual regression target:
it documents heading/body/help/error hierarchy, control states, keyboard focus,
and the standard dialog order of header, content, then right-aligned secondary
and primary actions.

### Canonical identity and customness audit

Every catalogued production primitive carries a stable
`data-suite-control="<manifest-id>"` marker on its owning DOM root. Explicit
geometry or visual variants additionally publish `data-suite-variant` where
that helps inspection. These attributes are development metadata and semantic
identity; feature code must not forge them onto a private lookalike. Canonical
IDs, families, public symbols, CSS roots and current extraction state live in
`src/ui/uiComponentManifest.json`.

`npm run generate:ui-inventory` scans product source and regenerates the
deterministic `generatedUiUsageInventory.json`. The Style Guide's **Coverage &
usage** page combines that static inventory with a runtime DOM scan outside the
guide. It reports production usages, mounted canonical instances, source
contexts, external CSS overrides and visible interactive elements without a
canonical compound-control owner. A compound control may own its native
internal buttons or inputs; a panel, dialog or layout container never hides
unregistered descendants from the scan.

`npm run audit:ui-boundary` verifies manifest runtime metadata, checks that the
generated inventory is current and applies `uiAuditBaseline.json`. Existing raw
elements and deep selectors remain visible debt. Their per-file counts may
decrease, but a new source location, a higher count, a new external canonical-
root override or deep-selector growth fails the audit. Regenerating inventory
cannot waive that failure; changing the baseline requires explicit design-
system review.

Usage count alone never makes a specialized control wrong. The strong
customness signal is low reuse combined with local styling, raw native markup,
new deep cascade or visual similarity to an existing canonical family.

Inspection is bidirectional and remains outside application state. On Windows,
Ctrl+Shift+Alt-clicking a visible interactive element opens **Coverage & usage**
at its canonical identity; macOS uses Cmd+Shift+Option-click. Registered
controls resolve through `data-suite-*` metadata, while a private interactive
element is explicitly reported as unregistered. **Show in app** closes the
catalog, outlines the current live instance and provides previous/next
navigation across the other mounted instances. The inspector host observes the
DOM and applies temporary overlay attributes only: it must never import or
mutate document, layer, tool, panel or editor state. Opening the catalog from a
product menu uses the same generic DOM event so the host remains replaceable.

### Optional devtools build boundary

The Style Guide, coverage scanner and bidirectional inspector are host-provided
development tools. `@lighttable/app` exposes them only through the separate
`@lighttable/app/ui-devtools` entry point. The base `LightTableStandaloneApp`
does not import, mount or initialize that entry point and merely accepts an
optional `onOpenStyleGuide` contribution. Without that contribution the View
menu does not expose the Style Guide command.

Normal desktop and web builds leave `LIGHTTABLE_UI_DEVTOOLS` unset and must not
contain the inspector runtime. Use `npm run dev:desktop:ui-devtools`,
`npm run dev:web:ui-devtools`, `npm run package:desktop:ui-devtools` or
`npm run build:web:ui-devtools` only when inspection is wanted. The build
boundary verifier checks both directions: inspector signatures must be absent
from normal bundles and present in devtools bundles. The desktop base smoke test
also verifies at runtime that neither the View command nor the modifier-click
gesture exists. Product, document, renderer and editor-domain code must never
import the devtools entry point.

The current modal is LightTable's embedded host, not the long-term owner of the
catalog. Package extraction creates one standalone suite Style Guide next to
the shared controls. LightTable and future products keep only thin embedded
inspection adapters that consume that catalog and contribute runtime usage
data; they never maintain product-local copies of specimens.

`SegmentedControl` has a `low-attention` variant for persistent secondary
navigation such as workspace switches in the status bar. It keeps the selected
option fully opaque and renders inactive options at half opacity without an
accent fill; selection-mode and other primary segmented controls retain the
standard treatment.

The first combined catalog review exposed a remaining typography-system gap:
panel titles, section headings and control-group headings are not yet distinct
enough, while ordinary documentation text is often too heavy. A focused token
pass must rationalize those roles and then audit existing screens against the
catalog; feature-local font-size or font-weight fixes are not an acceptable
substitute.

The app-wide inventory, convergence rules and package boundary are
recorded in `architecture/research/LIGHTTABLE_UI_SYSTEM_AUDIT.md`. Extraction to
a separate UI package is deliberately gated on removing editor-domain imports
from primitives and co-locating their tokens, CSS and tests. A package boundary
must follow the component contract; it must not be used to disguise duplicate
controls.

The repeatable `npm run audit:desktop:panel-language:build` matrix checks compact
and wide windows at 100% and 200% device scale against a nested PSD. It asserts
square bounded thumbnails, aspect containment, fixed tree width, visible
keyboard focus, page-error freedom and large-stack scroll-frame latency, and
writes screenshots plus JSON evidence under `tmp/panel-language-audit/`.

## Interaction contract

- Menus, dropdowns and panels return shortcuts to the editor unless a text
  field intentionally owns them.
- Tool property bars and pointer-local quick settings bind to the same command
  and settings model.
- Continuous UI gestures publish at most once per animation frame and commit
  one history entry.
- Disabled controls stay spatially stable and explain unavailable semantics.
- Layer rows use fixed layout slots for thumbnails/status icons; thumbnails
  preserve aspect ratio inside a bounded box.
- Status and errors live in the status/debug systems, not transient layout
  shifts above the canvas.

Current detailed interaction specs live under `ux/`. UI reference images under
`ui/` are visual direction, not executable contracts. When a spec and current
code disagree, verify whether the spec is an active target before changing
working behavior.

## Current visual direction

The references in `ui/` capture one shared interaction language and several
valid Dockview layouts, not four competing workspace defaults:

- a compact start surface for Open, New document and recent files;
- a fixed top menu, tool-specific property bar and document tabs;
- a narrow left tool rail and canvas-centered editing surface;
- Layers, Channels and Scopes hosted by the same dock/tab/floating system;
- contextual Properties hosting the separate Grade, Lens Fx, Text and Effects editors,
  switches, sliders and tokens;
- vector/path overlays drawn over the document without modifying its pixels.

The current workspace registry and persisted Dockview profile decide actual
placement. Screenshots never override panel IDs, layout serialization or code.
