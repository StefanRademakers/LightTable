# Media references, prompt bindings and upload transport

The canonical recipe describes what media means. The provider adapter decides how that media becomes reachable. This separation is the most important rule for a desktop application.

## Three identities that must not be confused

Every reference has at least three different identities:

1. **Canonical identity** — stable LightTable asset/reference ID used by recipes and recreate.
2. **Prompt label** — human-friendly token such as `@hero` and provider-facing alias such as `@image1`.
3. **Transport identity** — local multipart field, provider media UUID, generation UUID or authorized HTTPS URL.

Neither a display token nor a URL is the canonical identity.

## Authoritative reference membership

The Visual References widget/request list is authoritative. Prompt mentions add naming and semantic bindings, but must never filter the selected list.

Correct behavior:

```text
selected references: [hero.png, location.png]
prompt: "Place @hero near the window"

provider media: hero.png AND location.png
prompt binding: @hero -> hero.png -> provider alias image1
```

Do not drop `location.png` because it is not mentioned. Do not upload a mentioned asset twice if it is already selected.

## Canonical reference semantics

Extend references with semantic purpose rather than provider field names. Useful purposes include:

- `visual_reference`;
- `style_reference`;
- `character_reference`;
- `composition_reference`;
- `first_frame`;
- `last_frame`;
- `source_video`;
- `source_audio`;
- `element`;
- `base_image`;
- `selection_mask`.

The provider adapter maps those purposes:

| Canonical purpose | OpenArt example | Higgsfield native role example | Local protocol |
| --- | --- | --- | --- |
| visual reference | element/reference media item | `image` | multipart `reference-N` |
| first frame | `startFrame` | `start_image` | not currently supported by image-only local protocol |
| last frame | `endFrame` | `end_image` | not currently supported |
| source video | provider video field | `video` | not currently supported |
| source audio | provider audio field | `audio` | not currently supported |
| base image | image-to-image/base field | usually model-specific image role | multipart `base-image` |
| selection mask | mask field | only when model/schema confirms | multipart `selection-mask` |

Unsupported purposes must fail before submission. Never silently convert a last frame into an ordinary style reference, or a video into an image.

## Transport strategies

The desktop provider runtime chooses one explicit strategy per reference:

```ts
type PreparedReference =
  | { kind: 'local-multipart'; field: string; bytes: Uint8Array; mediaType: string }
  | { kind: 'provider-asset'; providerAssetId: string; mediaType: string }
  | { kind: 'authorized-url'; url: string; expiresAt?: number; mediaType: string }
  | { kind: 'provider-generation'; providerJobId: string; mediaType: string };
```

This is adapter/runtime data. It does not belong in the durable canonical recipe.

### Local providers

Resolve the asset bytes inside the desktop host and send multipart fields. No internet publication is required. A local path must still not cross into React or a remote request.

### OpenArt

Current native LightTable flow:

```text
read local bytes
    -> openart_upload_sign(metadata)
    -> HTTPS PUT bytes to the signed upload endpoint
    -> openart_upload_metadata_get
    -> durable HTTPS visual reference
    -> openart_generate_*(params with media objects)
```

The signed upload endpoint and durable access URL are different values. Store only the durable provider reference, never the signed PUT URL.

### Higgsfield

Prefer a live-verified native contract:

```text
read local bytes
    -> media_upload(method=upload_url, filename, content_type)
    -> HTTPS PUT bytes
    -> media_confirm(type, media_id)
    -> confirmed media UUID
    -> generate_*(medias: [{ role, value: media UUID }])
```

If that native upload family is not exposed, a model/tool contract may permit an authorized HTTPS URL that Higgsfield imports. Use that only when confirmed by the live generation schema. The URL must be reachable by Higgsfield, scoped, expiring where possible and free of LightTable credentials.

Do not use `media_upload_and_confirm` unless the live schema accepts an input LightTable can actually provide. The snapshot's helper expects an OpenAI attachment reference and is not a generic file-byte API.

## Publication cache

Provider publication is derived state. Keep it outside the document format and canonical recipe.

A safe cache key is:

```text
providerId
canonical assetId
source content revision/hash
publication contract version
```

A cache entry should retain:

```ts
interface ProviderPublication {
  providerId: string;
  assetId: string;
  sourceRevision: { modifiedAt: string; byteLength: number; sha256?: string };
  transport: 'provider-asset' | 'authorized-url';
  providerAssetId?: string;
  url?: string;
  mediaType: string;
  expiresAt?: string;
  updatedAt: string;
}
```

Reuse only if:

- provider matches;
- source revision still matches;
- URL has enough remaining lifetime for submit and provider fetch;
- the current provider contract accepts that transport;
- media type still matches.

Do not reuse an OpenArt publication for Higgsfield merely because it is HTTPS. Publications are provider-scoped unless explicitly documented as cross-provider authorized URLs.

## Security rules

- Renderer supplies opaque IDs, never absolute paths.
- Only desktop reads bytes and performs uploads.
- Reject `file:`, `data:`, loopback and untrusted non-HTTPS URLs for remote providers.
- Never send OAuth bearer tokens to signed object-storage origins.
- Validate upload response status and content type.
- Do not log signed URL values, bearer tokens or media bytes.
- Safe diagnostics may record tool name, schema fingerprint, field paths, value kinds, byte length and sanitized provider IDs.
- Bound file size and accepted media type before upload.
- Preserve exact selected-reference order.

## Base image and editor snapshots

LightTable currently exports the open document as a PNG and imports it as a normal project asset. This is a good host boundary: the provider never knows about layers or WebGPU.

Be explicit that this is a snapshot. If the document changes after the base image was added, choose one product policy:

- keep the original immutable snapshot; or
- refresh it deliberately and create a new asset/revision.

Do not silently overwrite the same path while retaining an old remote publication.

## References versus frames

Models such as Seedance, Kling, MiniMax and Gemini may expose distinct semantic modes:

- **References**: media guides identity, style, subject, environment or composition.
- **Frames**: media is a literal first and optionally last frame.

These are not interchangeable UI aliases. Store the semantic input variant in the recipe and let each provider adapter choose its model mode and fields. Prefer user-facing `References` and `Frames` labels over ambiguous technical names such as `Omni` or `FLF`, unless Omni is actually part of the model's name.
