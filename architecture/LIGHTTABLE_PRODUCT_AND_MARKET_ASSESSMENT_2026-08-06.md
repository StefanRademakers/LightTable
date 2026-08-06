# LightTable product, market and engineering assessment

Status: evidence-based alpha assessment, 6 August 2026. This is a decision
document, not launch marketing. Scores describe verified product state at this
date; targets are explicitly labelled.

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

The executable backlog is decomposed under `work/todo/`: P0 Tasks 083–089, P1
Tasks 090–099, P2 Tasks 100–103 and P3 Tasks 104–106. The complete queue is
roughly 174–286 focused engineering hours, deliberately enough for repeated
unattended runs rather than a single superficial pass. Execute in numeric order
unless an earlier task records a genuine blocker; each task owns its UI
exposure, measurable verification, architecture update, focused commit and
move to `work/done/`.

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
