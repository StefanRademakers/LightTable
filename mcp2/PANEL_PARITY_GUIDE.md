# Capability-driven panel parity

Panel parity means LightTable can faithfully express the usable capabilities of each provider workflow. It does not mean forcing OpenArt, Higgsfield and local AI into identical forms or duplicating a provider website pixel-for-pixel.

## Composition model

Build the panel from four inputs:

```text
provider snapshot
  + discovered model/workflow schema
  + normalized semantic roles
  + small LightTable presentation hints
  -> native LightTable controls
```

The provider adapter owns translation. The panel never switches on raw provider field names to build a request.

## Navigation hierarchy

Preserve the provider selection and workflow structure LightTable already owns. A scalable logical hierarchy is:

```text
Provider
  -> output kind: Image / Video / Audio / 3D
  -> operation or input variant
  -> model
  -> workflow controls
```

Only show output kinds and operations for which the selected provider has a complete executable capability. Discovery without a submit/result transport may appear in a diagnostic catalog, but not as an enabled Generate workflow.

Examples:

- Image: Create, Edit, Inpaint where available.
- Video: Text, References, Frames, Edit, Extend where available.
- Audio: Text to speech, music, sound effects where available.
- 3D: Text to 3D, Image to 3D, Multi-view, Rig/Remesh where a real generation transport exists.

Do not let switching Image Create/Edit silently switch provider unless that behavior is an explicit saved preference. Provider choice, operation and model choice are separate state.

## Normalize meaning, preserve source fields

Extend `GenAiFieldRole` for common semantics while keeping `field.key` and `sourceSchema`:

| Semantic role | Typical source keys | UI meaning |
| --- | --- | --- |
| `prompt` | `prompt`, `user_prompt` | Main prompt composer |
| `negative-prompt` | `negativePrompt`, `negative_prompt` | Optional advanced prompt |
| `references` | `visualReferences`, `medias`, reference arrays | Reference tray |
| `first-frame` | `startFrame`, `start_image` | Required/optional first-frame slot |
| `last-frame` | `endFrame`, `end_image` | Optional paired last-frame slot |
| `source-video` | `input_video`, `video_references` | Source-video slot |
| `source-audio` | `input_audio`, `audio_references` | Source-audio slot |
| `aspect-ratio` | `aspectRatio`, `aspect_ratio` | Ratio control |
| `output-size` | `resolution`, `size` | Resolution/size control |
| `quality` | `quality`, `variant`, sometimes provider mode | Quality tier |
| `duration` | `duration`, `durationSeconds` | Discrete/ranged seconds control |
| `sound` | `sound`, `generate_audio`, `audio` | Sound toggle |
| `output-count` | `count`, `batch_size` | Number of outputs |
| `seed` | `seed` | Optional deterministic seed |
| `width` / `height` | `width`, `height`, output dimensions | Explicit dimensions when ratio is insufficient |

Aliases belong in provider adapters. Canonical roles belong in `genai-core`. Provider-specific fields remain generic discovered fields.

## Native control mapping

Use existing LightTable primitives and the live UI Style Guide.

| Field shape | Preferred control |
| --- | --- |
| required short enum, 2–4 frequent choices | segmented control when space permits |
| larger or advanced enum | select |
| boolean | canonical switch/checkbox according to existing form precedent |
| discrete duration list | snapped canonical slider with displayed selected value, or select when labels matter |
| bounded continuous number | slider plus numeric value where precision matters |
| bounded integer | stepper/numeric control; slider only when range is naturally scanned |
| unbounded/nullable number | numeric field with explicit Auto/Unset state |
| string | text field |
| long prompt/instruction | prompt composer/textarea |
| color | canonical color control, not a raw HTML input |
| reference array | typed reference tray with max count and role labels |
| conditional group | reveal only when its controlling value activates it |

Do not invent provider-colored focus rings, sliders or private control CSS. Feature CSS arranges controls; shared primitives own interaction styling.

## Presentation hints, not duplicate schemas

A small presentation table may define:

- friendly label;
- basic versus advanced placement;
- preferred order;
- control presentation;
- help text;
- intentionally locked product preset.

It must not redefine:

- enum values;
- min/max/step;
- required state;
- media types or role limits;
- conditional validity;
- pricing.

Those remain live-schema/adapter facts.

## Conditional rules

Some provider constraints exist only in descriptions or model-specific knowledge. Normalize them into explicit rules:

```ts
type GenAiWorkflowRule =
  | { when: Condition; require: readonly string[] }
  | { when: Condition; forbid: readonly string[] }
  | { when: Condition; constrain: { field: string; values: readonly unknown[] } }
  | { when: Condition; referenceLimit: number };
```

Examples:

- Frames requires a first frame; last frame may be optional.
- A last frame cannot exist without a first frame.
- Seedance fast mode may restrict resolution.
- A 3D PBR option may require Pro/Full mode.
- A model may support sound only at particular durations or resolutions.
- Explicit width/height may be mutually exclusive with aspect ratio.

Validate these in the workflow adapter before enabling Generate.

## Hidden or locked controls

Hide a field only when:

- the workflow is an intentional LightTable preset;
- the locked value is valid in the current live schema;
- the adapter still submits and records it explicitly;
- recreate restores the same intent;
- cost estimation uses the same locked value.

Do not hide a provider field merely because the first tested model used its default. Defaults and available values drift.

## Reference tray variants

The same generic tray can be configured by semantic slots:

```text
General references: ordered list, mixed accepted media kinds
Frames: named first and last slots
Edit: base image + optional additional references
Inpaint: base image + selection mask + optional references
Video edit: source video + optional references/audio
3D multiview: ordered or named view slots
```

The UI passes canonical purposes. It does not assign OpenArt form keys or Higgsfield media-role strings.

## Cost and credits

- Show an estimated cost on or near Generate only from a read-only estimator.
- Show available credits as provider/account status, not a workflow field.
- Re-estimate on cost-relevant changes using a debounce.
- Display unknown rather than a static guess.
- Never block local AI because a remote provider's balance call fails.

## Partial provider availability

Availability is per capability:

```text
OpenArt connected
  image create: ready
  image edit: ready
  video frames: schema ready, upload ready, polling ready

Higgsfield connected
  image create: ready
  video references: disabled — no verified polling capability
  3D: catalog only — no generate_3d transport

Local AI ready
  image create/edit/inpaint: ready
```

Do not reduce this to one global green/red provider boolean.

## Catalog refresh behavior

- Load the last-good catalog for immediate UI projection.
- Refresh lazily after connection and on explicit Refresh.
- Mark cached/stale data in diagnostics, not necessarily in the primary panel.
- Require live validation before a paid submit when the catalog is stale.
- On schema validation errors, invalidate only that model/workflow cache.
- Reconnect clears OAuth/discovery session state; Refresh does not silently reauthorize.
