# OpenArt and Higgsfield provider contracts

Both providers are remote OAuth-backed generation services exposed through MCP, but their discovery, uploads, generation envelopes and job lifecycle are not interchangeable. Share canonical intent; keep separate adapters.

## Capability comparison

| Capability | OpenArt | Higgsfield |
| --- | --- | --- |
| Authentication | OAuth, user-scoped | OAuth, user-scoped |
| Model discovery | `openart_model_list` | Connector-family dependent: `models_list`/`models_get` or `models_explore` |
| Workflow schema | `openart_model_form_get(model, mode)` JSON Schema | Model records with parameters, medias, ratios, durations and rules/descriptions |
| Cost | `openart_model_cost` | Prefer standalone `estimate_image_cost` / `estimate_video_cost` when exposed |
| Image generation | `openart_generate_image` | `generate_image` |
| Video generation | `openart_generate_video` | `generate_video` |
| Job identity | `historyId` | Generation/job UUID in connector-dependent response shape |
| Polling | `openart_creation_get(historyId)` | Contract-family dependent; `job_status` exists in the StoryBuilder-native facade but not in the ChatGPT snapshot |
| Native local-file helper | Host-specific pickers are unsuitable | `media_upload_and_confirm` is OpenAI-host-specific and unsuitable for arbitrary Electron bytes |
| Native programmatic upload observed | `openart_upload_sign` -> PUT -> `openart_upload_metadata_get` | StoryBuilder-native facade: `media_upload` -> PUT -> `media_confirm`; otherwise authorized HTTPS import where live schema permits |
| Reference representation | Array of typed media objects with URLs/labels | `{ role, value }`, where value can be confirmed media UUID, accepted generation UUID or authorized HTTPS URL depending on live contract |

## OpenArt adapter facts

### Discovery

Use the live chain:

```text
openart_model_list
    -> model + mode
openart_model_form_get(model, mode)
    -> current JSON Schema
schema normalizer
    -> GenAiWorkflowDefinition
```

Do not assume every model has the same resolution, reference field, negative prompt, sound control or output-count field. Keep raw schema fragments and a schema fingerprint for diagnostics and recreate.

The 2026-08-11 export contained 16 models and 41 modes. That count became stale shortly afterward. Counts and model lists are evidence, not product configuration.

### Tool compatibility

Require only the tools needed by the enabled capability. Never reject an OpenArt connector because it exposes a new additive tool such as `openart_creation_wait`.

Example:

```text
Image workflow requires:
  openart_model_form_get
  openart_generate_image
  a supported result retrieval capability

Video workflow requires:
  openart_model_form_get
  openart_generate_video
  a supported result retrieval capability
```

Upload signing is a separate optional/required capability depending on whether references need publication.

### Upload contract drift

The old export lists `openart_upload_pick` and `openart_upload_metadata_get`, but not `openart_upload_sign`. Current LightTable code discovers and uses `openart_upload_sign` successfully.

Therefore:

- inspect `listTools()` at connection time;
- validate the live input schema;
- map semantic arguments to discovered field aliases;
- never design native uploads around the ChatGPT/OpenAI upload picker;
- never treat the signed PUT URL as the durable visual-reference URL;
- never log signed query values.

### Cost projection

StoryBuilder observed frame workflows where the generation form requires `startFrame`/`endFrame`, but `openart_model_cost` rejects those media transport objects. Cost and submission therefore need distinct adapter projections built from the same canonical recipe.

Rules:

- a cost call is read-only and must never call a generation tool;
- strip only transport-only fields that the live cost contract rejects;
- keep all required media in the real submission;
- a failed estimate hides the price; it must not block a valid generation unless product policy explicitly requires a quote.

## Higgsfield adapter facts

### There is more than one observed connector facade

Do not mix these as if they are one guaranteed tool set.

#### ChatGPT connector snapshot, 2026-08-14

Observed tools include:

- `models_list`, `models_get`, `models_search`, `models_recommend`;
- `generate_image`, `generate_video`, `generate_audio`;
- `estimate_image_cost`, `estimate_video_cost`;
- `media_upload_and_confirm`;
- `show_generations`, `job_display`;
- workspace, balance, marketing and reference-element tools.

Limitations:

- the upload helper accepts an OpenAI attachment reference, not arbitrary Electron bytes;
- no ordinary generic image/video `job_status` tool was exposed;
- 3D models were discoverable without a callable `generate_3d` tool.

#### StoryBuilder user-scoped/native facade, observed in production

Observed required tools:

- `models_explore`;
- `media_upload`;
- `media_confirm`;
- `generate_image`, `generate_video`;
- `job_status`, `job_display`.

This facade supports programmatic byte upload and polling. Its schemas and response containers differ from the ChatGPT facade.

### Correct compatibility policy

At connection time:

1. negotiate OAuth and list tools;
2. classify the tool surface into a tested contract family;
3. validate only required tool input schemas for the desired capability;
4. record a safe contract fingerprint;
5. enable only workflows whose complete discovery/upload/submit/poll path exists;
6. expose reconnect/refresh when OAuth or the discovery cache is stale.

Do not silently combine `models_list` from one family with `media_upload` or `job_status` assumptions from another. Do not require one historical family when the live connector offers another complete supported family.

### Model discovery and rules

The Higgsfield catalog exposes fields such as:

```ts
type HiggsfieldModelRecord = {
  id: string;
  name: string;
  output_type: 'image' | 'video' | 'audio' | '3d';
  parameters: unknown[];
  medias: unknown[];
  aspect_ratios: string[];
  durations?: number[];
  duration_range?: { min: number; max: number };
  tags: string[];
};
```

Flat schemas do not express every cross-field rule. The normalized workflow may need explicit conditional rules for:

- reference versus frame mode;
- required start frame and optional/paired end frame;
- mode-specific resolution or duration restrictions;
- sound availability;
- maximum reference count and accepted media kinds;
- models that require a start image before a reusable element is honored.

Preserve raw media-role strings for diagnostics, but map them to canonical semantics before UI or recipe storage.

### Generation identifier extraction

Observed Higgsfield responses have varied between direct fields, singular `id`, plural `ids`, nested `structuredContent.results`, MCP text content containing JSON and presentation metadata.

An adapter should:

- parse only explicitly supported response shapes;
- accept only an unambiguous valid identifier;
- persist it before polling;
- report response shape and field paths without values when parsing fails;
- never submit again merely because no identifier was extracted.

An accepted generation with an unreadable response may already have consumed credits. That is `unknown-submit`, not a retry signal.

### Polling

If the live contract exposes `job_status`, poll the persisted identifier and treat transient network/502/503/504 responses as recoverable tracking failures. Never regenerate.

If the live contract does not expose a safe status operation, LightTable needs a separately verified transport behavior before enabling paid asynchronous workflows. `job_display` and history presentation helpers are not automatically equivalent to a durable status API.

Do not invent a polling endpoint.

## Authentication and account isolation

Both remote providers must be connected per desktop user/profile. Credentials belong in Electron `safeStorage`; they must not be global application credentials shared across unrelated users.

OAuth discovery and registration state can become stale even while an old token still appears connected. A manual Reconnect must clear the provider's stored OAuth/discovery session and start a clean authorization flow. Check/refresh and Reconnect are different actions.
