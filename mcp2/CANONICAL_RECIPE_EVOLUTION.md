# Evolving the existing request into a portable recipe

LightTable does not need a second recipe subsystem. `GenAiGenerationRequest` already contains most of the durable provider-independent intent:

- provider, model and workflow identity;
- original and provider-resolved prompt;
- prompt bindings;
- requested output;
- provider-form fields;
- ordered project references;
- image operation and product intent;
- base image and selection-mask semantics.

The safe direction is to version and enrich this contract, not replace it.

## Separate four layers

```text
Editor setup
    what the user saw and can restore exactly

Canonical recipe
    portable semantic intent

Provider contract snapshot
    live schema/capabilities used to validate and translate

Execution record
    prepared transports, submitted params, job id and diagnostics
```

These objects have different lifetimes and must not collapse into one JSON blob.

## Suggested canonical shape

This is direction, not a frozen schema:

```ts
interface CanonicalGenerationRecipeV2 {
  schemaVersion: 2;
  kind: 'image' | 'video' | 'audio' | '3d';
  operation: string;
  intent: string;
  workflow: {
    family?: string;
    inputVariant?: 'text' | 'references' | 'frames' | 'edit' | 'extend';
  };
  prompt: {
    original: string;
    bindings: readonly {
      token: string;
      refUid: string;
    }[];
  };
  references: readonly {
    refUid: string;
    assetId: GenAiAssetId;
    mediaKind: 'image' | 'video' | 'audio';
    purpose: string;
    order: number;
    displayToken?: string;
    setId?: string;
    setPosition?: number;
  }[];
  parameters: {
    aspectRatio?: string;
    resolution?: string;
    durationSeconds?: number;
    sound?: boolean;
    count?: number;
    values: Readonly<Record<string, unknown>>;
  };
  preferredExecution?: {
    providerId?: GenAiProviderId;
    modelId?: GenAiModelId;
    mode?: string;
  };
}
```

The canonical recipe may know concepts such as duration, sound and resolution. It must not know that one provider calls them `generateAudio`, `audio`, `sound`, `resolution`, `quality` or nests them under another object.

## Stable reference identity

Current prompt bindings point to `assetId`. That works while one recipe references each asset once. A stable `refUid` becomes useful when:

- the same asset appears in more than one semantic role;
- an asset is both a first frame and an ordinary visual reference;
- a saved reference set preserves membership and position;
- references are reordered while tokens must stay bound;
- a future host maps one canonical reference to a rendered derivative.

`refUid` identifies the reference occurrence. `assetId` identifies the underlying project asset.

## Editor setup versus canonical recipe

The editor setup may contain:

- selected provider and model controls;
- expanded/collapsed sections;
- display tokens and reference-set origin;
- control values as shown by that provider's form;
- document/base-image selection state.

The canonical recipe contains only reusable semantic intent. Recreate should prefer the exact editor setup, then fall back to the canonical recipe when moving provider or reading older history.

## Provider snapshot

Persist enough evidence to explain a historical execution:

- provider ID and connector contract family;
- model ID and mode;
- schema/version fingerprint;
- normalized capability snapshot;
- adapter version;
- validation timestamp.

Do not store OAuth credentials or signed media URLs.

## Execution record

The execution record owns non-portable facts:

- provider-resolved prompt;
- actual submitted field names and sanitized values;
- reference role mappings;
- provider asset IDs;
- provider job/history ID;
- cost quote;
- polling/recovery metadata;
- response-shape diagnostics;
- result URLs and downloaded asset IDs.

This record supports debugging and recovery. It is not reused blindly for a new generation.

## Cross-provider recreate

Cross-provider recreate means “preserve semantic intent where representable,” not “send identical JSON.”

The target adapter should report:

- exact matches;
- fields mapped through canonical semantics;
- unsupported references or modes;
- values outside the target model's range;
- required target fields without a source value.

Do not silently clamp, drop references, turn frames into general references or enable/disable sound. Ask for correction in the setup UI before submission.

## Migration

- Keep the existing request reader.
- Add an explicit schema version for new durable recipes.
- Derive V2 from current setup at submission time.
- Do not rewrite old history in place.
- Add lazy readers for known legacy shapes.
- Store editor setup, canonical recipe and execution record separately whenever persistence allows it.

This can be introduced as a strangler migration while OpenArt and local AI continue using their current proven adapters.
