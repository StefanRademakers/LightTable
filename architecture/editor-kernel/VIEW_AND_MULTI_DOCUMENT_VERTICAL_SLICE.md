# View and multi-document vertical slice

Status: active; pan and zoom accepted, remaining S12 presentation lifecycle open.

## Contract

Viewport state is committed per document but is not document content and never
creates history. Pointer-frequency pan/zoom work is retained outside React and
may publish only through the exact document/setter owner captured at gesture
admission. React projects that state into chrome and supplies current geometry;
it does not become a second gesture or frame owner.

One input pointer has one owner until release, cancellation or a document-owner
change. Middle-button pan is independent of the selected editing tool and its
modifiers. Modifier chords are resolved before the selected tool: temporary
Zoom Out owns Alt+Space completely, so Brush/Gradient Alt-eyedropper behavior
cannot intercept its pointer.

Queued display frames carry the same owner identity. A tab/document/setter
change prepares a pure candidate during render, then atomically commits the new
owner and clears transients in `useLayoutEffect` before paint/input; callbacks
and zoom/marquee terminal paths validate that identity again. An old
gesture is never relabelled with the newly active document.

## Owners

- `ViewportPanGestureOwner` retains the initiating pointer, opening view and
  opening document-frame owner.
- `ViewportPresentationController` binds one document/setter identity and owns
  pan plus latest-frame pan/zoom publication and cancellation.
- `viewportPointerRouter` owns modifier precedence as pure policy.
- `useViewportInteractionController` remains the DOM/React adapter for pointer
  sampling, capture and document-coordinate projection. It may call the owners;
  it does not own scheduled frame publication.
- each document session owns its persisted viewport. The document model,
  renderer and history do not own pan or zoom.

## Accepted behavior

- View tool, Space temporary pan and middle-button pan share one retained owner.
- Middle-button pan works under Ctrl/Alt/Shift and records no history.
- Wheel pan/zoom, exact 100%, fit, stepped zoom, rectangle zoom, Ctrl+Space Zoom
  In and Alt+Space Zoom Out use document-bound publication.
- A middle-pan or zoom gesture begun in document A is cancelled if Ctrl+Tab
  activates document B before move/up. Neither viewport changes.
- Pointer-up flushes the last admitted pan coordinates instead of losing the
  final sub-frame movement.
- Document projection and the 32 px edge zones are anchored to the measured
  `.lighttable-viewport`, never the window or workspace. The same exact 80x60
  document-space marquee copies at `{x:100,y:120}` under floating Layers,
  docked Scopes/Properties and visible rulers/tool options.

## Evidence

- App and desktop typechecks pass.
- 178 focused input, geometry, keyboard and workspace tests pass.
- Instrumented desktop packaging and distribution/telemetry boundaries pass.
- `smoke-desktop-zoom.mjs` passes against `shapes.psd`: exact/fit/stepped and
  rectangle zoom, both temporary zoom chords, modifier-heavy middle pan,
  history invariance, and two-document mid-gesture cancellation.
- Independent critic repair 1 found cross-document active-gesture leakage.
  Repair 2 bound pan and zoom to their opening owner; final verdict PASS with no
  remaining P0/P1. The post-extraction critic caught render-time cancellation
  and a later passive-effect race; both were removed and its final verdict is
  PASS with no remaining P0/P1.
- `smoke-desktop-viewport-layout.mjs` passes packaged marquee/copy projection
  across 1312 px Photo Edit and 1012 px Grading viewports plus visible rulers.
  Screen-mode and floating-panel-resize smokes pass; focused edge-zone tests
  prove local viewport offsets after dock changes. Independent critic: PASS.

## Structural decision

`useViewportInteractionController.ts` is still an oversized legacy adapter.
This sub-slice moves retained pan state and coalesced pan/zoom frame publication
to two single-purpose application-input owners. The hook's textual diff grows
because it adds explicit capture and generation checks, but it loses those two
authorities; new behavior must extend the owners, not add another hook-local
scheduler or drag ref. The next S12 extraction is panel/pasteboard geometry and
edge-zone projection.

## Still open

- first-correct-frame behavior on tab switch, close/reopen and renderer rebind;
- background/minimize/restore and foreground-loss terminal policy;
- hidden-document transient resource release without committed-resource loss.
