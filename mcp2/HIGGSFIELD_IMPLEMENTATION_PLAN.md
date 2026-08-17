# Adding Higgsfield without disturbing existing providers

This is a staged implementation direction, not an instruction to rewrite the current GenAI system in one change.

## Desired package shape

Add a provider package parallel to OpenArt:

```text
packages/genai-higgsfield/
  discovery and schema normalization
  canonical parameter mapping
  reference-role mapping
  response normalization
  contract fixtures/tests

apps/desktop/src/genai/
  Higgsfield OAuth connection controller
  encrypted credential store
  cached catalog store
  media publisher
  generation runtime/polling adapter
```

Do not import Electron, filesystem, React or editor code into `genai-higgsfield`. Desktop owns credentials, absolute paths, bytes, upload HTTP and durable output.

## Step 1: preserve and test the current baseline

Before wiring Higgsfield:

- lock current OpenArt discovery, upload and generation tests;
- lock `genai-local` multipart create/edit/inpaint tests;
- lock managed local process lifecycle tests;
- lock project job restart recovery tests;
- run the GenAI boundary verification.

These become regression gates for every Higgsfield milestone.

## Step 2: add connection and contract classification only

Implement user-scoped OAuth/PKCE using the same desktop security boundary as OpenArt. Do not hardcode guessed authorization/token URLs; use MCP/OAuth discovery.

After connection:

1. list tools;
2. normalize safe tool metadata;
3. classify a tested Higgsfield contract family;
4. record a contract fingerprint and last validation time;
5. expose connected/degraded/error state;
6. provide Check/Refresh and full Reconnect separately.

No generation is needed for this milestone. It is credit-free.

## Step 3: discovery and workflow projection

Implement discovery for each supported family:

- `models_list`/`models_get`; or
- `models_explore(action=get, model_id=...)`.

Normalize into existing `GenAiModelSummary` and `GenAiWorkflowDefinition`. Preserve raw schemas and raw media roles for diagnostics.

Extend provider-neutral field roles only for genuinely shared semantics. Video likely needs roles such as:

- duration;
- sound/audio-generation toggle;
- input variant (`references`/`frames`);
- first/last frame;
- source video/audio.

Do not name canonical roles after Higgsfield parameter keys. Unknown fields remain provider-defined fields with their raw schema.

Start with a narrow explicitly supported model set. Do not enable every discovered model merely because it appears in the catalog.

## Step 4: generalize desktop execution by capability

Move the current `main.ts` provider branching behind a small runtime registry without changing the renderer-facing `GenAiHostPort`.

Recommended independent capabilities:

```ts
interface ProviderInputPreparer { prepare(...): Promise<PreparedGeneration> }
interface ProviderSubmitter { submit(...): Promise<ProviderSubmission> }
interface ProviderPoller { poll(...): Promise<ProviderCompletion> }
interface ProviderCostEstimator { estimate(...): Promise<GenAiCostEstimate | null> }
interface ProviderCanceller { cancel(...): Promise<void> }
```

A runtime advertises only capabilities it safely implements. Local AI continues to prepare multipart bytes; OpenArt and Higgsfield prepare remote/provider assets.

Avoid one broad interface containing workspace, marketing, elements, 3D and every future provider feature. Those are optional extensions.

## Step 5: Higgsfield media publication

Implement one verified strategy at a time:

### Preferred native upload family

```text
media_upload -> signed PUT -> media_confirm -> media UUID
```

Validate live argument schemas and upload response fields. Send confirmed media UUIDs to generation.

### Authorized URL family

Enable only if the live generation contract explicitly accepts authorized HTTPS media. A provider-specific publication service may create a short-lived fetchable URL. It must not be a local path, data URL or permanent public exposure.

Never fall back between strategies during a paid attempt. Input preparation completes before the paid boundary.

Store publication cache entries with provider, source content revision and expiry. Retain returned provider media IDs.

## Step 6: image generation first

Add one image-create and one image-edit model with captured live fixtures. Verify:

- prompt and reference binding;
- all selected references sent once and in order;
- upload reuse only for unchanged bytes;
- schema-derived fields/defaults/limits;
- standalone cost estimate if available;
- exactly one generation call;
- immediate provider ID persistence;
- polling/recovery;
- durable output before editor placement;
- recreate restores setup without submitting.

Only then expand the image catalog.

## Step 7: video generation as a separate milestone

Video needs additional semantic modeling and a higher credit-risk gate. Support explicit variants:

- References;
- Frames;
- text-to-video where no media is required;
- edit/extend only when the live schema confirms source-video semantics.

Candidate models seen in provider work include Seedance 2/2.5, Kling 3, MiniMax H3, Gemini Omni Flash and FLUX 3 Video, but live discovery remains authoritative. A model appearing in a dated snapshot is not evidence that its current connector path works.

Do not enable a video workflow until submit, identifier extraction, polling and result retrieval are all verified as one complete contract family.

## Step 8: optional Higgsfield extensions later

Keep these outside the initial provider core:

- reusable Higgsfield elements;
- workspace selection;
- balance/credits presentation;
- Marketing Studio;
- audio generation;
- 3D generation.

The catalog exposing a model is insufficient when no callable transport exists.

## Migration strategy

Use additive registration:

```text
existing OpenArt runtime     unchanged consumer contract
existing local HTTP runtime  unchanged protocol
new Higgsfield runtime       new provider registration
```

Do not migrate old jobs or rewrite stored recipes during initial integration. Version new canonical fields explicitly and keep readers for existing history.

## Stop conditions

Stop and fail closed when:

- OAuth/discovery cannot establish a supported contract family;
- a required tool or required input field is missing;
- a selected model's current schema cannot be normalized safely;
- any selected reference cannot be published;
- reference roles cannot be mapped without guessing;
- cost is required by policy but no read-only estimator exists;
- generation returns no unambiguous provider identifier;
- asynchronous workflows expose no verified retrieval path;
- returned media cannot be validated.

None of these conditions may disable unrelated providers.
