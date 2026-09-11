# View and multi-document vertical slice

Status: active; pan, zoom, layout geometry, first-correct-frame ownership and
foreground lifecycle accepted. Hidden-document transient-resource policy remains.

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

The desktop host owns native foreground truth and distinguishes active, blurred,
minimized and hidden states. Every foreground loss synchronously cancels admitted
mutable gestures before renderer suspension. Blur retires interactive readiness,
but an owner-matched frame already proven for the same document and renderer
generation remains resident and visible. Minimize or hide also retires visible
residency because the swap-chain surface is not durable there. Resume registers
a new monotonic presentation attempt, re-blits the retained final texture into
the swap-chain surface, and exposes input/tool projections only after that
attempt's GPU and compositor boundary completes. It does not recompute the
canonical document graph or manufacture history.

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
- A tab switch or renderer generation invalidates the retained canvas in a
  layout effect before paint. Canvas, selection and tool projections remain
  hidden and input-inert until that exact document/renderer generation has
  presented.
- Presentation waiters and delayed thumbnails carry document id, presentation
  epoch, renderer object and renderer generation. Rapid A -> B -> A cannot let
  an old A waiter release the newer A gate or publish B as A's thumbnail.
- Closing a document disposes its session; reopening the same source creates a
  new session that crosses the same pending-hidden -> presented-visible gate.
- Native minimize, hide and blur suspend the application renderer and its
  interactive active-document projection. During blur the last owner-matched
  canvas frame stays visible while input and transient tool projections remain
  blocked. Minimize/hide keep the surface hidden until a new presentation attempt
  completes. No background frame is submitted while inactive.
- Foreground loss cancels an active marquee before suspension; it creates no
  history entry and the next admitted gesture commits exactly once.
- Suspend retires pending presentation and first-frame generations. A stale GPU
  completion or double-rAF cannot expose a restored surface, publish startup
  timing or consume deferred first-frame initialization.
- Refocus performs one bounded viewport re-blit from the retained final texture
  while the proven resident frame remains visible without a loading placeholder.
  Restore after minimize/hide performs the same re-blit while the canvas remains
  pending-hidden/loading until certified. Neither path requires a document-
  composite replay burst.
- A document rebind first invalidates pending renderer work, then releases all
  active presentation scratch and document-specific interaction projections.
  This includes the GPU-only smart-selection candidate mask. Shared canonical
  layer pixels/masks, pattern/LUT assets and history surfaces are not part of
  that detach and remain available for exact tab return and undo.

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
- `smoke-desktop-document-pixel-retention.mjs` passes five packaged A/B cycles,
  a rapid unsettled A -> B -> A switch and close/reopen. Every activation first
  records `pending + hidden` and then `ready + visible`; same-session pixels and
  layer identities remain exact. Reopen preserves source-equivalent geometry,
  alpha and appearance. The critic found and closed one stale thumbnail-timer
  P1, then passed both the repair and the extraction with no remaining P0/P1.
- The same packaged smoke now passes native minimize/restore, blur/refocus,
  interrupted-marquee rollback, post-cancel gesture recovery and immediate
  minimize/restore while a document-rebind presentation is pending. Telemetry
  records zero inactive submissions and at most three resume submissions;
  restored pixels remain source-equivalent. It also proves an owner-matched
  resident frame stays pixel-equivalent and visible without the loading
  placeholder during blur, while minimize and a pending document rebind remain
  hidden. The foreground critic found and closed stale presentation-generation
  and first-frame-completion races.
- `WebGpuEngine.presentation.test.ts` proves suspend re-arms first-frame
  ownership when an in-flight completion is retired.
- The same focused suite proves document detach clears every pointer-hot overlay
  family without calling any canonical repository release boundary. Repository
  tests separately prove exact pixel retention across facade rebind and release
  only on explicit document close. The critic found the initially omitted
  smart-selection mask texture; repair 1 releases that texture through
  `setMask(null)`, and the second review passes with no remaining P0/P1.

## Structural decision

`useViewportInteractionController.ts` is still an oversized legacy adapter.
This sub-slice moves retained pan state and coalesced pan/zoom frame publication
to two single-purpose application-input owners. The hook's textual diff grows
because it adds explicit capture and generation checks, but it loses those two
authorities; new behavior must extend the owners, not add another hook-local
scheduler or drag ref. First-frame and thumbnail ownership now live in the
single-purpose 120-line `useWorkspaceDocumentPresentation.ts`; the editor root
is 65 lines smaller than before this sub-slice instead of absorbing another
presentation authority.

## Status

Complete. The final system-wide undo/redo, route-equivalence, recovery and soak
matrix remains S13 work rather than view/multi-document ownership work.
