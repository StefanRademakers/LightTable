# Schema snapshot status

The current connector exposes 41 model/mode combinations.

The export contains:
- complete current model/mode index
- complete exposed tool inventory
- complete default pricing snapshot returned by OpenArt
- exact normalized live schema samples for Nano Banana 2 text2image/image2image
- architecture for fetching every exact raw model schema at runtime

## Why the runtime schema is the source of truth

OpenArt's MCP catalog is explicitly dynamic. New models and changed form fields are synchronized by OpenArt. A static 41-file schema dump will age immediately.

For production, when the user selects a model/mode:

```text
openart_model_form_get(model, mode)
```

Store the returned *full raw JSON Schema* in your cache and generate the controls from it.

The `model-mode-index.json` file contains the discovery call for all 41 currently exposed combinations, so a development crawler or LightTable itself can snapshot all schemas after OAuth authentication.
