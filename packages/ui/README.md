# Shared UI

Clean library for the suite, independent of LightTable editor code. The current
LightTable consumes these segments throughout the app and uses Button for its
standard text actions, including dialogs. Iconbuttons, tabs, menus, disclosures
and other specialized controls remain distinct; they are not text action buttons.
`apps/ui-demo` is the standalone catalog.
Source exports follow the workspace convention; standalone distribution comes later.

```tsx
import '@lighttable/ui/fonts.css'; // once per app; self-hosted Inter 400 and 700
import '@lighttable/ui/styles.css';
import { Text } from '@lighttable/ui';

<main data-ui-theme="dark">
  <Text as="h1" variant="large" weight="bold">Properties</Text>
  <Text as="p">Normal body text</Text>
  <Text variant="small" tone="muted">Supporting information</Text>
</main>
```

## Contract

| Variant | Default size* | Line height* | Intended use |
| --- | --- | --- | --- |
| `small` | 10 px | 14 px | Metadata and compact notes |
| `regular` | 12 px | 18 px | Controls and body text |
| `large` | 14 px | 20 px | Titles and headings |

*Sizes use rem units relative to the browser's default 16 px root. The library
does not fix the document root size; user font scaling and browser zoom remain available.

- Every variant supports `normal` (400) and real `bold` (700).
- `as` supplies semantic HTML, independently of visual size. Headings do not
  silently change weight; choose it explicitly.
- `Text` creates exactly one element; it adds no layout wrappers or margins.
- Apps choose variant, weight and tone. Do not override typography with local
  font-size/weight/family declarations. App CSS may arrange components, not skin them.
- `data-ui-theme="dark"` or `"light"` defines a scoped theme. Nested scopes work.
  On the document root it supplies tokens only, leaving the host's root font
  size and unmigrated UI untouched. LightTable uses this root scope for its
  View > Theme preference, including controls mounted through portals.
  Theme changes affect semantic colors, not type metrics. Light is an initial
  reviewable palette, not a migrated LightTable theme.
- Fonts and styles are explicit imports, without React context or global reset.
  Import fonts before the UI stylesheet. No LightTable CSS is required.
- These six styles are the complete initial scale. Add roles centrally when a
  real new control needs one, rather than adding app-local sizes.
- Generic UI icons belong here as controls need them. Domain icons (brush,
  grading, selection tools, etc.) stay app-owned and are passed into controls
  when an icon slot is supported. Controls own icon sizing, alignment and spacing;
  tintable artwork uses `currentColor`. Do not copy the app's icon collection here.

`MaskIcon` accepts an app-owned monochrome PNG/SVG URL and uses its alpha as a
CSS mask tinted with `currentColor`. Use it instead of an image element for
white tool artwork: light/dark, selected and disabled states then inherit the
control's existing colors. It is decorative; the owning control supplies the
accessible label and icon dimensions. Full-color artwork remains an image.
For light monochrome artwork containing opaque dark details or gray gradients,
`mode="luminance"` preserves that shading instead of flattening it into a silhouette.

Run `npm run dev:ui` to view all six styles, muted text and HTML semantics.

## Button

```tsx
import { Button } from '@lighttable/ui';

<Button onClick={save}>Save</Button>
<Button disabled>Disabled</Button>
<Button intent="destructive" onClick={remove}>Delete</Button>
```

One fixed 28 px border-box height, 12 px horizontal padding, 6 px corners and
regular/normal typography. No size variants yet. Text is rendered directly
inside one native button, without a `Text` wrapper. `type` defaults to `button`
to avoid accidental form submissions; native button props and refs pass through.
Hover, pressed, keyboard focus and disabled states use theme tokens; disabled
buttons cannot execute or receive tab focus. Destructive changes visual intent,
not behavior: the application still owns confirmation and the action itself.
Labels should be plain text; do not put nested interactive elements inside.
Demo theme switches also use the real Button; their temporary CSS was removed.
`fullWidth` explicitly fills the available width without changing the control's
height or skin. Plain buttons otherwise follow their content width.

App controls have `tabIndex={-1}` by default. Dialogs opt into native tab order
with `tabIndex={0}`. This is a host decision, not a global keyboard listener.

## SegmentedControl

Controlled, single-selection group of native buttons. `radiogroup`/`radio` and
`aria-checked` express the one-of-many choice. Supply `label` (accessible group
name), `options` (`value`, `label`, optional `disabled` and `title`), `value` and
`onChange`. One wrapper plus one button per option; no label wrappers. Height
is 28 px; each item's width follows its content and the whole group uses
`max-content`, including in grid/flex containers. There is no stretch variant.
In a narrower container, labels truncate with an ellipsis and retain their full
text in tooltips and accessible names. Values and callbacks preserve string-union
types. `className` is for external placement only, not skinning. An optional
`data-ui-theme` scopes just this control during incremental app migration.
Disabled items do not execute; selecting the current item does not re-emit.
Dark/light colors come from the same control tokens plus selection surface/text.
The demo's Colors page shows these tokens directly, without copied color values.
Options may supply an app-owned `icon` and `ariaLabel`; icon-only options require
an accessible name. Only an icon adds one non-interactive slot span. The package
owns its 14 px size and spacing. Labels still have no wrapper. There are no
app-specific segment variants or option-level CSS classes.

## Sliders and gradient editing

`Slider` is only the track/handle. `SliderField` composes that same control with
its label and formatted value, using `layout="stacked"` (default) or `"inline"`
and `size="regular"` or `"small"`. Typography, geometry and dark/light colors are
package-owned. Apps supply domain ranges, formatting and optional track gradients,
not replacement CSS. Double-click or Shift-click the label/value resets to
`resetValue`; an optional `onReset` can delegate a domain-specific reset.

```tsx
<SliderField label="Exposure" value={exposure} min={-5} max={5} step={0.01}
  resetValue={0} format={v => `${v.toFixed(2)} EV`}
  onChange={previewExposure} onInteractionStart={beginAdjustment}
  onInteractionEnd={endAdjustment} />
```

All three controls separate immediate local feedback from app preview updates.
`onInteractionStart` opens one transaction; `onChange` publishes previews;
`onInteractionEnd` runs once after the final value has been flushed. The app owns
history/commands. Pointer release/cancel, keyboard release and unmount close the
transaction and cancel scheduled work. `publishIntervalMs` accepts a numeric
interval (33 ms by default for scalar/gradient), `0` for direct input, or
`"animation-frame"` (RangeSlider default). LightTable keeps Lens FX at 60 Hz,
Levels on animation frames and video controls on direct input.

`RangeSlider` accepts `values`, accessible handle `labels`, min/max and step.
By default handles cannot cross. `getBounds` and `resolveValues` supply constraints
and coupling without putting Levels gamma or other domain math in the library.
`renderValues` optionally composes numeric fields or readouts below the track.
Pointer and Arrow/Page/Home/End keyboard input use the same constraints.

`GradientEditor` accepts color/opacity stops with stable IDs, position and midpoint.
Add by clicking above/below the ramp; drag stops/midpoints; remove via right-click
or Delete. At least two stops remain per track, with eight maximum by default.
Arrow keys move a focused stop/midpoint. The preview includes midpoint and opacity
interpolation; authored data is never rasterized. `renderColorField` accepts a
host color picker; the default is a native color field. LightTable's adapter keeps
asset metadata and supplies its existing picker. Rendering/document math remains
outside the package. These controls default to `tabIndex={-1}` like other app
controls; dialogs can opt into tab order.

The **Sliders & gradients** demo includes bare, stacked, compact inline, transparent,
two-/three-handle and gradient examples, with live preview/commit counters.

## Color controls

`ColorPicker` composes `ColorArea`, `Slider`/`SliderField`, `TextInput`, `IconButton`,
`SegmentedControl` and `ColorSwatches`. Each building block is exported separately.
The **Color picker** demo shows the blocks and the complete popover/panel in both themes.

```tsx
<ColorPicker value={color} onChange={setColor}
  documentColors={documentColors} palette={palette} onPaletteChange={setPalette}
  onSample={sampleScreenColor} />
```

RGB and alpha use normalized 0–1 values. Optional `opacity`/`onOpacityChange`
represent paint opacity separately. The package owns color conversions and keeps
hue when RGB is achromatic. The optional `onSample` host capability returns a hex
color or null; `sampleIcon` accepts app-owned artwork. No OS API, document analysis,
storage or recent-color tracking lives in the library. Missing collection props
hide those collections; `documentColorsStatus` supplies a loading/error message.
Palette changes are controlled callbacks, including add and right-click Remove.

Default `variant="popover"` has 320px outer width, limited by available space.
`variant="panel"` fills its width without an outer border; the host owns remaining
panel space. Both keep content at the top with 8px padding/gaps, 4px between sliders,
a 1.55:1 color plane, 28px fields/buttons, and fixed 28px swatches with 6px gaps.
Wider grids add columns instead of stretching swatches. Theme colors reuse existing
tokens; only actual color ramps/contrast markers use literal colors.

`ColorArea` has immediate marker feedback, bounded previews and interaction-end
callbacks through the existing slider scheduler, including cleanup on unmount.
`TextInput` and `IconButton` are single native elements with default `tabIndex=-1`;
fields support explicit text alignment. No app CSS is needed to skin these controls.
