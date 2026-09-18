# MediaVibe UI package extraction audit

Date: 2026-09-13

## Decision

The extraction gates identified below were completed on 2026-09-13. The former
in-repository package and guide now live in the independent sibling workspace
`D:\mediavibe\MediaVibeUI`; LightTable consumes compiled `@mediavibe/ui` output
through one public package contract. The old package, guide and launchers were
removed from LightTable so there is no parallel implementation authority.

The remaining release concern is operational rather than architectural: assign
the sibling workspace its own remote/CI channel and replace the local file
dependency with a pinned released package before multi-machine distribution.

## Evidence and current boundary

The audit covered the public exports and imports of the former `packages/ui`, its
standalone catalog, package metadata, LightTable imports, raw HTML controls and
repeated app-local UI patterns.

- At extraction the package contained 102 source/style files, including 42 CSS files.
- LightTable imports `@mediavibe/ui` from 99 source and test files.
- No package source imports LightTable, editor document state, commands,
  history, renderer, WebGPU resources, Dockview or host services.
- Generic package assets are colocated under `MediaVibeUI/packages/ui/src/assets`; domain
  tool icons remain app-owned and are passed through component slots.
- The app still has five CSS files totalling approximately 4,998 lines. Much of
  that is legitimately editor layout, canvas interaction and feature styling;
  it is not a backlog to move wholesale into the UI package.
- The package archive contains compiled ESM, declarations, CSS and source maps;
  raw TypeScript and tests are excluded.
- Package tests are still intentionally focused: `AngleControl`, editor chrome
  and the feedback primitives have colocated tests. App integration tests
  exercise more controls, but they do not prove independent-consumer
  compatibility.

This means the logical dependency direction is already correct. Physical
extraction is primarily a packaging, API-governance and consumer-validation
job, not another editor rearchitecture.

## Existing shared component coverage

The package already covers the central desktop creative-app vocabulary:

| Area | Existing package components |
| --- | --- |
| Typography and actions | `Text`, `Button`, `ButtonBase`, `IconButton` |
| Selection controls | `Checkbox`, `Radio`, `SwitchControl`, `SegmentedControl` |
| Text and numeric fields | `TextInput`, `TextArea`, `SearchField`, `NumberField`, `FieldRow`, `LinkedFields` |
| Choice and file fields | `Select`, `SelectField`, `FileField`, `PathField`, `AnchorGrid` |
| Value controls | `Slider`, `SliderField`, `RangeSlider`, `AngleControl` |
| Paint and color | `PaintField`, `NonePaintField`, `GradientField`, `GradientEditor`, `ColorArea`, `ColorSwatches`, `ColorPicker`, `ColorWheel` |
| Menus and tool surfaces | `Menu`, `MenuBar`, `Toolbar`, `ToolStrip`, `ToolButton` |
| Panels and hierarchy | `PanelSection`, `PanelSectionHeader`, `PanelTab`, `PanelFooter`, `TreeRow`, `TreeButtonRow`, `TreeDisclosure` |
| Editor chrome | `EditorChrome`, header/menu/tool-options/body/panel/status surface components, `DocumentTabs` |
| Visualization | `Histogram`, `ScopesPanel` and scope rendering helpers |
| Modal presentation | `Dialog` |

This is enough to support another MediaVibe desktop media tool without first
building a comprehensive third-party design system.

Several common controls that initially look absent are already covered by a
broader existing contract: `Select` can be searchable and exposes combobox /
listbox semantics; `Menu` supports anchored and pointer-positioned context
menus, nested menus, separators and shortcut labels; `PanelSection` and
`TreeDisclosure` cover accordion/disclosure roles; `Dialog` covers the modal
shell. These should be improved in place rather than duplicated under more
familiar names.

## Missing controls found in real product usage

These are ordered by evidence and value, not by how common their names are in
generic component libraries.

### P0: implemented in the package on 2026-09-13

1. **Toast and toast viewport presentation** — implemented and adopted by the
   LightTable editor notification adapter.

   `EditorToastViewport` currently owns app-local toast markup, tones,
   accessibility and timer interaction. Move presentation plus pause/resume and
   dismiss behavior to the package. LightTable must retain notification IDs,
   queue policy and the decision to emit a notification.

2. **Inline notice/message** — implemented and adopted by GenAI and layer-style
   notices.

   LightTable repeats notice styling for file drop, layer styles, document
   color and GenAI states. Add a compact `Notice` or `InlineMessage` with
   neutral, success, warning and error tones. Its content is supplied by the
   host; it must not interpret exceptions or HTTP/renderer errors.

3. **Progress bar** — implemented and adopted by both agent progress surfaces.

   Two production surfaces use raw `<progress>` elements for agent operations.
   Add an accessible determinate/indeterminate `ProgressBar`; orchestration and
   progress calculation stay with the host.

4. **Busy indicator** — implemented and adopted by the GenAI asset browser.

   GenAI currently has a local spinner. Add a small `Spinner` or
   `BusyIndicator` with accessible-label policy and reduced-motion behavior.

5. **Badge/status badge** — implemented and adopted by Agent Access state.

   Agent connection state and several feature states use independent pill/text
   treatments. Add a presentation-only `Badge` with semantic tones. Domain
   states such as `connected`, depth-generation phases or compatibility remain
   host mappings, not package enums.

6. **Anchored popover infrastructure** — implemented; the existing
   LightTable gradient popover is now a thin host adapter that only supplies
   its floating-panel reference and nested-select exclusion.

   Gradient and color surfaces repeat portal placement, viewport clamping,
   outside-pointer dismissal and Escape handling. Add an `AnchoredPopover` (or
   lower-level anchored-surface hook plus surface) with explicit focus and
   dismissal contracts. Keep menus, selects and dialogs as distinct semantic
   controls even if they share positioning utilities.

### P1: add when a second app proves the contract

- **Tooltip**: the app currently relies heavily on native `title` attributes.
  A keyboard-accessible, delayed tooltip is valuable across the suite, but is
  not required to extract the current package.
- **Generic content tabs**: `PanelTab` and `DocumentTabs` cover current visual
  roles, while Dockview owns editor tab mechanics. Add a controlled `Tabs`
  family only when another app needs ordinary content switching.
- **Empty state / placeholder**: useful shared presentation for unavailable or
  empty panels. Renderer initialization and WebGPU error state must remain in
  LightTable's `DocumentViewportStatus`.
- **Separator/divider** and **skeleton**: add only after repeated real usage;
  they do not justify delaying extraction.

### Existing local patterns that should not become generic controls

- Hidden native file inputs are host capability bridges, not missing fields.
- `TextInputBridge` is a canvas text-editing bridge, not a replacement
  `TextArea`.
- Crop/transform handles are spatial interaction controllers, not buttons.
- Dockview layout, floating-window recovery and document tabs' editor binding
  remain host adapters.
- Adjustment gradients, ranges, formatting and history boundaries remain
  LightTable domain adapters around package sliders.
- Document color extraction, palette persistence and screen sampling remain
  host capabilities around package color controls.
- WebGPU loading/error text and recovery policy remain application state, even
  if their visual shell later composes `Notice` or `EmptyState`.
- Preferences, confirmation and new-document flows should compose package
  dialogs. Their forms and commands do not belong in the package. The
  Preferences dialog still uses legacy modal markup and is a migration task,
  not evidence for a second dialog implementation.

## Independent-package gates

1. Completed: `@mediavibe/ui` exports compiled ESM, declarations, CSS/fonts and
   explicit subpaths from `dist`; archive verification is automated.
2. Completed: the package has a self-contained workspace, TypeScript/build
   configuration and explicit dependencies.
3. The React peer range is tied to the current LightTable version. It should be
   an intentional compatibility range, verified in consumers rather than
   copied from the workspace.
4. Public API stability is implicit. Exports need ownership categories,
   deprecation policy and a small changelog/release discipline.
5. Completed: `verify:consumer` packs the artifact, installs it in a clean
   temporary application and bundles every public entry type.
6. Completed: the package and living guide use MediaVibe naming and live outside
   the LightTable repository.

## Controlled extraction plan

### Gate 1 — finish the proven shared vocabulary in place

- The six P0 component families and their first existing consumers are now
  migrated without parallel local skins or fallback components.
- Migrate Preferences to the canonical `Dialog` shell and remove obsolete
  generic modal skin only after all remaining consumers are classified.
- Add focused component tests for behavior with architectural risk: slider
  interaction lifetime, select/menu/popover dismissal, dialog focus, toast
  timers and editor chrome geometry. Do not duplicate all LightTable tests.

### Gate 2 — make the package independently distributable

- Rename to `@mediavibe/ui` inside the monorepo.
- Build compiled ESM, `.d.ts`, CSS, fonts and assets into `dist`.
- Ensure the published archive excludes source tests and repository-only files.
- Add a clean-install smoke test that imports only public entry points.
- Keep one package initially. Add subpath entry points such as
  `@mediavibe/ui/editor` only when bundle size or API ownership creates a
  measured need; do not begin with a network of small packages.

### Gate 3 — prove the boundary outside LightTable

- Install the packed archive in a minimal second app using both themes.
- Exercise at least buttons/fields, a popover or dialog, panel chrome and the
  status/workspace bar.
- Confirm that no LightTable CSS, root reset, editor service or monorepo path is
  required.
- Only after this gate move it to a sibling directory, separate repository or
  private registry. LightTable then consumes a pinned released version, not a
  relative source path.

## Cost and risk

Indicative focused effort, assuming no redesign of the existing controls:

| Work | Estimate |
| --- | ---: |
| P0 controls and existing-consumer migration | 2–4 days |
| Rename and independent build/package output | 1–2 days |
| Package behavior tests and clean consumer smoke app | 2–4 days |
| Separate repository/registry/release automation | 2–3 days |
| First real second-app adoption | 1–3 days per app |

The main risk is not moving directories. It is allowing two authorities to
survive: app-local skins beside package components, or applications importing
package internals instead of public exports. The extraction is successful only
when the packed artifact and public API are sufficient for a second app.

## Recommendation

Use `D:\mediavibe\MediaVibeUI\UI.bat` as the living design-system entry point.
Implement and verify shared controls there, then consume only public exports in
LightTable and other MediaVibe apps. The next infrastructure slice is a remote,
CI and pinned package-release channel; further control additions should still
be driven by real app usage rather than speculative catalog growth.
