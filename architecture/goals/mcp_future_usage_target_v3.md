# Lighttable MCP Future Usage Target

Status: **supporting long-term design brief**. The normative product and
technical contract is
[`AGENT_NATIVE_CREATIVE_RUNTIME_TARGET.md`](./AGENT_NATIVE_CREATIVE_RUNTIME_TARGET.md).
Sections 32-34 add scalability and preview-transport hypotheses; named provider,
retention and cost choices remain candidates until the empirical gates in
[`Task 256`](../../work/parked/task_256_validate_scalable_mcp_preview_transport_task/task.txt)
pass. Where terminology differs, semantic commands remain the mutation
primitive and Actions remains their visible record/compose/replay surface.

## Purpose

This document defines the long-term usage target for MCP, the Actions architecture, and agent-driven creative workflows inside Lighttable.

The core ambition is larger than “add MCP support” or “build an Actions panel”.

Lighttable should become an **AI-native creative runtime** in which:

- the normal UI,
- the Actions panel,
- keyboard shortcuts,
- macros,
- scripts,
- MCP clients,
- internal AI agents,
- external AI agents,

all operate on the **same semantic application API**.

The target is not to remotely control the Lighttable UI.

The target is:

> An intelligent user or agent that never sees the UI should still be able to complete the same real creative tasks as a human Lighttable user.

---

# 1. Core Architecture

Lighttable should expose a central semantic capability layer.

```text
                    ┌─ Lighttable UI
                    ├─ Actions Panel
                    ├─ Keyboard / Menus
                    ├─ Macros / Workflows
                    ├─ MCP Server
                    ├─ Internal AI Agent
                    └─ External AI Agents
                              │
                              ▼
                    LIGHTTABLE CAPABILITY API
                              │
                ┌─────────────┼─────────────┐
                ▼             ▼             ▼
             Queries        Actions        Events
                │             │             │
                └─────────────┼─────────────┘
                              ▼
                       Application Core
                              │
                Document / Layers / Canvas
                Masks / Grade / FX / Assets
                AI Generation / Export
```

MCP should therefore **not** get its own editing logic.

The Actions panel should also **not** get its own editing logic.

Both should call the same underlying commands.

---

# 2. Actions as the Fundamental Mutation Layer

Every meaningful operation should ideally be represented as a semantic action.

Example:

```ts
interface LighttableAction<TArgs = unknown, TResult = unknown> {
  id: string;
  title: string;
  description?: string;

  schema: ActionSchema;

  canExecute(
    context: ActionContext,
    args: TArgs
  ): boolean;

  execute(
    context: ActionContext,
    args: TArgs
  ): Promise<TResult>;

  undoable?: boolean;
}
```

Example action:

```ts
{
  id: "layer.setOpacity",
  title: "Set Layer Opacity",
  description: "Sets the opacity of a layer",

  inputSchema: {
    layerId: "string",
    opacity: "number"
  }
}
```

The same action can then be used by:

- the normal UI,
- MCP,
- the Actions panel,
- macros,
- scripting,
- keyboard shortcuts,
- an AI agent,
- batch workflows.

---

# 3. Actions vs Queries vs Events

The architecture should clearly distinguish between three concepts.

## Queries

Queries inspect state.

Examples:

```text
document.getInfo
document.getSceneGraph
layers.list
layer.get
selection.get
history.getState
assets.search
scopes.getHistogram
scopes.getVectorscope
```

## Actions

Actions mutate state.

Examples:

```text
layer.create
layer.delete
layer.move
layer.setOpacity
layer.setBlendMode

text.create
text.setFont
text.setSize

selection.invert
selection.selectSubject

mask.create
mask.fromSelection

adjustment.create
adjustment.setParameters

document.resize
document.export
```

## Events

Events describe changes.

Examples:

```text
document.changed
selection.changed
layer.created
layer.deleted
layer.updated
render.completed
generation.completed
history.changed
```

This prevents agents from needing to poll the whole application continuously.

---

# 4. The Required Agent Loop

For an AI agent to truly use Lighttable, it needs more than commands.

The essential loop is:

```text
observe
   ↓
reason
   ↓
act
   ↓
observe
   ↓
evaluate
   ↓
adjust
```

Example:

```text
getDocumentState()
getLayers()
getSelection()
renderPreview()
getHistogram()

→ createAdjustment(...)
→ setExposure(...)
→ createMask(...)
→ applyGrade(...)
→ renderPreview()

→ visually inspect result
→ correct values
→ renderPreview()
→ save
```

Without visual feedback, MCP is mostly automation.

With visual feedback, it becomes an agent.

---

# 5. Preview Is a First-Class Capability

A visual agent needs access to rendered results.

Essential calls:

```ts
canvas.renderPreview()
```

Preferably also:

```ts
canvas.renderPreview({
  x,
  y,
  width,
  height,
  scale
})
```

And:

```ts
layer.renderPreview(layerId)
```

This allows the agent to:

- inspect the whole composition,
- inspect a local region,
- inspect a single layer,
- iterate without requesting full-resolution documents constantly.

The ideal distinction is:

```text
Actions + Queries
    = automation

Actions + Queries + Preview
    = agent

Actions + Queries + Preview + Knowledge
    = agent that can learn Lighttable itself
```

---

# 6. Self-Describing Action Discovery

The MCP/API layer should be discoverable.

An agent should be able to ask:

```text
actions.list()
actions.search("skin tone")
actions.describe("mask.skin")
capabilities.list()
engine.version()
```

This is preferable to putting the entire Lighttable API inside a giant system prompt.

Example:

```text
actions.search("replace person using identity")
```

could return:

```text
image.generate
image.generateWithIdentity
mask.selectPerson
layer.replaceContent
```

The agent can then inspect the relevant action schema.

The application API becomes partially self-documenting.

---

# 7. Semantic Commands, Not UI Automation

MCP should expose application intent.

Good:

```ts
grade.setExposure({ ev: 0.65 })

layer.setBlendMode({
  layerId: "...",
  blendMode: "soft-light"
})

mask.fromSubject({
  layerId: "..."
})
```

Avoid:

```ts
clickAt(532, 241)
dragSlider("opacity", 73)
pressButton("mask")
```

Screen-space UI automation is fragile and should not be the primary architecture.

---

# 8. Coordinate Spaces

The canonical API coordinate space should be:

```text
document-px
```

Definition:

```text
origin: top-left
+X: right
+Y: down
units: floating point document pixels
```

Example:

```ts
{
  space: "document-px",
  x: 320,
  y: 180,
  width: 640,
  height: 480
}
```

Coordinates should use floating point values, not integer-only positioning.

Example:

```ts
x: 123.4375
```

This is important for transforms, vector graphics, resampling, subpixel positioning and high-resolution output.

Additional useful spaces:

```text
document-normalized
layer-local-px
```

Example normalized positioning:

```ts
{
  space: "document-normalized",
  x: 0.1,
  y: 0.2,
  width: 0.4,
  height: 0.3
}
```

This is especially useful for agents reasoning about composition.

Example:

- upper-right,
- centered,
- one third from the left,
- 70% document width.

Recommended model:

```text
Screen space
    ↓ UI only

Viewport space
    ↓ editor only

Document pixel space
    ↓ canonical public API

Layer local space
    ↓ object-specific operations

Normalized document space
    ↓ convenience / agent reasoning
```

Do not implicitly mix coordinate systems.

Every coordinate-bearing action should explicitly state its space.

---

# 9. Semantic Layout Constraints

Not every design operation should require manually calculated coordinates.

Higher-level layout operations would be valuable:

```ts
align(hero, "horizontal-center")

place(headline, {
  relativeTo: hero,
  position: "above",
  gap: 32
})

keepInside(logo, safeArea)
```

This is especially useful for agent-generated layouts.

Relative constraints can be more robust than raw pixel coordinates.

---

# 10. Reconstructing Flat Designs into Editable Documents

A major target use case:

> Give Lighttable a flat advertisement or design and reconstruct it as a new editable Lighttable document.

The agent visually decomposes the reference into semantic components.

Example:

```text
Background
├─ gradient
├─ texture
├─ decorative shape left
└─ decorative shape right

Hero
├─ generated subject
├─ shadow
└─ glow

Typography
├─ headline
├─ subtitle
└─ label

Decoration
├─ badge
├─ line
└─ logo placeholder
```

It then recreates the design using native Lighttable primitives wherever possible.

---

# 11. Editable-First AI Generation

AI should not default to generating the entire finished composition as one raster image.

The preferred philosophy is:

> Generate as little raster content as necessary.

Example mapping:

```text
Text        → native text
Rectangle   → native shape
Gradient    → native gradient
Shadow      → native effect
Color grade → native adjustment
Mask        → native mask
Photo       → raster/generated asset
Illustration→ raster/generated asset when necessary
```

This gives the user a genuinely editable result.

---

# 12. Directed Redesign from a Flat Reference

The next step beyond reconstruction is redesign.

Example user request:

> Take this flat advertisement and create a new winter version. Keep the art direction and approximate composition, but replace the woman with the identity of this man.

The target agent workflow:

```text
1. Analyze the reference advertisement.
2. Detect composition and hierarchy.
3. Detect text regions and styles.
4. Detect visual assets.
5. Determine which parts can be native/editable.
6. Create a new Lighttable document.
7. Rebuild native layout.
8. Generate new winter imagery.
9. Generate the replacement person using identity reference.
10. Place generated assets on separate layers.
11. Rebuild typography and effects natively.
12. Render preview.
13. Compare visually.
14. Correct composition, spacing and grade.
15. Save editable document.
```

The result should not merely be:

```text
winter_ad_final.png
```

but:

```text
winter_ad.lighttable

✓ editable text
✓ separate image layers
✓ editable shapes
✓ masks
✓ effects
✓ adjustments
✓ groups
✓ generated assets
```

---

# 13. Image Generation as an Internal Tool

Image generation should simply be another Lighttable capability available to the agent.

Example:

```ts
image.generate({
  prompt: "...",
  transparentBackground: true,
  referenceImages: [...],
  identityReference: manId,
  preserveIdentity: true
})
```

Generated content should be placed as a normal document asset/layer.

The agent should then still be able to:

- transform it,
- mask it,
- grade it,
- blend it,
- regenerate it,
- replace it,
- version it.

---

# 14. Generated Asset Provenance

Generated layers should retain provenance information.

Example:

```json
{
  "generator": "internal-image-generator",
  "model": "...",
  "prompt": "...",
  "references": [
    "asset://male-identity-reference"
  ],
  "seed": 38291,
  "createdBy": "agent"
}
```

This makes later editing much more powerful.

For example:

> Regenerate this same person, but now wearing a winter coat.

The system can understand how the existing asset was created instead of reverse-engineering it.

---

# 15. Stable Object IDs

Agents must not depend on display names such as:

```text
Layer 4
Copy 2
Shape 7
```

Objects should have stable internal IDs.

Example:

```text
layerId: hero-person
textId: headline-main
maskId: hero-cutout
```

These IDs should remain stable when:

- layers are reordered,
- display names change,
- groups are moved,
- unrelated objects are inserted.

This is critical for multi-step agent workflows.

---

# 16. Transactions and Atomic Agent Operations

Agents may perform many low-level actions for one conceptual operation.

Example:

```text
Create Winter Hero
```

may internally involve:

```text
generate image
create layer
position layer
create mask
add shadow
add grade
group layers
```

This should support transactions:

```ts
transaction.begin("Create winter hero")

...

transaction.commit()
```

If something fails:

```ts
transaction.rollback()
```

From the user's point of view, this should ideally be one Undo step.

This keeps AI workflows understandable and reversible.

---

# 17. Document Snapshots and Creative Branching

Undo/Redo alone is not enough for creative agents.

The document system should support branches or snapshots.

Example:

```text
Original
├─ Winter V1
├─ Winter V2 - cinematic
└─ Winter V3 - minimal
```

This enables requests such as:

> Make three versions without changing my original.

Agents should be encouraged to experiment in branches rather than destructively editing the only document state.

---

# 18. Agent-Readable Errors

Errors should be structured and actionable.

Avoid:

```text
Error 0x800412
```

Prefer:

```json
{
  "error": "INVALID_MASK_TARGET",
  "reason": "Layer does not support raster masks",
  "suggestions": [
    "rasterize layer",
    "create group mask"
  ]
}
```

This allows an agent to recover autonomously.

---

# 19. Long-Running Jobs

Generation, segmentation, export and other expensive operations should be represented as jobs.

Example:

```ts
const job = image.generate(...)

job.status()
job.cancel()
job.result()
```

Useful job types include:

```text
image generation
background removal
subject segmentation
upscale
denoise
large export
batch processing
AI analysis
```

This also makes cancellation and progress reporting possible.

---

# 20. Actions Panel as the Visible Command Stream

The Actions panel can become much more important than a traditional Photoshop-style Actions panel.

It can show both human and agent activity.

Example:

```text
AI Designer

✓ Analyzed composition
✓ Created background group
✓ Generated winter hero
✓ Rebuilt headline
● Matching color grade...
```

The user should be able to inspect what the agent did.

Potentially:

```text
Why did you do this?
```

could be available on an action or transaction.

This makes autonomous editing understandable rather than opaque.

---

# 21. Teach Mode / Workflow Learning

A powerful future target is allowing Lighttable to learn workflows from normal human usage.

Example:

The user manually performs:

```text
Select subject
Duplicate subject
Blur background
Create gradient
Grade foreground
Add grain
```

Because all operations pass through semantic Actions, Lighttable already has the structured sequence.

The user could then choose:

```text
Save as Skill:
"My cinematic portrait treatment"
```

The system can turn that sequence into a reusable workflow.

Future request:

> Apply my usual cinematic portrait treatment, but make this one slightly cooler.

This is much more powerful than traditional recorded macros.

Target flow:

```text
Human
  ↓
Normal UI use
  ↓
Semantic Actions
  ↓
Action History
  ↓
Save as Skill
  ↓
Parameterize
  ↓
Reuse by human / batch / MCP / AI
```

---

# 22. Example / Skill Library

Lighttable should eventually maintain structured examples of successful workflows.

Example item:

```text
Example
├─ before image
├─ after image
├─ action sequence
├─ document structure
├─ explanation
└─ tags
```

Agent query:

```text
examples.search("cinematic portrait grade")
```

could return:

```json
{
  "description": "Muted cinematic portrait",
  "actions": [
    {
      "action": "grade.setExposure",
      "args": { "ev": -0.25 }
    },
    {
      "action": "grade.setContrast",
      "args": { "value": 18 }
    }
  ]
}
```

This gives the agent knowledge of how Lighttable is intended to be used.

---

# 23. Visual + Structural Understanding

The strongest agent workflow combines visual understanding with exact document state.

Example:

```ts
document.getSceneGraph()
```

could return:

```json
{
  "canvas": {
    "width": 1920,
    "height": 1080
  },
  "layers": [
    {
      "id": "hero-title",
      "type": "text",
      "bounds": [110, 95, 850, 190],
      "font": "Inter",
      "fontSize": 92
    }
  ]
}
```

The agent then has both:

```text
VISION
what does it look like?

STRUCTURE
what exactly exists?
```

That combination is significantly more powerful than either alone.

---

# 24. Reference Comparison

A useful optional capability is structured comparison against a reference.

Example:

```ts
canvas.compareToReference({
  referenceId,
  metrics: [
    "layout",
    "composition",
    "color",
    "spacing"
  ]
})
```

This is not strictly required if the agent can visually inspect previews, but it may improve speed, consistency and cost.

---

# 25. Headless Lighttable

The core editing engine should ideally be usable without the desktop UI.

Target architecture:

```text
             lighttable-core
                  │
       ┌──────────┼──────────┐
       ▼          ▼          ▼
      UI         MCP        CLI
```

Possible future usage:

```bash
lighttable render campaign.lt --variant winter
```

This enables:

- batch rendering,
- server-side creative workflows,
- automated campaign generation,
- render farms,
- AI agents operating without a visible desktop.

---

# 26. Capability Versioning

Agents must be able to detect what a specific Lighttable instance supports.

Useful calls:

```text
engine.version()
capabilities.list()
actions.list()
document.features()
```

The agent should not assume Lighttable 1.2 and Lighttable 2.0 expose identical features.

---

# 27. Permission Boundaries

External MCP clients should not automatically receive unlimited control.

Possible permissions:

```text
read document
modify document
generate images
access generated assets
export files
save document
overwrite original
delete assets
filesystem access
network access
```

These permissions should be explicit and inspectable.

---

# 28. Creative Autonomy Target

A useful benchmark for the entire architecture is this request:

> Make something interesting from this.

A sufficiently capable agent should be able to:

```text
inspect document
inspect image
understand subject
understand composition
create a creative plan
make non-destructive edits
render preview
evaluate result
correct itself
create variants
save versions
```

For example:

```text
portrait detected
subject center-left
background visually flat
skin slightly warm
large negative space
highlights slightly clipped

→ recover highlights
→ cool shadows
→ preserve warm skin
→ create subject mask
→ darken background
→ add subtle vignette
→ add grain
→ crop to 4:5
```

After previewing the result it might decide:

```text
background became too dark
```

and correct the appropriate adjustment.

The key is not exposing one-shot AI magic.

The key is enabling a real iterative creative process.

---

# 29. Product-Level Vision

The long-term product should move from:

```text
AI image editor
```

toward:

```text
AI-native creative application
```

The important distinction is that the AI operates on **real editable documents**.

Instead of:

```text
prompt
  ↓
flat image
```

Lighttable enables:

```text
intent
   ↓
planning
   ↓
native document construction
   ↓
asset generation
   ↓
visual evaluation
   ↓
iteration
   ↓
editable creative document
```

This is potentially a much stronger product proposition than simply integrating image-generation models.

---

# 30. Ultimate Architecture Target

```text
                         HUMAN
                           │
                 Normal Lighttable UI
                           │
                           ▼
                  Semantic Actions
                           │
       ┌───────────────────┼────────────────────┐
       ▼                   ▼                    ▼
 Actions Panel          MCP Server          Automation
       │                   │                    │
       ▼                   ▼                    ▼
   Workflows          AI Agents            Batch / CLI
       │                   │
       └──────────────┬────┘
                      ▼
             Lighttable Capability API
                      │
          ┌───────────┼───────────┐
          ▼           ▼           ▼
       Queries      Actions      Events
          │           │           │
          └───────────┼───────────┘
                      ▼
                Lighttable Core
                      │
     ┌────────────────┼────────────────┐
     ▼                ▼                ▼
 Documents         Rendering        AI Services
 Layers            Masks            Generation
 Text              Grade            Segmentation
 Shapes            FX               Analysis
 Assets            Export           Identity
```

---

# 31. Guiding Principles

1. **One command architecture.**
   UI, Actions, MCP and agents should share the same semantic application API.

2. **No UI-coordinate automation as the foundation.**
   Expose creative intent, not button presses.

3. **Editable-first.**
   Prefer native Lighttable primitives over flattened AI output.

4. **Visual feedback is mandatory for real creative autonomy.**

5. **Document pixels are the canonical coordinate system.**

6. **Normalized and local spaces are explicit secondary coordinate systems.**

7. **Everything important has a stable ID.**

8. **Agent changes are inspectable, reversible and preferably transactional.**

9. **Creative exploration should support branches and versions.**

10. **Generated assets retain provenance.**

11. **Actions should be discoverable and self-describing.**

12. **Errors should help an agent recover.**

13. **Human workflows can become reusable AI skills.**

14. **The same core should eventually support UI, MCP and headless usage.**

---

# Target Outcome

A future Lighttable agent should be able to receive:

- a flat design reference,
- one or more identity references,
- text instructions,
- access to internal generation services,
- access to the editable Lighttable document model,

and autonomously produce a polished, iterated, **fully editable Lighttable document**.

For example:

> Take this existing advertisement as visual direction. Make a winter campaign in the same spirit, replace the woman with this man's identity, rebuild all reasonable elements as editable native Lighttable objects, generate only the assets that require generation, create several variants, and leave the original untouched.

If Lighttable can execute that workflow reliably through the shared capability API, the MCP / Actions architecture has reached its intended target.

---

# 32. Scalability Target: Keep Lighttable a Software Product, Not an AI Infrastructure Company

A critical architectural goal is that Lighttable should remain primarily a **desktop creative software product**, even if MCP and agent-driven workflows eventually serve tens or hundreds of thousands of users.

The system should therefore avoid an architecture in which Lighttable Cloud becomes responsible for:

- AI reasoning,
- vision inference,
- GPU rendering,
- document processing,
- long-lived creative sessions,
- large project storage,
- high-resolution image transport,
- or model capacity planning.

The preferred principle is:

> **Heavy creative work stays either on the user's machine or on the user's chosen AI/model provider. Lighttable Cloud remains a thin control and transport layer.**

## 32.1 Preferred Responsibility Split

```text
USER
│
├── ChatGPT / External Agent
│     ├─ reasoning
│     ├─ vision
│     ├─ creative planning
│     └─ agent loop
│
└── Lighttable Desktop
      ├─ document state
      ├─ WebGPU rendering
      ├─ layers / masks / text / vectors
      ├─ actions
      ├─ queries
      ├─ local previews
      ├─ generation integrations
      └─ file persistence
            │
            ▼
      Lighttable Cloud Relay
      ├─ authentication
      ├─ user ↔ instance routing
      ├─ MCP endpoint
      ├─ permissions
      ├─ session management
      ├─ command transport
      └─ temporary preview transport
```

The cloud layer should coordinate the session, but should not become the execution environment for the creative document.

## 32.2 Control Plane vs Image Plane

The architecture should explicitly separate cheap semantic traffic from image traffic.

### Control Plane

Used for:

```text
Actions
Queries
Events
Session state
Permissions
Document metadata
Object IDs
Job status
Revision numbers
```

Typical traffic consists mainly of small JSON messages.

Example:

```text
ChatGPT
   ↓
Lighttable MCP Relay
   ↓
Lighttable Desktop

layer.setOpacity(...)
mask.create(...)
text.setBounds(...)
grade.setExposure(...)
```

The Lighttable desktop executes these operations locally.

### Image Plane

Images should only leave the Lighttable instance when the agent actually needs to see them.

```text
Lighttable Desktop
      │
      │ render preview locally
      ▼
temporary image transport
      │
      ▼
ChatGPT / Agent vision
```

The full project, full-resolution canvas and GPU rendering should remain local by default.

## 32.3 User-Owned Vision and Reasoning

When Lighttable is controlled through a user's ChatGPT session, the preferred model is:

```text
ChatGPT performs:
- reasoning
- visual analysis
- planning
- decision making

Lighttable performs:
- document editing
- rendering
- local processing
- action execution
```

This avoids Lighttable having to operate a separate central vision or LLM infrastructure for every user.

Avoid:

```text
Lighttable Desktop
   ↓
Lighttable Cloud
   ↓
Lighttable-paid AI vision
   ↓
Lighttable-paid LLM reasoning
   ↓
Lighttable Cloud
   ↓
Desktop
```

Prefer:

```text
User's ChatGPT
      ⇅
Lighttable MCP
      ⇅
Lighttable Desktop
```

The user brings the intelligence layer while Lighttable provides the creative runtime.

## 32.4 Do Not Route Every Pixel Through the Application Server

A naive architecture:

```text
Lighttable Desktop
      ↓ image
Lighttable Application Server
      ↓ image
ChatGPT
```

should be avoided for high-frequency preview traffic.

The application server should preferably route metadata and commands, not large image payloads.

If direct image transfer through MCP is not practical, use temporary object storage:

```text
Lighttable Desktop
      │
      ├─ request temporary upload target
      │
      └─ upload preview
             ↓
      ephemeral object storage
             ↓
      temporary preview handle / URL
             ↓
          ChatGPT
```

Important properties:

- short TTL,
- no permanent creative storage,
- no unnecessary duplication,
- automatic cleanup,
- low-resolution previews by default,
- authorization scoped to the current session.

## 32.5 Preview Traffic Must Be Deliberate

A complex creative task may involve dozens or even more than one hundred visual inspections.

Do not design around:

```text
Action
→ screenshot
→ Action
→ screenshot
→ Action
→ screenshot
```

Prefer:

```text
LOOK
↓
reason
↓
perform 5–20 semantic actions
↓
LOOK
↓
correct
↓
LOOK
```

Example:

```text
renderPreview()

→ reposition hero
→ resize hero
→ change headline
→ adjust background
→ create mask
→ modify grade

renderPreview()
```

This significantly reduces image traffic and vision overhead.

## 32.6 Structured State Reduces Vision Requirements

Agents should not need images to discover information already available structurally.

Use structured state for:

- positions,
- bounds,
- transforms,
- opacity,
- layer hierarchy,
- selections,
- masks,
- adjustment values,
- document state.

Use vision for:

- composition,
- aesthetics,
- realism,
- identity,
- color balance,
- generated image quality,
- emotional/artistic evaluation,
- final review.

## 32.7 Preview Quality Levels

Lighttable should expose explicit preview levels.

```ts
renderPreview({ detail: "thumbnail" })
```

Typical use:

```text
384–512 px longest edge
```

For composition and global structure.

```ts
renderPreview({ detail: "working" })
```

Typical use:

```text
768–1024 px longest edge
```

For general creative evaluation.

```ts
renderPreview({
  detail: "inspect",
  region: {
    space: "document-px",
    x: 600,
    y: 100,
    width: 700,
    height: 850
  }
})
```

For local inspection such as:

- face identity,
- masking,
- typography,
- edge quality,
- texture,
- small design elements.

Agents should almost never need the entire document at final export resolution.

## 32.8 Region-Targeted Inspection

Agents should be able to request only the visual region relevant to the current question.

```ts
agent.inspect({
  target: "hero-person",
  reason: "identity-check"
})
```

Lighttable can translate this into an appropriate crop around the layer bounds.

## 32.9 Revision-Aware Preview Requests

The document should expose revision information.

```ts
renderPreview({
  sinceRevision: 418
})
```

This enables future optimizations such as:

- deciding whether a new preview is necessary,
- targeting a changed region,
- reusing an existing preview,
- giving the agent a structured change summary.

## 32.10 Ephemeral Preview Storage

If object storage is used, previews should be temporary infrastructure rather than user asset storage.

```text
generate preview
↓
upload
↓
agent reads preview
↓
short TTL expires
↓
automatic deletion
```

The storage layer should be optimized for:

- many small temporary objects,
- predictable request pricing,
- low or zero egress costs where possible,
- automatic lifecycle cleanup,
- direct client upload/download where safe,
- avoiding image proxying through Lighttable application servers.

S3-compatible storage, Cloudflare R2, or equivalent infrastructure should be evaluated empirically.

No provider should be selected based only on theoretical pricing.

## 32.11 Required Cost and Load Testing

Before committing to the production MCP architecture, Lighttable should run a realistic prototype test.

Minimum scenario:

```text
ChatGPT
→ render preview
→ visually analyze
→ perform actions
→ request another preview
→ inspect crop
→ perform more actions
→ repeat 20–100 times
```

Measure:

```text
preview count per session
average preview size
total MB per session
upload bandwidth
download/egress bandwidth
storage duration
object writes
object reads
relay traffic
WebSocket traffic
latency
MCP call count
session duration
failure/retry rate
```

Then model costs for:

```text
1,000 users
10,000 users
100,000 users
```

At minimum, calculate:

```text
cost per active creative session
cost per monthly active user
cost per 1,000 MCP sessions
cost at 100k MAU
```

The target is to make the cost per user small enough that MCP does not fundamentally change the economics of selling Lighttable as desktop software.

## 32.12 Infrastructure Principle at 100,000 Users

At large scale, Lighttable should preferably operate:

```text
100,000 Lighttable installations
+
a thin cloud relay
```

rather than:

```text
100,000 users
+
centralized AI inference
+
centralized vision
+
centralized GPU rendering
+
centralized project processing
```

The first architecture allows the company to remain focused on creative software.

The second architecture gradually turns the company into an AI infrastructure provider.

The strategic preference is explicitly the first.

## 32.13 Lighttable Cloud Responsibility Boundary

A useful hard product rule is:

> **Lighttable Cloud does not process creative documents unless a future feature explicitly requires it.**

And:

> **Lighttable Cloud does not perform AI reasoning by default.**

The default cloud responsibilities should remain:

```text
identity
authentication
routing
authorization
instance discovery
MCP transport
temporary asset authorization
session state
usage accounting
licensing
```

Heavy operations remain elsewhere:

```text
Document rendering   → user's GPU
Image editing        → Lighttable desktop
MCP execution        → Lighttable desktop
Vision/reasoning     → user's ChatGPT / chosen model
Image generation     → configured provider / local service
Project storage      → user's filesystem / chosen storage
```

## 32.14 Native Agent Path Remains Possible

The MCP architecture should not prevent Lighttable from later offering its own built-in AI agent.

```text
                     Lighttable Core
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
         Actions Panel    MCP       Native Agent
                                        │
                                        ▼
                                 OpenAI / other API
```

The same Action, Query, Event and Preview architecture should serve both paths.

This preserves flexibility for:

- external ChatGPT agents,
- an internal Lighttable agent,
- other MCP clients,
- local models,
- enterprise agents.

# 33. Scalability Guiding Rule

The infrastructure design should follow this principle:

> **Pixels stay local unless an agent genuinely needs to see them. Commands and structured state are cheap; visual inspection is an explicit resource.**

This rule should influence:

- MCP tool design,
- preview APIs,
- session architecture,
- object storage,
- cost testing,
- agent behavior,
- cloud responsibilities.

The success condition is not merely that MCP works.

The success condition is that MCP can scale to a large Lighttable user base **without forcing Lighttable to become a large-scale AI infrastructure company**.

---

# 34. Hetzner Object Storage Target for Ephemeral MCP Previews

The current preferred infrastructure candidate for temporary MCP preview transport is **Hetzner Object Storage**, using its S3-compatible API.

The purpose of this storage is explicitly **not** permanent user asset storage.

It is an ephemeral transport layer for visual agent inspection.

Target usage:

```text
Lighttable Desktop
      │
      │ render local preview
      ▼
Hetzner Object Storage
      │
      │ short-lived authorized object
      ▼
ChatGPT / Agent
```

The Lighttable application server should ideally exchange only:

- session metadata,
- object identifiers,
- signed upload/download authorization,
- command payloads,
- state,
- permissions.

The application server should not proxy the actual image bytes unless required.

---

## 34.1 Direct Upload / Download Through Presigned URLs

The preferred flow is:

```text
ChatGPT / MCP
      │
      │ render_preview()
      ▼
Lighttable Relay
      │
      │ create temporary object authorization
      ▼
Lighttable Desktop
      │
      │ direct upload
      ▼
Hetzner Object Storage
      │
      │ temporary signed read
      ▼
ChatGPT / Agent
```

This keeps the central Lighttable relay out of the image data path.

Benefits:

- lower relay bandwidth,
- lower memory usage,
- fewer large HTTP payloads,
- easier horizontal scaling,
- simpler cost attribution,
- reduced application-server bottlenecks.

---

## 34.2 Dedicated Ephemeral Preview Bucket

MCP preview storage should be separated from permanent user assets.

Recommended conceptual structure:

```text
lighttable-user-assets/
    permanent / user-controlled content

lighttable-mcp-previews/
    ephemeral agent previews
```

Inside the preview bucket:

```text
sessions/
    <session-id>/
        preview-0001.webp
        preview-0002.webp
        crop-0003.webp
        inspect-face-0004.webp
```

The preview bucket should have aggressive lifecycle behavior.

It should not silently become long-term storage.

---

## 34.3 Mandatory Expiration Metadata

Every temporary MCP visual object must have an explicit expiration policy when it is created.

Recommended application metadata:

```json
{
  "sessionId": "...",
  "objectId": "...",
  "createdAt": "...",
  "expiresAt": "...",
  "type": "mcp-preview",
  "revision": 426
}
```

Architecture rule:

> **No MCP preview may enter object storage without an explicit expiration time.**

This should be enforced in the upload authorization layer, not left to application convention.

---

## 34.4 Two-Layer Cleanup Strategy

Cleanup should use two independent mechanisms.

### Layer 1: Application-Level Cleanup

The Lighttable relay/session service tracks temporary objects.

Examples:

```text
MCP session closes
      ↓
mark associated previews expired
      ↓
delete temporary objects
```

or:

```text
scheduled cleanup worker
      ↓
find expiresAt < now
      ↓
delete object
      ↓
remove metadata
```

This provides predictable cleanup behavior and allows previews to disappear much earlier than the storage lifecycle limit.

### Layer 2: Object Storage Lifecycle Safety Net

Hetzner Object Storage lifecycle rules should act as a final safety mechanism.

Example target:

```text
prefix:
    sessions/

expiration:
    1 day

abort incomplete multipart uploads:
    1 day
```

The exact supported lifecycle configuration must be validated against the production Hetzner Object Storage implementation.

The lifecycle rule is a safety net against:

- crashed clients,
- failed session cleanup,
- abandoned sessions,
- metadata corruption,
- deployment bugs,
- orphaned objects.

The system should never rely exclusively on application-level deletion.

---

## 34.5 Recommended Retention Durations

Twenty-four hours should be treated as a maximum fallback lifetime, not necessarily the normal lifetime.

Possible target policy:

```text
thumbnail preview      → 1 hour
working preview        → 1 hour
inspection crop        → 1 hour
generation preview     → 6 hours
debug preview          → 24 hours
```

Normal MCP session completion should attempt cleanup immediately or shortly after the session ends.

The storage lifecycle expiration remains the final backstop.

---

## 34.6 Versioning Should Be Disabled for Ephemeral Preview Storage

The MCP preview bucket should preferably have object versioning disabled.

The purpose of this bucket is temporary transport.

Keeping deleted historical versions would work against the cleanup objective and can create hidden storage growth.

For ephemeral preview storage, the desired behavior is conceptually:

```text
object expired
      ↓
object deleted
      ↓
storage released
```

rather than:

```text
object expired
      ↓
delete marker
      ↓
old object version remains stored
```

If versioning is ever enabled, explicit cleanup of noncurrent versions becomes mandatory.

---

## 34.7 Failed and Incomplete Upload Cleanup

Failed uploads must also be considered part of the storage model.

The system should monitor and clean:

- incomplete multipart uploads,
- zero-byte failed preview objects,
- authorization records without matching objects,
- objects without valid session metadata,
- objects belonging to expired sessions.

Object-storage lifecycle rules should abort stale incomplete multipart uploads where supported.

---

## 34.8 Storage Format

Agent previews should be optimized for visual analysis rather than archival fidelity.

Typical formats:

```text
WebP
JPEG
```

Preferred characteristics:

```text
thumbnail:
    384–512 px longest edge

working:
    768–1024 px longest edge

inspect:
    cropped region at sufficient local resolution
```

PNG should only be used where alpha, lossless inspection or technical validation requires it.

The goal is to minimize:

```text
bytes per visual inspection
```

without materially reducing the agent's ability to judge the image.

---

## 34.9 Storage and Cleanup Metrics

The production system should expose storage-health metrics.

At minimum:

```text
objects created / hour
objects created / day
average object size
average object lifetime
current object count
current stored GB
peak stored GB
expired object count
expired-but-not-deleted object count
cleanup success rate
cleanup failure rate
orphaned object count
incomplete upload count
bytes uploaded / day
bytes downloaded / day
```

Important derived metrics:

```text
MB per MCP session
objects per MCP session
storage cost per MCP session
transport cost per MCP session
storage cost per active user
```

These should be available before large-scale MCP rollout.

---

## 34.10 Leak Testing

Storage cleanup must be tested as an explicit failure scenario.

Example test:

```text
start 10,000 simulated sessions
↓
create previews
↓
randomly terminate clients
↓
randomly fail cleanup callbacks
↓
leave some uploads incomplete
↓
wait for lifecycle window
↓
measure remaining objects
```

The expected outcome should approach:

```text
0 permanently orphaned MCP preview objects
```

A small percentage leak at 100,000 users can eventually become a large storage problem.

Cleanup reliability is therefore a scalability feature, not merely housekeeping.

---

## 34.11 Cost Modeling for Hetzner Object Storage

The selected Hetzner region and current Object Storage pricing should be measured and recorded during implementation.

The production decision should be based on actual measurements of:

```text
PUT request volume
GET request volume
DELETE request volume
stored GB-hours
data transfer
presigned URL usage
average preview size
average preview lifetime
session concurrency
```

Model at least:

```text
1,000 monthly active users
10,000 monthly active users
100,000 monthly active users
```

with multiple activity profiles:

```text
light MCP user
normal MCP user
heavy creative MCP user
```

Example heavy session:

```text
100 visual inspections
+
hundreds of semantic actions
```

This will provide a realistic upper-bound model.

---

## 34.12 Hetzner Compatibility Validation

Hetzner Object Storage is S3-compatible, but the implementation should not assume full AWS S3 feature parity.

Before production rollout, validate all required behaviors directly against Hetzner:

```text
presigned PUT
presigned GET
short-lived signed URLs
DELETE
lifecycle expiration
prefix-based lifecycle rules
multipart upload abort
CORS requirements
concurrent access
object metadata
large request volume
authorization failures
```

The MCP infrastructure should depend only on features that are verified to behave correctly on the chosen provider.

---

## 34.13 Provider Abstraction

Although Hetzner is the preferred initial provider, the Lighttable relay should avoid tightly coupling business logic to Hetzner-specific APIs.

Use an internal abstraction such as:

```ts
interface EphemeralObjectStore {
  createUploadTarget(...): Promise<UploadTarget>;
  createReadTarget(...): Promise<ReadTarget>;
  deleteObject(...): Promise<void>;
  deleteSessionObjects(...): Promise<void>;
}
```

This keeps future migration possible to:

```text
Hetzner Object Storage
Cloudflare R2
AWS S3
another S3-compatible provider
```

without changing the MCP protocol or Lighttable desktop implementation.

---

## 34.14 Final Storage Rule

The MCP image transport architecture should follow this rule:

> **Temporary previews are disposable transport artifacts, not user content.**

Therefore they should be:

```text
small
temporary
session-scoped
directly transferred where possible
automatically deleted
measured
provider-independent
```

At large scale, the desired system remains:

```text
100,000 Lighttable installations
        │
        ├─ local creative processing
        ├─ local rendering
        ├─ user's ChatGPT reasoning / vision
        │
        ▼
thin Lighttable relay
        │
        ▼
ephemeral Hetzner object storage
```

This keeps the product focused on creative software rather than operating a large image-processing cloud.
