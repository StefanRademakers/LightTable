# Overlay ownership inventory

Baseline: `df000cc5`, 9,090 physical lines. Read-only inventory by the main agent
and two independent agents, 2026-09-11. Ranges below cover the file; symbols and
domains, not moving line numbers, are the continuation anchors. This is a
responsibility map, not a claim that every interleaving has been tested.

## Responsibility coverage

V = view state/presentation; A = origin/host adaptation; W = construction/wiring;
P = application/domain policy that must leave the composition root. Mixed rows
must be decomposed along the stated owners, not moved wholesale.

| Baseline lines | Kind | Responsibility, state/lifetime and destination |
| --- | --- | --- |
| 1–450 | W | Imports span all domains. Endpoint imports bounded systems and view models, not operation algorithms. |
| 451–522 | A/V/P | Artifact polling, PDF reason labels, grade eligibility and color formatting. Split export waiting from presentation. |
| 523–717 | W | Host props/shared image-video shell. Explicit standalone host support needs classification, not blanket deletion. |
| 718–827 | A/W/P | Provider subscriptions, clipboard host, host activity, fonts, runtime services and session GPU disposer. Session disposer survives tab changes; it is not a React-mount resource. |
| 828–957 | V/P/W | Processing baseline/presentation, layer selection, rename gesture, temporary tools and many forward callback refs. Assign each ref to an owner; never export this block as a ref bag. |
| 958–1118 | V/A/P | Histogram scheduler, viewport/loading/notifications, transition admission, Actions subscriptions, command dispatch, canonical processing writers. Keep frame scheduling separate from mutation policy. |
| 1119–1231 | V/P | Document mirror, device-loss recovery, scopes, Properties target. Recovery policy belongs runtime lifecycle; Properties target is view state. |
| 1232–1316 | A/P | GenAI reference export/import, pending jobs and project/document scope. Reference acquisition needs its own binding and cancellation lifetime. |
| 1317–1512 | V/P | Session options, crop/selection drafts, text creation generations, automation baselines, unmount/document resets and Remove Object. Move ownership with the corresponding domain, not all together. |
| 1513–1758 | V/A/P | Fit/viewport/thumbnail/font projections, preparation effects, text diagnostics coalescing and warning dedup. Preserve lazy preparation and exact renderer binding. |
| 1759–1954 | W/P | Projection controller plus snapshot application, selection CAS and transform publication. Document publication binding owns exact session/selection/renderer agreement. |
| 1955–2125 | W/P/V | Mutation controller, layer transaction lifetime, face session/detection/filter setup and eligibility. Existing controllers retain algorithms. |
| 2126–2378 | P | Face-warp face resolution, coordinates, protection, sculpt/relax/restore, terminal refinement and mesh projection. Face-warp domain owner, not generic handoff coordinator. |
| 2379–2589 | P | Image/canvas size, crop and geometry: plans, selection mapping, admission, pixel/history publication. Existing planners and commitDocumentSurfaceMutation remain. |
| 2590–2810 | W/P | Text controller construction, tab/close text terminals, hit/handle/property lifetimes and observations. Separate text lifecycle binding from individual gesture owners. |
| 2811–2928 | W/A/P | Selection services, mirror/revision/observation adapters and snapping context. Existing selection owner remains canonical. |
| 2929–2992 | P/W | Smart-selection backend, deferred StrictMode disposal, invalidation and prewarm. Move controller, worker and timers together. |
| 2993–3107 | P/W | Adjustment target identity, projection, transaction/coalescing and observations. Processing binding over existing adjustment owners. |
| 3108–3319 | P/W | LUT validation/load/publication; Lens FX/depth/adjustment wiring. Separate asset service from processing interaction. |
| 3320–3486 | P/A | Grade capture/copy/paste, LUT import and clipboard artifacts. Cross-document asset fidelity needs explicit policy. |
| 3487–3618 | P/W | Undo entry preparation; loaded-source publication, font hydration, interaction/history resets. History settlement and document publication have different jobs. |
| 3619–3901 | P/W | Open versus rebind, fonts, renderer reuse, selection projection and new-source reset lists. Preserve existing-session restoration without authoring revisions. |
| 3902–3984 | V/W | Text overlays, renderer presentation, isolation; bounded projection hooks. |
| 3985–4097 | A/P/V | Selection command intents and admission; immediate zoom/viewport math. Do not queue pointer-rate viewport updates. |
| 4098–4358 | A/P | Keyboard Escape/Enter precedence, temporary tool lifetime, nudge, brush settings, tab choice, save/export terminals. Input mapping is already separate; remaining application policy is not. |
| 4359–4510 | W/P | Fill/gradient setup; global grade strength baseline, history and resets. Global strength needs its own processing interaction owner. |
| 4511–4702 | W/A/P | Processing rebind, paint/warp setup, vector observations, pen overlay terminals and selection. Keep existing paint/vector/warp controllers. |
| 4703–4836 | V/P | Selected vector styles and live-shape geometry edits. Defaults differ from mutations to selected content. |
| 4837–5214 | P | Text recovery, hit order, async activation, click granularity, point/path/paragraph creation and readiness. Several small existing controllers need bounded coordination, not a text god object. |
| 5215–5425 | P/W | Transform picking; viewport input config embeds text arbitration, color/depth picking and path creation. Extract those domain intents, retain viewport routing. |
| 5426–5577 | A/W/P | Wheel listener lifetime, layer commands and background task binding. Text-before-layer-change is handoff policy. |
| 5578–5762 | P/A | Merge selection resolution, cut/copy/paste, SVG/bitmap host import, artifact lifetime and placement. Keep canonical pixel mutation in existing command owners. |
| 5763–5945 | W/P | Autoalign/style/mask and layer panel binding; transform/text/vector target-change preparation. Separate target preparation from panel rendering. |
| 5946–6044 | P/V | Contextual adjustment creation/delete targeting and Properties completion. Reuse existing planners. |
| 6045–6556 | A/P | Mounted command registry, readiness RAF, direct profile/transform/processing work, query/preview export. Split domain port factories; no replacement 500-line registry god module. |
| 6557–6698 | V/P | Grade target/group/master visibility, guide drafts and canonical guide edits. Processing context and guide commands are separate owners. |
| 6699–6930 | W/P/V | Transform setup, snapping, transient frames, pixel settlement and host deactivation. Projection differs from terminal policy. |
| 6931–7073 | A/P | Automation gestures reuse selection/paint but translate owns a local transaction/baseline. Move translation to application owner; automation stays adapter. |
| 7074–7303 | P/A/W | Persistent tool activation, rasterize/invert preparation, files/recovery. Tool preference and activation policy belong one owner; persistence stays separate. |
| 7304–7720 | V/A/P | Menus and context models embed save/export/layer/text terminals and mutation intents. Thin menus must call the same application operations as shortcuts. |
| 7721–7856 | V/W | Layers/channels/status view composition. Keep domain policy out of callbacks. |
| 7857–8135 | V/P | Tool defaults and text properties embed layout conversion, font await, formatting and writing-mode completion. Split view model from property commands. |
| 8136–8299 | V/W/P | Face options/Properties and viewport composition; pointer-leave smart-preview cleanup is input/presentation policy. |
| 8300–8553 | V/A/P | Shell/tool options, SVG import, font recovery and direct New Guide mutation. Async imports bind opening document. |
| 8554–8786 | V/A/P | Context menu duplicates tool option updates; workspace scopes/reference navigation. Gradient toolbar/context routes differ and need behavioral reconciliation. |
| 8787–9090 | V/A/P | Panel assemblies, diagnostics, processing/text/Actions/history and GenAI references/jobs. Move provider behavior with its service, not into JSX. |

## State and dependency rules for extraction

- DocumentSession owns canonical document, editor selection, history and source
  assets; inactive tabs do not own a second hidden renderer tree.
- Gesture/controller state includes baselines, terminal promises, pointer IDs,
  generations and leases. Those move with their owner, not with a panel.
- Existing renderer/resources retain authored pixels. Only explicit transfer
  owners exchange them; metadata projection cannot recreate them.
- Host and presentation state includes clipboard I/O, view/dialog flags,
  schedules, fonts/subscriptions and workspace provider references. Their
  lifecycle may be application, session, renderer generation or gesture.
- An owner may depend on typed domain ports. It may not read Overlay, resolve
  arbitrary services or receive the complete editor's mutable refs.
- Application policy orders small participant operations. It does not copy
  their algorithms or acquire a second history/resource authority.

## Transition map and first sub-slices

| Entry/reason | Current policy / authority | Required proof or remaining work |
| --- | --- | --- |
| Escape through keyboard | Face detection -> menu -> crop -> text finish -> paragraph cancel -> point cancel -> transform cancel -> autoalign -> warp -> selection draft -> pen -> committed selection | O02a extracts this exact priority; query lazily, terminate only one owner, propagate failures. |
| Toolbar/shortcut persistent tool | crop clear; remember group preference; conditional text finish; warp/face reset; transform plan; draft reset; tool/brush publication | O02b needs complete activation owner; current transform commit is fire-and-forget. Do not declare settled successor admission from this code. |
| Temporary pan/zoom/erase | TemporaryToolController plus keyboard flags, viewport overlay cleanup | O02 follow-up, preserve underlying persistent gesture. |
| Command before mutation | InteractionTransitionCoordinator -> selection settle -> transform commitPending; document command service owns execution serialization | Preserve exact binding and error result; transition queue is not another command executor. |
| Undo/redo / geometry | pixel settlement then point/paragraph commit, text finish, adjustment reset, document transaction terminal | O02 follow-up extracts history prerequisite; capture opening identity across await. |
| Host blur | preserve admission plus viewport gesture cancel, adjustment reset, gradient cancel, autoalign cancel | OS blur is not document retirement. Pixel preview and pointer gesture are distinct. |
| Layer target change | transform commit -> text finish -> vector prepare | Must finish before resolving successor layer target. |
| Save/export | Keyboard/menu finish text/create plus file owner settlement | Consolidate only after checking both entry paths and command queue. |
| New document / existing tab rebind / close | Multiple independent reset/finish lists and generation effects | O03 and text lifecycle sub-slices; a bottom switch extraction cannot claim these removed. |

## Source-grounded risk register (not reproduced defects)

1. Text hit activation swallows some errors; distinguish cancellation from real
   errors and verify outer reporting rather than mechanically removing catches.
2. Text creation, writing-mode, font asset and transform-pick/nudge continuations
   need opening generation/target proof after await. Some resolve current target.
3. Global-strength history closures retain a session but read current renderer;
   verify inactive-tab undo cannot project into another session.
4. Cut captures a layer before asynchronous copy but later clears via current
   fill dependencies; prove exact target and committed selection through both.
5. Shared and per-domain command admission overlap. Delete duplicate calls only
   after mapping direct UI callers and preserving prerequisite ordering.
6. waitForStableLayerCommandFrame deliberately waits a RAF. Keep it a named
   readiness policy; do not hide it in every interaction or remove it for size.
7. Missing binary LUT currently allows a partial grade paste. This is a fidelity
   decision to expose/classify during O04, not a fallback to silently endorse.
8. Optional standalone document/selection paths and placeholder gradient ports
   need supported-host classification. A missing mutation owner cannot succeed.
9. Device-loss recovery and deferred StrictMode disposal protect resources;
   they are not automatically forbidden mutation fallbacks.
10. Toolbar/context-menu gradient updates differ; SVG async import and GenAI
    base-reference import also need intended-target/lifetime verification.
11. O03b verification observed one missing preview artifact after Opacity drags,
    before selection setup. Three subsequent full painted-selection runs passed.
    Root cause is not established; enhanced harness request/artifact diagnostics
    preserve the next occurrence. Do not claim this observation fixed or silently
    retry preview reads. Track under O08 repeated-flow/artifact proof.

## Baseline evidence and open inventory gate

Before code extraction, the existing fresh-checkpoint instrumented package ran
the rectangle copy/paste/translate -> immediate Exposure scenario successfully:
`tmp/transform-kernel-smoke/handoff-rectangle-translate-normal.json`.
Browser-local control feedback 16.07 ms; transform settlement 49.12 ms;
exact undo/redo true; no page errors. These are different measurements from
the harness end-to-end time. They are not global app latency claims.

O01 has source coverage and a transition risk map. It remains open for the
broader packaged baseline matrix and per-ref/effect relocation tracking as each
domain is opened. Do not label the entire inventory accepted from one scenario.
O02a's exact scope is already mapped and can be verified independently; no
unchecked wider responsibility is being cut over by that extraction.
