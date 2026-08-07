# LightTable product, market and engineering assessment

Status: evidence-based alpha assessment, 6 August 2026. This is a decision
document, not launch marketing. Scores describe verified product state at this
date; targets are explicitly labelled.

## Final post-backlog reassessment - 7 August 2026

This final section supersedes the earlier 7 August interim reassessment below
without deleting its history. The assessed product commit is `2643a94c`; see
[the final signed rehearsal](quality/RELEASE_CANDIDATE_REHEARSAL_2026-08-07.md)
and [the integrated audit](quality/FINAL_PRODUCT_AUDIT_2026-08-07.md).

New evidence since the interim assessment is material but narrow:

- a clean detached candidate passed the complete 40-gate profile;
- all 15 packaged owner workflows passed with zero automation defects;
- an exact-commit packaged soak passed 70/70 full cycles over 2 h 1 min 38 s,
  with zero crashes, invalid screenshots, suspicious stable memory/GPU tails,
  settled background submissions or orphan processes;
- first useful frame across 350 representative opens measured 941 ms median
  and 2,356 ms p95 on the recorded RTX 5090 cell;
- text input-to-submit measured 36.1 ms median / 56.8 ms p95 and input-to-GPU
  61.2 ms median / 75.5 ms p95;
- byte-for-byte Ed25519 report verification now fails closed for any persisted
  content, formatting, hash, key or signature change.

This closes the prior long-duration-soak gap and strengthens reliability
evidence. It does not provide owner judgment, modest-hardware qualification,
external user validation or commercial production infrastructure.

### Final score delta from the 6 August baseline

| Area | 6 Aug | Final 7 Aug | Evidence-based reason |
| --- | ---: | ---: | --- |
| Product direction | 8.0 | 8.1 | Scope and preview boundary are executable policy. |
| Core architecture | 8.0 | 8.4 | Shared command, recovery, diagnostics and release boundaries pass together. |
| Rendering and color | 8.2 | 8.8 | Current Photoshop effects and blend/profile matrices pass. |
| Format interchange | 6.8 | 7.5 | Declared native/PSD/PDF routes pass; uncommon semantics remain partial. |
| Text/vector authoring | 6.5 | 7.3 | Packaged authoring/roundtrip passes; advanced paths remain incomplete. |
| Daily interaction quality | 6.0 | 6.9 | Workflows are stable, but perceived-feel owner review remains open. |
| Reliability and recovery | 6.3 | 8.0 | Recovery plus 70/70 two-hour cycles with clean stable tails. |
| Performance discipline | 7.5 | 8.0 | Measured interaction evidence passes one high-end cell only. |
| Maintainability | 7.0 | 7.5 | Reproducible gates and shared launch contracts reduce integration ambiguity. |
| Accessibility/onboarding | 3.5 | 6.5 | Packaged keyboard/accessibility routes pass; human AT coverage is incomplete. |
| Commercial operations | 3.0 | 4.8 | Fail-closed rehearsal exists; policy, activation and distribution are open. |
| Differentiation potential | 8.5 | 8.7 | MCP editable-design roundtrip works; market demand is unproven. |

**Final engineering foundation: 8.4/10. Product alpha: 7.4/10.
Commercial release readiness: 5.4/10. Overall reassessment: 7.5/10.**

The only score raised from the interim reassessment is reliability/recovery
because the required multi-hour evidence now exists. No passing automation is
used to inflate product breadth, hardware support or market readiness.

### Final smallest backlog

Do not begin another feature wave. Close only the four evidence gates already
owned by Tasks 108-111:

1. owner visual/interaction acceptance and signed release classification;
2. physical integrated-GPU, web-host and Apple Silicon qualification;
3. consented external design-partner beta and exit review;
4. commercial/legal decisions, activation receipts and production
   installer/update/rollback infrastructure.

After those external gates, rerun the signed go/no-go wrapper rather than
rebuilding the product backlog. The correct present classification remains
**bounded technical preview**; the paid-release decision remains **no-go**.

## Interim evidence-based reassessment - 7 August 2026 (superseded)

This section preserves the 6 August baseline below and reassesses the integrated
product at code commit `85fad8d0`. Following commits only record evidence and do
not change product code. See [the clean release-candidate rehearsal](quality/RELEASE_CANDIDATE_REHEARSAL_2026-08-07.md)
and [the final integrated audit](quality/FINAL_PRODUCT_AUDIT_2026-08-07.md).

### Current evidence

- A detached clean checkout installed with `npm ci`, built web and packaged
  desktop, and passed all 40 full-quality gates in both requested iterations.
- Workspace suites included 334 app test files / 1,787 app tests plus desktop
  and focused package suites. Current inventory is 987 TypeScript/TSX/Rust/WGSL
  files, 403 test/spec files, 78 MJS scripts and 123 architecture documents.
- The 40-case Photoshop Layer Style corpus passed with zero semantic or
  fidelity-gate failures. The 48-case blend/profile matrix passed at roughly
  RMSE 0.07–0.79.
- Native save/recovery, PSD roundtrip, PDF open/export, vector/text authoring,
  paint, gradients, transforms, Layer Styles, accessibility, diagnostics and
  an MCP-created editable design passed packaged workflow automation.
- The supplied EHS-396 Save the Date PSD passed its technical owner-workflow
  checks; visual and interaction acceptance remains `awaiting-owner-review`.
- A signed probe and bounded soak passed on the current Windows discrete-GPU
  Electron cell. Other platform cells have not been physically tested.

The evidence is materially stronger, but remains bounded automation on one
physical hardware class. It cannot replace a multi-hour real-document soak,
design-partner use or product-owner judgment.

### Score delta

| Area | 6 Aug | 7 Aug | Delta and reason |
| --- | ---: | ---: | --- |
| Product direction | 8.0 | 8.1 | +0.1: release scope and preview boundary are executable policy. |
| Core architecture | 8.0 | 8.4 | +0.4: shared command, recovery, diagnostics and release boundaries passed the integrated profile. |
| Rendering and color | 8.2 | 8.8 | +0.6: Photoshop 16-bit quantization and the full blend/effects matrices pass. |
| Format interchange | 6.8 | 7.5 | +0.7: packaged native, PSD and PDF workflows pass; semantic PDF and advanced PSD constructs remain partial. |
| Text/vector authoring | 6.5 | 7.3 | +0.8: authoring, fonts, recovery, geometry and roundtrip smokes pass; advanced paths remain incomplete. |
| Daily interaction quality | 6.0 | 6.9 | +0.9: tool, onboarding, recents and focused UX smokes are stable; owner feel review is open. |
| Reliability and recovery | 6.3 | 7.7 | +1.4: save/recovery, isolation, diagnostics and bounded endurance pass; no overnight claim is made. |
| Performance discipline | 7.5 | 8.0 | +0.5: measured gates pass the current cell; modest hardware remains unqualified. |
| Maintainability | 7.0 | 7.5 | +0.5: reproducible orchestration and 40 gates reduce integration risk; large facades remain. |
| Accessibility/onboarding | 3.5 | 6.5 | +3.0: packaged flows pass; human assistive-technology coverage is incomplete. |
| Commercial operations | 3.0 | 4.8 | +1.8: lifecycle rehearsals exist; legal, activation and production distribution remain open. |
| Differentiation potential | 8.5 | 8.7 | +0.2: MCP-to-editable-design roundtrip validates the wedge, not market demand. |

**Reassessed engineering foundation: 8.4/10. Product alpha: 7.3/10.
Commercial release readiness: 5.4/10. Overall reassessment: 7.4/10.**

### Capability and workflow disposition

- **Verified in the bounded candidate:** clean builds; automated packaged
  create/edit/undo/save/reopen/export paths; native recovery; common PSD
  roundtrip; common Layer Styles; blend/profile parity; local diagnostics;
  accessibility smoke; one semantic MCP design transaction.
- **Partial or preserved:** uncommon PSD semantics, advanced text-on-path and
  vector strokes, Smart Object authoring, broad semantic PDF object editing,
  exact high-radius style fidelity and some missing-font substitutions.
- **Deferred:** adjustment-layer parity beyond Grade, deep painting, plugin
  ecosystem, broad remote AI and new product categories.
- **Unsupported release claims:** complete Photoshop/PDF parity, an integrated-
  GPU or Apple Silicon floor, production activation/update service, and
  commercial-grade recovery across every platform.

The three advertised workflows are credible technical-preview workflows, not
paid-release promises. Layered interchange and correction/compositing have
broad automation but need owner corpus acceptance. Semantic agent editing has
an end-to-end vertical slice, while server operations and permission UX need
real beta use.

### Smallest next backlog

Do not begin another broad feature wave. Close these existing gates:

1. Product-owner execution and sign-off of Task 108.
2. Physical integrated-GPU, web-host and Apple Silicon qualification in Task
   109, followed by a truthful hardware floor.
3. A small consented design-partner cohort and exit review in Task 110.
4. Owner/legal commercial decisions plus production activation,
   installer/update and rollback providers in Task 111.
5. A genuine multi-hour/overnight soak on the exact candidate, then repeat the
   signed go/no-go decision in Tasks 112–113.

### Interim conclusion before the exact-candidate two-hour soak

At this interim checkpoint the correct classification was **bounded technical preview**. LightTable was
measurably more stable, interoperable and usable than the 6 August baseline,
and its professional-editor foundation is no longer speculative. It is not a
paid release candidate: external/human gates and the long soak still remained at that checkpoint. That
distinction is part of product quality.

## Executive conclusion

LightTable has an unusually capable technical foundation for an alpha, but it
is not yet a commercially releasable general-purpose Photoshop replacement.
The strongest product is narrower and more defensible:

> A local-first, GPU-first precision image editor that feels immediate on large
> documents, preserves professional PSD/PDF interchange, and exposes one
> semantic command plane to humans, automation and AI agents.

That position uses work that already exists. The shared web/Electron editor,
high-precision WebGPU compositor, editable text/vector model, measured
Photoshop parity lab, native persistence and MCP vertical slice are meaningful
assets. The critical next move is depth: turn broad partial capabilities into
three reliable end-to-end workflows before adding another product category.

**Engineering foundation: 8.0/10. Product alpha: 6.5/10. Commercial release
readiness: 4.5/10. Overall current assessment: 6.7/10.**

The architecture can support a serious product, while reliability, workflow
completeness, onboarding and distribution are not yet at a level where paid
users should trust important work to it.

## Evidence reviewed

- 875 TypeScript/TSX/Rust/WGSL source files across ten packages; 362 are
  tests/specifications.
- 673 commits since 1 July 2026: high delivery velocity and a material
  stabilization burden.
- 96 architecture Markdown files and explicit contracts for performance,
  persistence, rendering, interchange, input/history and verification.
- 50 executable `.mjs` harnesses, including 15 packaged-desktop smoke tests.
- The current quick profile passes boundaries, all workspace typechecks and
  suites, 312 app test files / 1,665 app tests, production web and desktop.
- The 48-case Photoshop profile/blend matrix passes at RMSE 0.07–0.79; the
  40-case effects corpus has no fidelity failures; the ten-template PSD corpus
  inventories 284 layers.
- Structural ratchets track the remaining 4,344-line editor integration root
  and 2,266-line renderer facade.

Test count is not treated as product completion. Scores weigh observed
coverage, current partial-feature declarations and release gates together.

## Scorecard

| Area | Current | Why | Release target |
| --- | ---: | --- | ---: |
| Product direction | 8.0 | Clear GPU/local/interchange/agent thesis; broad Photoshop-plus-AI scope remains dangerous. | 9.0 |
| Core architecture | 8.0 | Canonical document, compositor, dirty domains, host boundaries and typed commands are sound. | 8.5 |
| Rendering and color | 8.2 | WebGPU, high precision, profile-domain blending and measured parity are strong. | 9.0 |
| Format interchange | 6.8 | PSD export RC and PDF import exist; Smart Objects, adjustments, patterns and semantic PDF remain incomplete. | 8.5 |
| Text/vector authoring | 6.5 | Real semantic systems and subset roundtrips exist; advanced editing, path/stroke and font recovery remain uneven. | 8.5 |
| Daily interaction quality | 6.0 | Compact editor and direct tools exist; latency, hit testing, panel consistency and large-document behavior still surface gaps. | 8.5 |
| Reliability and recovery | 6.3 | Strong isolation and test ladder; autosave, journals, crash restore and broad device coverage remain. | 9.0 |
| Performance discipline | 7.5 | Explicit budgets and physical audits; large PSD open, text tail latency, style recomposition and GPU residency remain. | 9.0 |
| Maintainability | 7.0 | Good contracts, boundaries and ratchets; two integration facades and high change rate raise cost. | 8.5 |
| Accessibility/onboarding | 3.5 | Not yet a demonstrated, systematically tested capability. | 8.0 |
| Commercial operations | 3.0 | Installer/update, licensing, support, recovery and release operations are not ready. | 8.0 |
| Differentiation potential | 8.5 | Semantic MCP plus high-fidelity local editing is distinctive if it remains one architecture. | 9.0 |

## What is genuinely strong

### One editor, not desktop and web forks

The shared editor with explicit host capabilities is strategically valuable.
Desktop can be the premium performance path without abandoning browser
distribution or hosted workflows. Platform-specific font, file and GPU
integration should stay at the host boundary.

### The renderer is infrastructure

Dirty domains, explicit GPU ownership, revision caches, compositor plans,
overlay-only invalidation and measured warm/cold behavior are the correct
foundations. The color/profile work demonstrates the right method: use
Photoshop as an oracle, isolate variables and implement one general rule rather
than fixture patches.

### The model is not a flattened PSD viewer

Raster, text, vectors, groups, transforms, masks, processing and styles have
semantic owners. Cached previews are derived fallbacks rather than document
truth. That is necessary for editing, automation, recovery and future AI.

### The command plane is a potential differentiator

MCP v1 routes remote operations through the same typed command service and undo
model as the UI. Agents should create inspectable document operations, never a
private scene or fragile DOM automation path.

### Quality is measurable

Repeatable desktop smokes, retention audits, format corpora, Photoshop
comparisons, source ratchets and production builds are far more valuable than
an unmeasured feature demo.

## Principal risks

### 1. Scope is the largest commercial risk

“Photoshop, Camera Raw, Lightroom and Resolve, plus web, vectors, documents and
AI” is too wide as one release. Initially make three promises:

1. open and preserve serious layered work without surprises;
2. make common photo/design edits immediate and non-destructive;
3. let users and agents perform the same reversible operations.

Painting depth, publishing, video, 3D and broad generative tooling should not
enter the launch critical path.

### 2. Broad partial support can feel worse than a smaller honest product

The parity register correctly identifies partial text, vectors, masks,
adjustments, styles, fill layers and Smart Objects. Unsupported semantics need
visible reporting and retained previews; advertised workflows need complete
create/edit/undo/save/reopen/export behavior.

### 3. Performance credibility depends on ordinary interactions

Large PSD load, text tail latency, heavy Layer Style interaction and GPU
residency remain measured risks. A fast shader is irrelevant when caret
movement, selection, layer switching or a slider stutters. Test modest
supported hardware, not only a flagship GPU.

### 4. Operational safety is behind renderer maturity

Autosave, recovery journals, crash restoration, atomic replacement, updater,
signing, migration and support diagnostics are table stakes for paid work.

### 5. Integration facades remain costly change concentrators

`LightTableEditorOverlay.tsx` and `WebGpuEngine.ts` are controlled hotspots,
not reasons for a rewrite. Extract by stable ownership with behavior tests.
Do not raise caps, add generic managers or move feature logic into React roots.

### 6. AI can destroy trust if it becomes a second architecture

AI results must be versioned assets or semantic operations with provenance,
cancellation, ownership and clear destructive boundaries. Transport, billing
and prompt UI are secondary to undo, privacy and integrity.

## Competitive position in August 2026

### Adobe Photoshop

Adobe combines desktop, web and mobile Photoshop at US$22.99/month and already
integrates Generative Fill, Expand, Harmonize and Upscale. Its defensibility is
format expectation, professional habit, ecosystem and breadth. Sources:
[plans](https://www.adobe.com/products/photoshop/plans.html),
[generative AI](https://helpx.adobe.com/photoshop/desktop/generative-ai/generative-ai-features-overview.html),
[layer types](https://helpx.adobe.com/photoshop/desktop/create-manage-layers/get-started-layers/layers-overview.html).

**Implication:** compatibility and familiar fundamentals are admission
requirements. Compete on responsiveness, directness, local-first trust and
programmable semantic workflows, not total feature count.

### Affinity

Canva presents the reimagined Affinity as one free professional app combining
photo, vector and layout work; it reports over five million adopters and is
adding scripting/AI integrations. Sources:
[all-new Affinity](https://www.canva.com/newsroom/news/all-new-affinity/),
[Canva Create 2026](https://www.canva.com/newsroom/news/canva-create-2026-launches/).

**Implication:** “no subscription” or “more tools for less” is no longer a
sufficient position. A paid LightTable needs a felt workflow advantage.

### Photopea

Photopea runs locally in a browser, uses PSD as its main editable format and
offers PSD save and common exports. It states opened files stay on-device.
Sources: [introduction](https://www.photopea.com/learn/),
[open/save](https://www.photopea.com/learn/opening-saving),
[privacy](https://www.photopea.com/privacy.html).

**Implication:** browser availability and PSD opening alone do not
differentiate. LightTable web must share credible semantics and performance.

### Pixelmator Pro

Pixelmator emphasizes compact native UX, nondestructive layers, vector and
typography tools, responsive Metal painting and broad interchange. Apple is
adding generative image and shape features. Sources:
[overview](https://support.apple.com/guide/pixelmator-pro/pix186c68b96/macos),
[what's new](https://support.apple.com/guide/pixelmator-pro/whats-new-pix298vw3pm/mac).

**Implication:** it is the strongest interaction benchmark for a smaller
coherent editor. Preserve the compact Grade/Lens Fx language and avoid
feature-local controls.

### Krita

Krita is free/open source and deep in painting: configurable workspaces, brush
engines, vector/text, color management, HDR and PSD. Its 2026 release added
on-canvas text and OpenType support. Sources:
[features](https://krita.org/en/features/),
[5.3 release](https://krita.org/en/posts/2026/krita-5.3.0-released/).

**Implication:** do not make advanced painting the initial wedge. Use Krita as
the responsiveness, input-device and brush-resource benchmark later.

## Recommended commercial wedge

Target photographers, designers and AI-assisted creative teams who exchange
PSD/PDF files but want faster local iteration and repeatable automation:

- Photoshop-compatible work enters with explicit fidelity reporting;
- grade, composite, text, shape and common style edits remain editable;
- direct manipulation stays responsive on large documents;
- local files remain local unless a remote capability is invoked;
- UI and agent actions share one undoable semantic command;
- output returns to established tools without silent loss.

Do not claim complete Photoshop parity. Publish a precise compatibility table
and make “unsupported but preserved” a trust feature.

## Product priorities

### P0 — release trust

- autosave, recovery journal, crash restore and atomic-save validation;
- signed installer, updates, migration policy and diagnostic bundle;
- zero known supported-path data loss;
- accessibility and keyboard workflow audit;
- a hardware floor with integrated-GPU performance gates.

### P1 — three complete workflows

1. **Layered interchange:** raster/groups/masks/common blends, styles, text,
   vectors and gradients through import, edit and PSD export.
2. **Fast correction/compositing:** Grade/Lens Fx, selections, paint/masks and
   transforms with one-gesture history and bounded previews.
3. **Semantic agent editing:** document creation, asset placement, text,
   vectors, gradients and styles through the existing command/MCP boundary.

### P2 — product coherence

- one tokenized Layers tree and one property-control vocabulary;
- missing-font and unsupported-feature recovery;
- searchable resources, workspace persistence and reliable recents;
- contextual next actions without duplicating authoritative panels;
- user-facing performance/compatibility diagnostics where actionable.

##### P3 — server-backed MCP design workflows

- productize the local automation bridge inside the normal Electron app;
- connect it outbound to the authenticated MCP server on Hetzner without
  exposing a public desktop port;
- add an Agent Access surface for enable/disable, pairing, server and tunnel
  status, permissions, connected clients, revoke and activity history;
- extend the shared command service with document creation, asset placement,
  text, vector/shape, gradient and complete Layer Style mutations;
- add atomic multi-command design transactions, revision conflicts, progress,
  cancellation and one-step undo;
- verify one complete prompt-to-editable-design flow through MCP, native save
  and Photoshop PSD roundtrip before expanding the agent tool surface.

##### P4 — stabilization, owner acceptance and release qualification

- freeze feature expansion after P0–P3 and run real-document owner acceptance
  before creating another broad feature queue;
- qualify autosave/recovery as invisible background work through destructive
  fault injection, large-document measurements and desktop/web storage limits;
- test the complete advertised workflow on a declared hardware, operating
  system, display-scale and GPU/driver matrix, including modest hardware;
- turn owner and design-partner sessions into reproducible fixtures and
  severity-ranked defects without collecting document content by default;
- rehearse install/update/migration/recovery/support/privacy and commercial
  entitlement boundaries as one release operation, not isolated demos;
- publish a signed go/no-go report against the commercial release gate, with
  explicit deferred capabilities and no silent semantic-loss exceptions.
- after every queued task is closed, independently rerun the complete quality,
  memory, crash, performance and parity evidence and reassess this product
  document from the measured post-work state.

P4 is deliberately a verification and defect-closure phase. New product
categories, speculative architecture and broad UI additions are out of scope.
Only changes required to close measured release blockers may enter this phase.

The executable backlog is decomposed under `work/todo/`: P0 Tasks 083–089, P1
Tasks 090–099, P2 Tasks 100–103, P3 Tasks 104–106 and P4 Tasks 107–113. The
complete queue is roughly 231–382 focused engineering hours, deliberately
enough for repeated unattended runs rather than a single superficial pass.
Execute in numeric order unless an earlier task records a genuine blocker;
each task owns its UI exposure, measurable verification, architecture update,
focused commit and move to `work/done/`.

Deep painting, Smart Object authoring, broad PDF object editing, animation, 3D,
plugin marketplace and generative breadth come after the core release gates.

## Maintenance decisions

1. Keep one canonical `ImageDocument`, transform graph, compositor, command
   service and history. Adapters translate; they never become authorities.
2. Every feature declares serialized state, bounds, revisions, GPU owner,
   cache, disposal, undo, export and unsupported behavior before landing.
3. Lower large-file ratchets through cohesive extraction; never split by line
   count or create a generic manager.
4. Keep pointer-frequency state outside React; overlay work must not dirty the
   document composite.
5. Keep corpora and reference renders as durable tests. Reject fixture-specific
   formulas and unsettled screenshots.
6. Introduce AI through typed commands/tasks and explicit assets only.
7. Freeze/version the native format only when semantics and migration policy
   are release-worthy.

## Commercial release gate

A paid public release is justified when:

- P0 trust items are implemented and tested;
- all P1 workflows pass create/edit/undo/save/reopen/export matrices;
- corpora have declared visual thresholds and zero silent semantic loss;
- warm direct manipulation meets 16.7 ms on the supported hardware floor, or
  a measured preview mode keeps input responsive;
- a multi-hour real-document soak has zero runtime stops, validation errors,
  monotonic heap/GPU growth and background work;
- onboarding reaches open-to-export without architecture knowledge;
- compatibility, privacy, AI processing and recovery are documented for users.

Until then, label builds technical previews and recruit design partners whose
documents expand the corpus without bypassing the product wedge.

## Final judgment

LightTable is not “almost Photoshop,” but it no longer looks like a renderer
experiment. It is a credible professional-editor foundation with rare depth in
GPU discipline, interchange testing and semantic automation. Spend that
advantage on trust and workflow completion. Controlled scope makes a
commercially differentiated product realistic; simultaneous Photoshop,
Illustrator, Lightroom, Krita and AI breadth would bury it under unfinished
surfaces.
