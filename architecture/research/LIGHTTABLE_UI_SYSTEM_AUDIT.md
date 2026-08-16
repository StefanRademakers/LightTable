# LightTable UI system audit

## Product position

LightTable treats workspace quality as a product feature. Rendering correctness
is not enough: density, rhythm, interaction latency, focus behavior, visual
hierarchy and predictable reuse determine whether prolonged editing feels calm
and professional. The UI Style Guide is therefore executable product
infrastructure, not a gallery assembled after feature work.

## Audit snapshot

The August 2026 source audit found:

- 24 TSX modules in `src/ui` and 43 app-specific TSX modules in
  `lighttable/editor/ui`;
- 155 direct `<button>` occurrences spread across 47 TSX files;
- 56 direct `<select>` occurrences spread across 19 TSX files;
- one canonical single-handle range implementation (`AdjustmentSlider`) and
  one justified multi-handle specialization (`LevelsTrack`);
- a 46.8 KiB shared `primitives.css` beside a 132.6 KiB editor stylesheet that
  still owns many reusable component contracts.

Direct elements are not automatically defects: accessible compound widgets
need native buttons and selects internally. They become a design-system risk
when a feature owns visual geometry, states or keyboard language that should
belong to a shared family.

The live inventory introduced on 16 August 2026 makes this snapshot
repeatable. At that checkpoint it registered 23 canonical controls and 190
production JSX instances. The packaged Style Guide runtime found 77 visible
interactive elements without a canonical compound-control owner in the
exercised document context, four canonical controls with remaining external
CSS ownership and eight selectors at depth four or greater. These are triage
inputs, not 77 asserted visual defects. The checked-in per-file baseline
prevents new raw-control growth while existing cases are migrated deliberately.

The first normalization pass later that day registers 25 catalog entries and
354 product instances. All 137 formerly raw product buttons now route through
`ButtonBase`, and all 27 formerly raw product selects route through
`FormSelect`. The source audit consequently reports zero raw buttons and zero
raw selects and rejects their reintroduction. `ButtonBase` intentionally stays
provisional: it preserves existing feature surfaces while reducing the next
review to one classified queue that can be promoted to Action, Icon, Menu item,
Tab, or List-row variants. The Style Guide opens on the eleven controls that
still need attention; fourteen approved controls and the full inventory remain
available as secondary views.

## Suite-level direction

The target is a creative-suite UI library, not a LightTable screen-component
package. Its visual and interaction language must serve photo, motion/video,
layout/PDF and future sibling tools. LightTable remains the first real consumer
and stress test, but document commands, Layers state, renderers and product
workspaces do not enter the shared component package.

The provisional package boundary is:

```text
@mediavibe/suite-ui
  foundations and tokens
  controls
  patterns
  layout contracts
  React bindings

@mediavibe/suite-ui-devtools
  visual Style Guide
  runtime inspector
  usage and customness audit
```

The names are provisional; the ownership boundary is not. Component visuals
and internal geometry stay with the component. Containers own flow, available
space, clipping and placement. Product examples may consume the package but
may not repair a specimen with descendant CSS.

The canonical Style Guide should ultimately be a standalone development app
owned beside the suite packages, so every sibling product evaluates the same
catalog, matrices and audit data. Product applications may retain a thin
embedded entry point such as LightTable's **View > UI Style Guide...**, but it
must mount or link to that same catalog and add only a product usage adapter.
It may not fork specimens or component CSS. Internal/dev builds can expose the
full inspector; a public build may hide the catalog while retaining the exact
same production controls.

This produces one source with two useful surfaces:

- standalone: suite-wide authoring, visual regression and package review;
- embedded: active-product runtime counts, unregistered-control discovery and
  navigation from a real control back to its canonical specimen.

Canonical runtime metadata joins both debugging directions: the app can
identify the exact public control and variant under the pointer, while the
Style Guide can count and later highlight mounted instances of a manifest
entry. The current milestone implements identity, live counting and
unregistered-control detection. Pointer-to-guide navigation and persistent
cross-surface highlighting are the next devtools layer and must consume the
same metadata rather than introduce another registry.

## Canonical taxonomy

| Family | Canonical production controls | Required catalog coverage |
| --- | --- | --- |
| Foundations | theme tokens | type roles, weights, color/surface roles, control sizes, borders, radii, spacing rhythm |
| Actions | `ActionButton`, `SquareIconButton` | one action language with dialog (36 px), control-row (28 px) and compact (24 px) density; icon, disabled, destructive and focus states |
| Fields | `FormInput`, `NumericExpressionInput`, `MixedNumberInput`, `Panel*Field`, `ToolOption*` | text, numeric, mixed, select, search, file, checkbox and switch |
| Selection | `SegmentedControl` | primary, low-attention, icon-only, disabled and empty/no-selection states |
| Sliders | `AdjustmentSlider`, `OpacitySlider`, `LevelsTrack` | stacked, inline, bare, layer-row, neutral marker, semantic tracks, opacity and multi-handle |
| Paint and color | `ColorSwatchField`, `ColorPicker`, `NonePaintField` | sizes, sampler/chevron accessories, opacity and disabled states |
| Gradients | `GradientField`, `GradientAssetEditor` | regular/compact triggers, color stops, opacity stops, midpoint and help states |
| Lists and navigation | `ContextMenu`, font listbox, Layers tree, document tabs, preference navigation | row geometry, icons, shortcuts, selection, nesting, separators, disabled and empty states |
| Containers | `PanelSection`, property stack, subgroup, toolbar group, popover and modal shell | padding, gaps, header/action slots, collapse and overflow behavior |
| Feedback | status text, notices, compatibility badges and empty/error states | info, warning, error, success, disabled and progress |
| Dialog compositions | shared modal primitives | confirmation, form, destructive, information and complex editor layouts |

The taxonomy intentionally does not force every list to one row height. A
34-pixel command menu, a 30-pixel document tab and the Layers tree solve
different navigation problems. Each semantic family must have one contract;
features may not create a sixth unnamed list language.

## Slider findings

`AdjustmentSlider` already centralizes pointer capture, coalesced preview
publishing, keyboard editing, reset behavior, a final exact commit and the
14-pixel track/18-pixel thumb geometry. Its supported layouts are:

- `stacked`: label/value above the track for property panels;
- `inline`: label, track and value on one row for compact inspectors;
- `bare`: track only inside color and compound editors;
- `layer-row`: the explicit three-column Layers-panel opacity/fill composition.

Track presentation is data, not a second slider implementation. Current
semantic tracks are default amount, luminance, temperature, tint, vibrance,
saturation, hue/custom color and checkerboard opacity. `LevelsTrack` is a valid
specialization because several native range handles share one axis. It should
eventually become a generic `MultiHandleRange`, but it must retain the same
track and thumb tokens.

No feature should introduce another styled `input[type=range]`.

## List findings

The current list families are meaningful but insufficiently componentized:

- `ContextMenu` owns the general 34-pixel command-menu behavior, viewport
  placement, submenus and keyboard navigation;
- the Layers create flyout implements a separate 28-pixel split-action menu;
- the font picker owns a searchable grouped listbox;
- the Layers tree owns fixed thumbnail/status slots, nested rows and subtargets;
- document tabs own horizontal overflow, dirty state, close and preview;
- Preferences owns vertical page navigation.

The Layers create flyout and menu-row markup are the highest-value extraction
target. They should share menu surface, row, separator, shortcut and split-
action primitives while keeping their appropriate density variants.

## Gradient findings

The gradient family is conceptually sound:

- `GradientField` is the value/trigger used in bars and property rows;
- `GradientAssetEditor` is the canonical editor for color stops, opacity stops
  and relative midpoints;
- `AnchoredGradientPopover` owns placement rather than gradient semantics.

The Style Guide must render the trigger sizes and the complete live editor.
Layer Style, text, vector and Gradient Map callers should continue sharing the
same editor instead of forking stop markup or cursor behavior.

## Layout findings

Reusing a button inside an ad-hoc grid is not sufficient reuse. Layout is part
of the component contract. The canonical compositions need explicit catalog
coverage:

- a property field is a 92-pixel label column plus a flexible control column;
- a property stack supplies the vertical rhythm between those rows;
- side panels use `PanelSection` for collapsible header/content geometry;
- toolbars use compact horizontal groups and separators;
- dialogs use header, scrolling content and footer action regions;
- portal surfaces own viewport placement and must not inherit dock clipping.

The Color Lookup file chooser exposed this gap: `ActionButton` was reused, but
the surrounding grid stretched it and supplied no row rhythm. `PanelFileField`,
the 28-pixel button variant and the property-stack contract fix the reusable
composition rather than patching that one panel.

The first geometry pass establishes two token layers. `--lt-space-*` is the
small 2-24 pixel spatial rhythm for otherwise neutral gaps and padding.
`--lt-layout-*` names product geometry that must not drift: menu/property/status
bar heights, document-tab height, section-header height, the 92-pixel property
label column, panel width tiers and tool-popover width. Layer rows retain their
own `--lt-layer-*` contract because their thumbnail and status slots are a
specialized tree geometry, not generic spacing.

The catalog renders property composition at 220, 260 and 320 pixels. These are
comparison widths, not permission to dock below the application's 250-pixel
usable-panel minimum. A narrow embedded inspector may use 220 pixels; a docked
editor panel uses the 260-pixel standard tier and may grow to the 320-pixel wide
tier. Every new panel must be checked at all three catalog widths and in the
actual dock constraint that applies to it.

## Package boundary

A future `@lighttable/ui` workspace package is desirable, but extraction should
follow dependency cleanup rather than lead it. Package-ready code must:

1. depend only on React, browser APIs and UI-owned tokens/assets;
2. expose no document, renderer, adjustment or editor command types;
3. keep placement and accessibility behavior with the component;
4. ship its tokens and component CSS together;
5. provide live catalog examples and interaction tests for every public
   variant.

The first boundary pass moved `AdjustmentSlider`, `PanelControls` and their
base CSS into `src/ui`; `OpacitySlider` and `ColorPicker` no longer import the
editor domain. Icons remain app-owned, the gradient editor still uses Layer
Style value types and several editor compositions still tune child layout with
descendant selectors. The safe sequence is:

1. establish the complete live catalog and taxonomy;
2. extract the remaining menu-row and container contracts into `src/ui`;
3. remove editor/domain imports from that boundary;
4. move component CSS beside the shared boundary and add a public barrel;
5. only then promote the unchanged boundary to `packages/ui`.

Premature packaging would merely freeze the current coupling under a package
name.

### Proposed public surface

| Export group | Package candidates | Required cleanup |
| --- | --- | --- |
| Foundations | `theme.css`, typography and geometry tokens | split LightTable theme values from stable semantic token names only if a second theme is actually needed |
| Actions | `ActionButton`, `SquareIconButton` | replace feature-named danger styling with an explicit action intent |
| Fields | `FormInput`, `SearchField`, numeric inputs, select/file/checkbox property fields | consolidate naming and expose the property composition through the future barrel |
| Selection | `SegmentedControl`, `SwitchControl` | no domain dependency; nearly package-ready |
| Range | `AdjustmentSlider`, `OpacitySlider`, later `MultiHandleRange` | replace remaining ancestry-based editor tuning with explicit variants |
| Paint | swatch, none, compact gradient trigger and color picker | inject or package icons instead of resolving them from the app asset registry |
| Layout patterns | `PropertyField`, `PropertyStack`, `PanelSection`, toolbar group, menu surface/row and anchored popover | separate placement/geometry from editor commands and document state |

`GradientAssetEditor` is not package-ready yet because its public value types
are Layer Style types. Its stop interaction can move only after a neutral
gradient value contract exists. The Layers tree remains application UI: its
geometry tokens may be shared, but its document model, processing children and
commands do not belong in the general package.

For a future sibling product, the package should expose theme tokens,
primitives and domain-free compositions. Workspace policy, document commands,
Layers data and editor-specific inspector selection remain in each product.
Sharing the spatial and interaction language does not require sharing an
application shell or domain model.

## Enforcement

- Every new shared variant appears in View > UI Style Guide before feature use.
- The Style Guide smoke opens every category and asserts required states and
  geometry.
- Feature review searches for raw range controls, private button/select styles
  and duplicated menu/list rows.
- Exceptions name their semantic family and explain why an existing variant is
  insufficient.
- New canonical controls require a manifest entry and stable
  `data-suite-control` identity. New raw-control locations, increased raw
  counts, deep-selector growth and external canonical-root overrides fail the
  UI audit; regenerating inventory is not an exception path.
- Layout regressions are component-contract failures, not feature-polish debt.
- `npm run audit:ui-boundary` prevents UI-owned modules from importing the
  editor domain and prevents any feature stylesheet from selecting a UI-owned
  component root. Contextual geometry must therefore enter through a named
  component prop or variant and is rendered in the Style Guide as that same
  production component.
