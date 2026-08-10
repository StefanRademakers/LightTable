# Lighttable AI Agent & MCP Integration — Architecture Inspiration and Implementation Guidance

## Status

This document is **architectural guidance**, not a fixed implementation contract.

Lighttable is already close to being MCP-compatible because its functionality is increasingly exposed through separated commands, actions, document operations, render operations, and stable application services.

The coding agent must first inspect the current Lighttable architecture and reuse existing systems wherever possible. Do not create a second command system, a parallel document model, or AI-specific editor logic unless there is a strong technical reason.

The goal is to make Lighttable controllable by external AI agents such as ChatGPT, Claude, Codex, local models, and future automation clients.

---

# 1. Primary Goal

Enable an external AI agent to:

- inspect the currently open Lighttable document;
- understand the document structure;
- inspect selected objects and active tools;
- create complete visual designs;
- modify existing images and compositions;
- add and edit raster, vector, text, mask, adjustment, effect, and group objects;
- use Lighttable's existing editing functionality;
- render previews of the result;
- visually inspect those previews;
- apply corrections;
- safely undo or roll back operations;
- work locally through an MCP-compatible interface;
- optionally connect to remote AI clients such as ChatGPT through a secure bridge.

The desired interaction loop is:

```text
Inspect document
    ↓
Understand current state
    ↓
Plan changes
    ↓
Execute structured operations
    ↓
Render result
    ↓
Visually inspect result
    ↓
Apply targeted corrections
```

This is more important than merely exposing isolated buttons or simulating mouse input.

---

# 2. Core Architectural Principle

## AI should control Lighttable through semantic application operations

The primary interface should expose meaningful editor capabilities such as:

```text
create layer
create text
create vector shape
set fill
set transform
apply adjustment
add mask
group objects
render preview
export document
```

Avoid making low-level UI automation the main integration method:

```text
move mouse
click at x/y
press toolbar button
drag handle
press keyboard shortcut
```

UI automation may later be useful as a fallback or testing layer, but it should not be the foundation of agent control.

Semantic operations are:

- deterministic;
- easier to validate;
- independent of UI layout;
- faster than simulated input;
- compatible with undo;
- easier to test;
- easier to expose through MCP;
- reusable by scripts, plugins, tests, and automation;
- more stable across future UI redesigns.

---

# 3. Reuse the Existing Lighttable Architecture

Before implementing anything, inspect the current codebase for:

- command dispatch;
- action registries;
- document operations;
- undo and redo;
- transaction support;
- document serialization;
- stable object IDs;
- layer tree operations;
- selection state;
- render services;
- export services;
- asset management;
- tool registration;
- keyboard command mappings;
- plugin or extension APIs;
- IPC boundaries;
- Electron main/renderer boundaries;
- current MCP-related work;
- existing internal APIs.

The preferred architecture is:

```text
External Agent
    ↓
MCP Adapter
    ↓
Lighttable Application API
    ↓
Existing Commands / Actions / Services
    ↓
Document Model + GPU Render Stack
```

The MCP layer should be an adapter.

It should not directly mutate internal state when a normal Lighttable command or service already exists.

Bad:

```text
MCP tool directly modifies a layer object
```

Better:

```text
MCP tool invokes the same layer command used by the Lighttable UI
```

This keeps:

- undo behavior consistent;
- validation centralized;
- document revisions correct;
- renderer invalidation correct;
- UI state synchronized;
- future refactoring manageable.

---

# 4. Do Not Over-Specify the Initial Tool List

Do not begin by hardcoding a massive theoretical MCP API.

Instead, derive the tool surface from Lighttable's existing capabilities.

The coding agent should inventory the current application commands and group them into logical capability domains.

Possible domains include:

```text
document
selection
layer
group
transform
vector
path
text
raster
mask
adjustment
filter
effect
asset
view
render
export
history
workspace
application
```

These names are suggestions only.

Use terminology that matches the actual Lighttable codebase and document model.

The agent should determine:

1. which existing operations are already safe to expose;
2. which operations need a thin adapter;
3. which operations currently depend too strongly on UI state;
4. which missing application-level operations should be added;
5. which operations should remain internal;
6. which operations require user confirmation;
7. which operations can be combined into batches.

---

# 5. Capability Inventory

Create an inventory of all relevant Lighttable functionality.

For each command or capability, document:

```ts
interface AgentCapabilityInventoryItem {
  id: string;
  domain: string;
  description: string;
  existingEntryPoint?: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
  supportsUndo: boolean;
  supportsBatching: boolean;
  requiresActiveDocument: boolean;
  requiresSelection: boolean;
  destructive: boolean;
  safeForRemoteUse: boolean;
  implementationStatus:
    | "existing"
    | "adapter-needed"
    | "refactor-needed"
    | "missing";
}
```

Do not necessarily implement this exact TypeScript interface. Use it as inspiration for the information that must be collected.

The result should make clear how close Lighttable already is to external agent control.

---

# 6. Stable Object Identification

External agents must not rely only on layer names.

Names are:

- not unique;
- editable;
- language-dependent;
- sometimes generated automatically.

Every externally addressable object should have a stable ID.

Potentially addressable entities include:

- document;
- page;
- canvas;
- artboard;
- layer;
- group;
- raster object;
- vector object;
- path;
- text object;
- mask;
- adjustment;
- effect;
- asset;
- guide;
- selection;
- export job.

The exact entity model must follow Lighttable's current architecture.

Agent operations should preferably address objects through stable IDs:

```json
{
  "documentId": "doc_x",
  "objectId": "layer_y"
}
```

Human-readable names may be included for display and search, but should not be the authoritative reference.

---

# 7. Document Inspection

An AI agent needs a compact way to understand a document without retrieving the entire serialized project.

Provide layered levels of inspection.

## 7.1 Document summary

A compact summary may contain:

- document ID;
- revision;
- dimensions;
- color space;
- bit depth or working format;
- layer count;
- selected object IDs;
- active layer;
- active tool;
- document dirty state;
- current viewport;
- available artboards or pages.

## 7.2 Document tree

Expose a compact structural tree containing:

- object ID;
- object type;
- name;
- parent ID;
- child count;
- visibility;
- locked state;
- basic bounds;
- optional short style summary.

Do not return all pixel data, path data, text runs, effect parameters, and masks by default.

## 7.3 Object details

Allow the agent to request details for a specific object or small set of objects.

Potential information:

- transform;
- bounds;
- type-specific properties;
- text content;
- fill and stroke;
- blend mode;
- opacity;
- clipping;
- masks;
- effects;
- adjustment parameters;
- linked assets;
- path structure;
- metadata.

## 7.4 Search and query

The agent should be able to locate objects by conditions such as:

```text
all visible text objects
all selected layers
objects named "Logo"
all images larger than a given size
all hidden layers
all objects inside a group
all layers using a certain blend mode
```

The exact query system may be simple at first.

Avoid building a complex query language until real use cases require it.

---

# 8. Document Revisions and Concurrency

Every document-changing operation should be associated with a document revision or equivalent version token.

Example concept:

```json
{
  "documentId": "doc_123",
  "expectedRevision": 182,
  "operation": {}
}
```

If the user edits the document after the agent inspected it, an operation based on stale state should not silently overwrite newer work.

Possible behavior:

- reject the operation;
- return the latest revision;
- return a compact change summary;
- allow the agent to inspect again;
- optionally support explicitly forced operations for safe cases.

Use the existing Lighttable revision model if available.

Do not introduce another revision system unnecessarily.

---

# 9. Transactions and Undo

Agent operations should integrate with Lighttable's existing undo and redo system.

A design operation may involve many internal edits:

```text
create background
place image
create heading
create subtitle
create shape
apply gradient
align elements
group elements
```

The user should generally be able to undo this as one meaningful operation.

Provide a transaction concept such as:

```text
begin transaction
execute operations
commit transaction
```

Or expose one batch operation that internally creates a transaction.

Requirements:

- atomic where practical;
- one undo entry for one logical agent action;
- rollback when a batch fails;
- descriptive undo label;
- returned IDs for newly created objects;
- validation before commit where practical.

Example undo label:

```text
AI: Create promotional poster layout
```

The exact label format should follow Lighttable conventions.

---

# 10. Batch Operations

Remote tool calls introduce latency and complexity.

Do not require an agent to perform hundreds of calls to create one composition.

Support structured batches where possible.

Conceptual example:

```json
{
  "documentId": "doc_123",
  "expectedRevision": 42,
  "label": "Build hero composition",
  "operations": [
    {
      "type": "createShape",
      "temporaryId": "background",
      "parameters": {}
    },
    {
      "type": "createText",
      "temporaryId": "heading",
      "parameters": {}
    },
    {
      "type": "align",
      "targets": ["$heading"],
      "parameters": {}
    }
  ]
}
```

Temporary IDs allow later operations in the same batch to refer to newly created objects.

The coding agent should decide whether this fits the existing command architecture.

Possible alternatives:

- command arrays;
- transaction scripts;
- declarative patches;
- command graphs;
- document diffs.

Choose the simplest solution that integrates naturally with Lighttable.

---

# 11. Declarative Design Construction

In addition to low-level semantic commands, consider a higher-level design construction format.

The purpose is to let an agent describe a composition in one structured request.

Example conceptual structure:

```text
canvas
styles
assets
elements
groups
constraints
effects
```

This could be useful for:

- posters;
- banners;
- thumbnails;
- social media images;
- advertisements;
- storyboards;
- simple infographics;
- compositing;
- image layouts;
- title cards;
- presentation visuals;
- design templates.

The declarative format should compile into native Lighttable objects.

It must not create an opaque flattened result unless explicitly requested.

After creation, users should still be able to manually edit:

- layers;
- text;
- vector shapes;
- paths;
- masks;
- effects;
- adjustments;
- transforms.

Do not prioritize this layer before the underlying semantic application operations are reliable.

A likely implementation order is:

```text
existing command exposure
    ↓
safe structured MCP tools
    ↓
batch execution
    ↓
visual inspection
    ↓
declarative design construction
```

---

# 12. Visual Feedback

An AI agent cannot design effectively from document metadata alone.

It needs to see rendered output.

Expose a render or preview capability that can return:

- full document preview;
- current viewport;
- specific artboard;
- selected region;
- individual layer;
- group;
- mask;
- alpha;
- before/after comparison;
- optional diagnostic overlay.

The renderer should use Lighttable's real GPU render stack.

Do not create a simplified alternative renderer specifically for AI.

A preview response should include enough metadata to connect the image to the document state:

```text
document ID
document revision
rendered bounds
output dimensions
scale
color profile information where relevant
selected object IDs
overlay mode
```

---

# 13. Visual Inspection Overlays

Diagnostic overlays can make agent control significantly more accurate.

Useful optional overlays may include:

- object bounds;
- object IDs;
- layer IDs;
- selection bounds;
- text frames;
- baselines;
- anchors;
- transform pivots;
- clipping boundaries;
- masks;
- guides;
- alignment lines;
- margins;
- safe areas;
- transparency;
- overdraw;
- current crop;
- path points.

Do not implement all overlays immediately.

Start with high-value overlays that reuse existing editor rendering:

1. object bounds;
2. object IDs;
3. selection;
4. guides;
5. text frames.

An object-ID overlay is especially useful because an AI vision model can identify which visible object needs modification and then address it by stable ID.

---

# 14. Reference Images and User Images

The agent should be able to inspect images already present in the document or imported as references.

Possible reference roles:

```text
content reference
style reference
layout reference
color reference
identity reference
lighting reference
composition reference
```

These roles help distinguish user intent.

For example:

```text
Use this image for layout only.
Do not reuse its text.
Preserve the subject identity.
Use the color palette but not the composition.
```

Do not build a complex reference schema prematurely.

Initially, it may be enough to let the agent access:

- the asset;
- a thumbnail;
- dimensions;
- metadata;
- its document usage;
- an optional user-provided description of its role.

---

# 15. Local MCP Architecture

Lighttable should be able to expose agent tools locally.

Possible local transports include:

- MCP over stdio;
- MCP over localhost HTTP;
- MCP over localhost streaming HTTP;
- an internal IPC bridge to a small MCP host process.

The exact transport should be chosen based on:

- the MCP SDK used;
- Electron process boundaries;
- compatibility with Codex and Claude tooling;
- compatibility with local LLM clients;
- security;
- ease of development;
- process lifecycle;
- logging;
- crash isolation.

A possible architecture is:

```text
Local AI Client
    ↓
MCP transport
    ↓
Lighttable MCP Host
    ↓
Lighttable application bridge
    ↓
Commands / Actions / Services
```

The MCP host may live:

- inside the Electron main process;
- in a dedicated child process;
- in a local companion service;
- in the renderer process only if security and lifecycle remain acceptable.

The coding agent must evaluate the current Lighttable architecture before choosing.

A dedicated process may provide:

- crash isolation;
- simpler networking;
- cleaner authentication;
- reuse when Lighttable is not focused;
- clearer separation between external input and editor internals.

But it also adds:

- IPC complexity;
- process lifecycle management;
- deployment complexity;
- synchronization concerns.

Do not assume a separate process is automatically better.

---

# 16. Connecting Local Lighttable to ChatGPT

A local MCP server on `localhost` is normally not directly reachable by a cloud-hosted ChatGPT client.

A bridge is required.

Conceptual setup:

```text
ChatGPT
    ↓
Public HTTPS endpoint
    ↓
Secure tunnel or relay
    ↓
Local Lighttable MCP server
    ↓
Lighttable
```

Possible approaches include:

- Cloudflare Tunnel;
- ngrok;
- Tailscale Funnel;
- a small authenticated relay service;
- a future Lighttable account service that brokers sessions.

This document does not prescribe one provider.

The first implementation should optimize for local development and security rather than production scale.

## Local-only phase

Start with:

```text
Codex / Claude Desktop / local MCP client
    ↓
localhost or stdio
    ↓
Lighttable MCP interface
```

This allows the tool surface to mature without exposing it publicly.

## Remote ChatGPT phase

Later add:

```text
ChatGPT
    ↓
authenticated HTTPS bridge
    ↓
local Lighttable MCP interface
```

The remote bridge must not expose an unrestricted local editor API to the internet.

---

# 17. Authentication and Session Pairing

For remote access, require explicit pairing.

Possible flow:

1. user enables remote agent access in Lighttable;
2. Lighttable creates a short-lived pairing session;
3. user connects ChatGPT or another client;
4. Lighttable shows the requested permissions;
5. user approves;
6. the client receives a scoped session token;
7. the session expires or can be revoked.

Potential session scopes:

```text
read_document
inspect_preview
edit_document
import_assets
export_files
save_document
access_local_files
run_external_processes
```

Avoid a single unrestricted permission.

The exact scope model should follow actual Lighttable risks and implementation boundaries.

---

# 18. Security Boundaries

External tool calls must be treated as untrusted input.

Validate:

- object IDs;
- document IDs;
- numeric ranges;
- dimensions;
- paths;
- file types;
- enum values;
- transform values;
- text sizes;
- effect parameters;
- batch sizes;
- maximum resource use;
- export destinations;
- asset URLs;
- serialized payload sizes.

Do not allow arbitrary filesystem access.

Prefer:

- project-relative paths;
- user-approved import locations;
- user-approved export locations;
- sandboxed temporary assets;
- explicit file picker approval for new directories.

Operations that may require confirmation:

- overwrite file;
- delete document;
- delete many layers;
- close unsaved document;
- save to a new location;
- access a local file outside the project;
- import remote content;
- execute external code;
- install plugins;
- invoke an external model;
- upload document content.

---

# 19. Read and Write Modes

Consider explicit operating modes:

## Read-only

The agent can:

- inspect documents;
- inspect selections;
- render previews;
- inspect metadata;
- inspect assets;
- query available tools.

## Assisted editing

The agent can prepare operations, but Lighttable asks for confirmation before committing important changes.

## Trusted editing

The agent may execute allowed editing operations directly within the current document.

## Automation mode

A restricted set of known workflows may execute without repeated confirmation.

Do not assume all users or clients should receive the same mode.

---

# 20. Tool Discovery

MCP clients work best when tool descriptions are precise.

Each exposed tool should clearly state:

- what it does;
- when it should be used;
- required inputs;
- optional inputs;
- returned data;
- whether it changes the document;
- whether it supports undo;
- whether it requires selection;
- whether it can be batched;
- important limitations;
- coordinate system;
- units;
- default behavior.

Avoid vague tool descriptions.

Bad:

```text
Edits a layer.
```

Better:

```text
Sets the opacity of one existing layer. The operation is undoable. Opacity is expressed from 0 to 1. The target layer must belong to the active document.
```

Tool discovery should preferably be generated from a central capability registry rather than duplicated manually.

This same registry may later support:

- MCP;
- internal command palette;
- scripting;
- plugin API;
- automated tests;
- macro recording;
- documentation;
- keyboard shortcut discovery.

---

# 21. Coordinate Systems and Units

Agent operations need unambiguous coordinates.

Document:

- document-space origin;
- axis directions;
- pixel units;
- normalized coordinates if supported;
- local object space;
- parent space;
- viewport space;
- transform pivot;
- rotation direction;
- angle units;
- scale representation;
- snapping behavior.

Do not let individual tools invent inconsistent coordinate conventions.

Document these centrally.

Prefer explicit parameters such as:

```text
coordinateSpace: document
unit: pixels
rotationUnit: degrees
anchor: center
```

Use defaults only where they are predictable.

---

# 22. Selection and Context

Some existing commands may depend on current selection or active tool state.

For external agents, prefer operations that explicitly identify targets.

Less reliable:

```text
set selected layer opacity
```

More reliable:

```text
set layer with ID X to opacity Y
```

Selection-based tools can still exist for conversational convenience, but the underlying application API should support explicit targets where possible.

The agent should be able to:

- inspect selection;
- set selection;
- clear selection;
- select by ID;
- select by query;
- select parent or children;
- set active object.

---

# 23. Asset Handling

Agents may need to:

- inspect document assets;
- place existing assets;
- import new files;
- replace linked assets;
- inspect thumbnails;
- inspect dimensions;
- inspect color profile;
- inspect alpha;
- create embedded or linked assets;
- relink missing assets.

Remote clients must not receive unrestricted access to the user's entire filesystem.

Create a clear distinction between:

```text
document assets
approved local assets
temporary agent assets
remote assets
generated assets
```

All imported assets should retain provenance metadata where practical.

Possible metadata:

- source type;
- original filename;
- import date;
- generated or user-provided;
- remote URL;
- model or service used;
- license notes;
- content hash.

Do not block initial implementation on full provenance support.

---

# 24. Render Feedback Loop

A good agent workflow should support iterative correction.

Example:

```text
1. Agent requests document summary.
2. Agent requests tree and current preview.
3. Agent creates a composition using a batch.
4. Lighttable returns new object IDs and revision.
5. Agent requests a preview with object bounds.
6. Agent identifies spacing or hierarchy issues.
7. Agent updates only the relevant objects.
8. Agent requests a clean final preview.
```

This is the core workflow that allows ChatGPT to genuinely design inside Lighttable.

The system should make iteration cheap.

Avoid requiring full document serialization or full-resolution export after every small change.

Use preview resolutions suitable for visual reasoning.

---

# 25. Preview Resolution Strategy

Potential preview modes:

```text
thumbnail
standard
high
region
native
```

The exact sizes should follow Lighttable's renderer and performance constraints.

Useful options:

- max width or height;
- crop region;
- current viewport;
- transparent or checkerboard background;
- display transform enabled;
- overlays enabled;
- include selection;
- include guides;
- before/after state.

Preview caching should use:

- document revision;
- render settings;
- region;
- scale;
- overlay mode.

Avoid rendering unchanged previews repeatedly.

---

# 26. Error Reporting

Return structured, actionable errors.

Example categories:

```text
document_not_found
object_not_found
stale_revision
invalid_parameter
unsupported_operation
locked_object
missing_asset
permission_denied
confirmation_required
render_failed
transaction_failed
resource_limit
```

Errors should explain:

- what failed;
- which object or command failed;
- whether anything was committed;
- current document revision;
- whether retry is safe;
- suggested corrective action where appropriate.

Do not expose raw internal stack traces to remote clients by default.

Keep full diagnostic logs locally.

---

# 27. Logging and Audit Trail

Record external agent operations separately from ordinary UI actions where possible.

Useful log information:

- timestamp;
- client identity;
- session ID;
- tool name;
- document ID;
- affected object IDs;
- transaction label;
- success or failure;
- duration;
- revision before;
- revision after;
- confirmation status.

This helps with:

- debugging;
- security;
- reproducibility;
- regression testing;
- user trust;
- undo history;
- improving tool descriptions.

Do not log sensitive image content or full document payloads unless explicitly needed for local diagnostics.

---

# 28. Automated Testing

The MCP interface should be testable without a language model.

Tests should invoke the same application-level operations directly.

Suggested test layers:

## Unit tests

- schema validation;
- capability registry;
- ID resolution;
- permission checks;
- revision checks;
- transaction rollback;
- coordinate conversion.

## Integration tests

- create document;
- create layers;
- edit transforms;
- create text;
- create paths;
- apply adjustments;
- render previews;
- undo and redo;
- save and reload.

## Visual regression tests

For deterministic test documents:

```text
open fixture
run operation batch
render at fixed settings
compare output
```

Use appropriate comparison methods:

- exact hash where output is guaranteed deterministic;
- perceptual hash;
- pixel difference threshold;
- SSIM-like comparison;
- region masks;
- tolerance for platform-specific GPU differences.

The MCP work should reuse or strengthen Lighttable's broader automated regression architecture.

---

# 29. Suggested Implementation Phases

## Phase 1 — Architecture audit

- inspect current command and action systems;
- inspect document and revision model;
- inspect undo support;
- inspect renderer access;
- inspect current MCP compatibility;
- create capability inventory;
- identify missing application-level operations.

Deliverable:

```text
docs/agent-control-capability-inventory.md
```

## Phase 2 — Local read-only MCP

Expose:

- application status;
- open documents;
- document summary;
- document tree;
- selection;
- object details;
- preview rendering;
- available capabilities.

Goal:

An external local client can understand what is open in Lighttable and see the rendered result.

## Phase 3 — Safe editing tools

Expose a small but useful set of editing operations derived from existing commands.

Prioritize operations needed to build a simple composition:

- create layer or object;
- create text;
- create common vector shape;
- transform;
- set basic appearance;
- group;
- move in hierarchy;
- delete;
- undo;
- redo.

Do not attempt to expose every feature at once.

## Phase 4 — Transactions and batching

- batch multiple commands;
- return created IDs;
- support one undo step;
- validate revisions;
- rollback failures.

## Phase 5 — Rich visual inspection

- object-bound overlays;
- object-ID overlays;
- selected-region rendering;
- layer rendering;
- text-frame overlays;
- mask and alpha preview.

## Phase 6 — Broader tool exposure

Expand coverage based on the capability inventory:

- paths;
- advanced text;
- masks;
- filters;
- adjustments;
- effects;
- assets;
- export;
- vector boolean operations;
- document settings.

## Phase 7 — Declarative design construction

Add an optional higher-level scene or design description layer that compiles into native Lighttable operations.

## Phase 8 — Secure remote connection

- authenticated HTTPS bridge;
- explicit pairing;
- scoped permissions;
- session revocation;
- remote confirmation UX;
- ChatGPT connection.

---

# 30. Questions the Coding Agent Must Resolve

Before choosing an implementation, answer:

1. What command/action infrastructure already exists?
2. Can every important UI operation already be triggered without UI simulation?
3. Which commands directly mutate state?
4. Which commands already support undo?
5. Is there an existing transaction abstraction?
6. How are stable IDs generated and persisted?
7. How is document revision tracked?
8. How can the GPU renderer produce an offscreen preview?
9. Can previews be rendered without disturbing the active viewport?
10. Which Electron process owns the document model?
11. Which process should host the MCP transport?
12. What IPC already exists?
13. Can the current command metadata generate MCP schemas?
14. Which commands are unsafe to expose remotely?
15. How are file paths currently validated?
16. How are plugins or external processes handled?
17. How can an agent session be clearly shown in the UI?
18. How will user edits and agent edits avoid conflicts?
19. Which operations should require confirmation?
20. What is the smallest useful end-to-end prototype?

---

# 31. Recommended First End-to-End Prototype

Build a narrow vertical slice.

The prototype should allow a local MCP client to:

1. detect that Lighttable is running;
2. list open documents;
3. inspect the active document summary;
4. retrieve a compact layer tree;
5. render a preview;
6. create a text object;
7. create a rectangle;
8. transform both objects;
9. set basic styling;
10. commit the result as one undoable transaction;
11. render the updated preview;
12. undo the full change.

This proves:

- transport;
- discovery;
- document access;
- command reuse;
- object IDs;
- revisions;
- transactions;
- rendering;
- visual feedback;
- undo integration.

Do this before exposing every editor feature.

---

# 32. Non-Goals for the First Version

Do not initially attempt to build:

- autonomous long-running design agents;
- arbitrary mouse and keyboard automation;
- a full natural-language parser inside Lighttable;
- a second scripting language;
- a second document model;
- unrestricted filesystem access;
- remote collaboration infrastructure;
- cloud document syncing;
- model hosting;
- automatic image generation;
- every Lighttable tool;
- production-grade account management;
- an elaborate declarative design language.

The first goal is a clean, reliable, testable control surface over the editor that already exists.

---

# 33. Desired Long-Term Result

The long-term experience should be:

```text
User:
Create a cinematic poster using the selected image.
Keep the person large on the right.
Add a dark blue gradient on the left.
Place a bold title and smaller subtitle.
Use the logo from the Assets group.
```

The agent should then:

1. inspect the selected image;
2. inspect available assets;
3. inspect the canvas;
4. create native Lighttable layers and objects;
5. render a preview;
6. inspect the composition visually;
7. correct spacing and hierarchy;
8. leave the document fully editable;
9. describe what it changed;
10. allow the user to undo the complete operation.

This should not be a flattened AI-generated picture.

It should be a real Lighttable document built through the same underlying systems used by the editor itself.

---

# 34. Final Direction

Treat MCP as one adapter over a broader **Lighttable Agent Control API**.

The most valuable architectural outcome is not merely “MCP support.”

It is that Lighttable gains a coherent, stable, semantic, testable application API that can support:

- ChatGPT;
- Claude;
- Codex;
- local LLMs;
- plugins;
- macros;
- automated tests;
- external scripts;
- workflow automation;
- future collaborative agents.

Implement the application control layer first.

Expose it through MCP second.

Add remote access only after local control, validation, permissions, transactions, and visual inspection are reliable.
