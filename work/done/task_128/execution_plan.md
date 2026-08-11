# Task 128 — Native GenAI panel execution plan

## Outcome

Status: IMPLEMENTED AND TARGETED-AUTOMATION VERIFIED. Live provider acceptance
still requires the owner's connected OpenArt and LightTable server sessions;
that manual check is not represented as automated evidence.

LightTable gets a native GenAI panel that initially connects to OpenArt and
then grows one verified model/workflow at a time. The feature remains isolated
from the editor and renderer, uses existing LightTable controls, stores output
inside the active project, and can later support other providers without
adding provider conditions throughout the UI.

## Non-negotiable boundaries

- Do not port the 5,000-line StoryBuilder `GenAIPage.tsx` component.
- Do not copy StoryBuilder CSS or introduce a second control system.
- React never reads absolute paths, credentials, or provider tokens.
- Provider code does not import editor, document, render, Dockview or React code.
- The GenAI feature never enters the frame loop or dirties the document renderer.
- Provider SDKs and model catalogs are loaded lazily.
- The renderer receives normalized models, fields, jobs and status snapshots.
- Project and media access happens through explicit host ports.
- The checked-in `mcp` schemas are fixtures/bootstrap data, not duplicated as
  hand-written model-specific React forms.
- Runtime discovery validates or refreshes the known catalog; temporary
  provider failure must not make the basic panel unusable.
- Paid/remote submits are never retried silently after an ambiguous response.

## Target structure

The exact filenames may change when existing package boundaries demand it, but
dependency direction may not be reversed.

```text
packages/genai-core/
  src/domain/             provider, catalog, field, reference and job types
  src/application/        provider-neutral commands and state transitions
  src/schema/             JSON Schema normalization and validation

packages/genai-openart/
  src/catalog/            OpenArt model/form discovery adapter
  src/generation/         submit, status, result and cancellation adapter
  src/parsing/            typed MCP response normalization

apps/desktop/src/genai/
  OpenArtConnectionService
  OpenArtOAuthSession
  SecureCredentialStore
  GenAiIpcHandlers
  LocalGenerationStorage

packages/lighttable-app/src/genai/
  application/            renderer-side controller and host bridge
  ui/                     small native LightTable panel components
```

`genai-core` must remain usable by both desktop and a future web host.
Electron-specific OAuth, secure storage and filesystem behavior stay in
`apps/desktop`.

## Canonical contracts

Define these provider-neutral concepts before building model forms:

- `GenAiProviderId`
- `GenAiProviderStatus`: disconnected, connecting, connected, error, expired
- `GenAiModelSummary`
- `GenAiWorkflowDefinition`
- `GenAiFieldDefinition`
- `GenAiAssetReference`
- `GenAiPromptBinding`
- `GenAiGenerationRequest`
- `GenAiGenerationJob`
- `GenAiGenerationResult`
- `GenAiProviderAdapter`
- `GenAiProjectPort`

Each job preserves its LightTable job ID, provider, model, mode, provider job
ID, original editor input, normalized provider request, timestamps, state and
result references.

## Phase 0 — Research and architecture lock

- [x] Read task 128 and its Electron porting notes.
- [x] Inspect StoryBuilder panel, prompt references, job contract and provider UI.
- [x] Inspect StoryBuilder OpenArt OAuth and MCP adapters.
- [x] Read the checked-in OpenArt MCP export, docs, schemas and sample queries.
- [x] Identify StoryBuilder-only behavior that must not be ported.
- [x] Choose a provider-neutral core with host/provider adapters.
- [x] Confirm package names against current workspace boundary rules:
  `@lighttable/genai-core` and `@lighttable/genai-openart`.
- [x] Record the dependency graph in
  `architecture/features/GENAI_BOUNDED_CONTEXT.md` before implementation.

Acceptance gate:

- Boundary verification can express the intended imports without exceptions
  from rendering/editor internals into GenAI.

## Phase 1 — Surface the native panel

- [x] Add GenAI as one built-in Dockview workspace panel.
- [x] Register it centrally in `workspacePanelRegistry`.
- [x] Add a View-menu command for showing/focusing the panel.
- [x] Let the AI menu focus the same panel; do not create a second surface.
- [x] Build the shell from existing LightTable panel, button, select, switch,
  input, disclosure, status and empty-state controls.
- [x] Initial panel shows provider state, Connect action and an intentionally
  small empty generation area.
- [x] Panel state survives normal Dockview layout persistence.
- [x] No provider SDK is downloaded/initialized merely by starting LightTable.
- [x] Add a UI/style-guide fixture for the panel states.

Acceptance gate:

- The panel can be opened, docked, floated, closed and restored.
- It visually belongs to LightTable and introduces no duplicate primitives.
- Opening/closing it does not affect canvas interaction or frame timing.

Suggested commit: `feat(genai): surface native provider panel`

## Phase 2 — Provider connection foundation

- [x] Define provider-neutral connection commands and snapshots in the core.
- [x] Implement desktop OpenArt OAuth using the MCP client and PKCE.
- [x] Open authorization in the system browser.
- [x] Receive the callback through a temporary loopback listener bound to
  `127.0.0.1` with state validation and a short timeout.
- [x] Store credentials using Electron `safeStorage`; never expose tokens to
  the renderer or project files.
- [x] Support SDK-managed refresh, explicit disconnect and credential invalidation.
- [x] Preserve stored credentials when a new login attempt fails.
- [x] Verify connection with a real MCP handshake/ping before showing green.
- [x] Connect the existing AI > Providers > OpenArt red/green status to the
  same source of truth as the panel.
- [x] Red OpenArt click starts/focuses the connection flow.
- [x] Restore and validate a stored session without opening the browser on startup.
- [x] Distinguish expired credentials from other actionable connection errors.
- [x] Add targeted refresh and IPC contract tests (state and timeout are covered).

Acceptance gate:

- Restarting LightTable restores a usable encrypted session when possible.
- Renderer inspection cannot reveal access or refresh tokens.
- Menu and panel cannot disagree about provider status.

Suggested commit: `feat(genai): add secure OpenArt connection service`

## Phase 3 — Catalog and schema foundation

- [x] Inventory the relevant files in `mcp/openart-lighttable-mcp-export-*`.
- [x] Convert captured schemas/responses into stable test fixtures without
  copying provider UI or model-specific React code.
- [x] Implement normalized model-list and model-form queries.
- [x] Implement a generic JSON-Schema-to-`GenAiFieldDefinition` normalizer.
- [x] Preserve unsupported fields losslessly and report them in diagnostics.
- [x] Add optional LightTable presentation hints separately from provider
  schemas.
- [x] Cache the last validated catalog with source/version/timestamp metadata.
- [ ] Use checked-in fixtures as bootstrap/offline diagnostics, not as an
  authoritative forever catalog.
- [x] Lazy-load the OpenArt adapter only after connection/catalog use.
- [x] Add fixture tests for required values, enums, ranges, booleans, strings,
  nullable values, references and unknown schema constructs.

Acceptance gate:

- A provider form can change without requiring edits to `GenAiPanel.tsx`.
- Known fixture schemas normalize deterministically.
- Unknown fields are not silently discarded.

Suggested commit: `feat(genai): normalize OpenArt model catalog schemas`

## Phase 4 — First usable image workflow

- [x] Expose the verified Nano Banana Pro and GPT Image 2 workflows through
  the same runtime model-selection path.
- [x] Add model/workflow selection using existing LightTable selects.
- [x] Render its normalized primary fields with existing controls.
- [x] Surface model-specific `quality` through the shared featured-settings
  presentation when the live schema provides it.
- [x] Put uncommon compatibility fields under the existing Advanced pattern.
- [x] Add a plain prompt editor first; keep prompt state outside the component.
- [x] Add a project-backed reference picker through safe host adapter IDs.
- [x] Map prompt bindings to provider `visualReferences` without exposing
  local paths, and reject unresolved references before a paid submit.
- [x] Add the desktop reference publisher/short-lived HTTPS relay for locally
  authored project assets; `openart_upload_pick` cannot receive native bytes.
- [x] Never place absolute paths in React state or persisted panel state.
- [x] Validate required fields, enums, numeric bounds and reference counts before submission.
- [x] Add cost lookup/presentation when the provider supplies it.
- [x] Persist the editable setup per project without changing document format.

Acceptance gate:

- The user can select the verified model, enter a prompt, attach accepted
  references and obtain a valid preflighted request.
- No request is submitted in this phase unless its normalized contract passes.

Suggested commit: `feat(genai): add first OpenArt image setup workflow`

## Phase 5 — Job execution and local output

- [x] Add a desktop-owned persistent job state machine.
- [x] Generate a LightTable job ID and idempotency key before remote submit.
- [x] Store the provider job ID immediately after a successful submit.
- [x] Poll only while non-terminal jobs exist; use backoff and cancellation.
- [x] Distinguish failed, cancelled, expired-auth and unknown-submit states.
- [x] Download output without buffering unnecessarily large assets in React.
- [x] Validate content type and filename before storage.
- [x] Save every output atomically into the active project's logical
  `aiHistory` location (by default `AiRenders/History`) before editor import.
- [x] For image edit, place the saved result as the top layer of the active document.
- [x] For image create, open the saved result as a new document.
- [x] Track remote completion, durable local save and editor placement as separate
  job stages so a failed placement never loses a paid render.
- [x] Update project asset index and thumbnail through existing project services.
- [x] Persist setup, prompt, references and provider metadata with the job/result.
- [x] Add targeted recovery tests for restart during submit and poll; durable
  asset/index tests cover the local-save boundary.

Acceptance gate:

- One verified OpenArt workflow completes from prompt to indexed local asset.
- Restarting during a known remote job resumes rather than duplicates it.
- An ambiguous paid submit is visible and never silently repeated.

Suggested commit: `feat(genai): persist OpenArt generation jobs and outputs`

## Phase 6 — Queue and history UI

- [x] Register Queue & History as its own saved-layout Dockview panel; do not
  consume generation-setup panel space.
- [x] Add compact queue rows for active and failed jobs.
- [x] Add explicit stop-tracking, resume-when-safe and reveal-error actions.
- [x] Build a project-backed history grid from the existing asset index.
- [x] Reuse project thumbnails; do not generate duplicate panel thumbnails.
- [x] Allow opening a result as a LightTable document.
- [x] Allow restoring its generation setup.
- [x] Keep history and job domain data separate from transient component state.
- [x] Avoid broad project rescans while jobs update.

Acceptance gate:

- Queue updates do not rerender the editor document tree.
- Existing outputs remain browsable offline after restart.

Suggested commit: `feat(genai): add project generation queue and history`

## Phase 7 — Prompt asset mentions

- [x] Extract pure mention parsing, binding and provider-label translation from
  the StoryBuilder concept.
- [x] Preserve original editor prompt and provider-normalized prompt.
- [x] Start with reliable text editing before adding visual badges.
- [x] Add `@asset` suggestions from safe project asset references.
- [x] Add preview thumbnails via the existing project preview adapter.
- [ ] Verify IME, undo, selection, paste, keyboard navigation and missing assets.
- [ ] Do not copy StoryBuilder `innerHTML` synchronization blindly.

Acceptance gate:

- Reopening history restores readable tokens and their stable bindings.
- Missing or renamed assets cannot silently bind to a different file.

Suggested commit: `feat(genai): add stable project asset prompt mentions`

## Phase 8 — Expansion without architecture drift

- [ ] Add further OpenArt models one verified schema fixture at a time.
- [ ] Add image-edit references and document composite references.
- [ ] Integrate task 127's up-to-date document thumbnails as reference assets.
- [ ] Add video only after image job recovery is proven.
- [ ] Add Higgsfield and ComfyUI through the provider adapter boundary.
- [ ] Keep unavailable providers disabled rather than pretending support.
- [ ] Add provider/schema diagnostics to Debug, not the normal user UI.

## Final quality gate

- [x] Review all GenAI imports against the declared dependency direction.
- [x] Confirm no tokens, secrets or absolute paths reach renderer snapshots.
- [x] Confirm provider adapters/SDKs are not loaded during normal editor startup.
- [ ] Measure cold startup before/after and panel-open cost.
- [ ] Measure idle CPU/network activity with the panel closed and open.
- [ ] Exercise connect, reconnect, expiry, cancel, restart and offline behavior.
- [ ] Verify project switching cannot mix references, jobs or results.
- [x] Verify web builds compile with desktop-only adapters absent.
- [x] Run the relevant boundary, type, unit and desktop smoke tests once.
- [x] Update architecture, licenses and product assessment.
- [x] Move task 128 to `work/done` only after the first production-worthy
  vertical slice and its documented remaining expansion work are complete.

## Explicitly deferred

- Platform billing and credit reservation.
- Organization/multi-tenant provider credentials.
- Remote LightTable orchestration service.
- PromptVault and StoryBuilder boards/shots/timelines.
- Audio, 3D and text generation placeholders.
- A generic plugin marketplace.
- Copying every OpenArt model into the initial UI.
