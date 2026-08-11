# Live schema discovery

The most important architectural choice for LightTable is to make the OpenArt integration schema-driven.

## Discovery graph

```text
openart_model_list
    ↓
model id + media + mode
    ↓
openart_model_form_get(model, mode)
    ↓
JSON Schema
    ↓
LightTable FormSchemaAdapter
    ↓
native LightTable controls
```

Do not encode assumptions such as “all image models have resolution” or “all video models use generateAudio”.
Those fields vary by model and can change.

## Suggested cache key

```text
openart/<modelId>/<mode>/schema.json
```

Cache in memory for the session and optionally on disk. Refresh:
- on app launch (or lazy first use),
- when OpenArt returns schema/validation errors,
- when the model list changes,
- periodically using an ETag/version if the MCP surface later exposes one.

## Generic UI mapping

- `type: string` + `enum` → dropdown/segmented control
- `type: string` → text input; `prompt` should use LightTable's prompt editor
- `type: integer|number` + min/max → numeric input / slider where appropriate
- `type: boolean` → checkbox/switch
- `type: array` + reference item schema → reference tray
- `default` → initialize control
- `required` → validation
- `maxItems` → reference slot limit

Keep a small presentation override table for nicer labels/order, but NEVER duplicate the validation rules there.

## Reference semantics

OpenArt currently distinguishes:
- image-to-video: input image is the literal first frame
- element-to-video: media is a subject/identity/reference and the generated scene can change
- Seedance element mode can accept image + video + audio references
- several other element modes currently accept image references only

This distinction should be explicit in the LightTable UI.
