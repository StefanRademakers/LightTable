# LightTable OpenArt panel architecture

## Recommended panel structure

### Header
- Workspace selector
- Project selector
- Credit balance
- Refresh model catalog

### Generation mode
- Image / Video
- Text → Image
- Image → Image
- Text → Video
- Image → Video
- Element / Reference → Video

Only show modes actually returned by `openart_model_list`.

### Model picker
Each model card should show:
- displayName
- short capability description
- supported modes
- optional current estimated/default credits
- capability chips derived from schema (4K, audio, references, max refs, duration, etc.)

### Dynamic form
Use `openart_model_form_get` and render native LightTable controls.

Avoid building one giant OpenArt-specific form. Build:
- `McpJsonSchemaFormAdapter`
- `OpenArtPresentationHints`
- standard LightTable control primitives

### References
Integrate with LightTable project assets:
- current document
- selected layer
- rendered composite
- AiRenders/History
- AiRenders/Input
- Characters
- Props
- Environments
- Sets

A reference sent to OpenArt should keep a local mapping:
```ts
type OpenArtAssetLink = {
  localAssetId: string;
  remoteUrl: string;
  remoteUploadId?: string;
  mediaType: "image" | "video" | "audio";
  metadata?: {
    width?: number;
    height?: number;
    duration?: number;
    fps?: number;
    format?: string;
  };
};
```

### Generation lifecycle

```text
EDIT PARAMS
  → VALIDATE AGAINST LIVE SCHEMA
  → COST ESTIMATE (optional/debounced)
  → GENERATE
  → historyId
  → RUNNING
  → COMPLETED
  → download/import
  → LightTable AiRenders/History
```

### Cost UX
Do not treat the default price table as authoritative. Price can vary by resolution, duration, count, quality, audio and references.

Recommended:
- show “~ N credits” after parameters settle;
- debounce cost quote calls;
- refresh cost immediately before submit;
- record quoted cost/config with history entry.

### Failure handling
Validation errors should:
1. preserve prompt and references,
2. invalidate cached schema if appropriate,
3. re-fetch `openart_model_form_get`,
4. remap compatible values,
5. highlight changed/invalid fields.

### Future-proofing
The OpenArt public MCP page says new models are synchronized automatically. The LightTable integration should therefore prefer capability discovery over model-name switches.
