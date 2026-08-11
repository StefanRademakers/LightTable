# OpenArt MCP → LightTable Integration Export

Snapshot date: 2026-08-11

This package captures the OpenArt MCP surface currently exposed to ChatGPT and turns it into a practical starting point for a native LightTable integration.

## Key facts

- MCP endpoint: `https://mcp.openart.ai/mcp`
- Transport: Streamable HTTP
- Authentication: OAuth
- 16 exposed OpenArt tools
- 16 currently exposed models
- 41 model/mode combinations
- Model forms are dynamic JSON Schemas and should NOT be hardcoded.
- Pricing is configuration-dependent and should be quoted with `openart_model_cost` immediately before generation when accurate cost display matters.

## Recommended LightTable flow

1. Connect/authenticate once with OpenArt OAuth.
2. Call `openart_model_list`.
3. Build the model picker from the returned model/mode graph.
4. When the user selects model + mode, call `openart_model_form_get`.
5. Render controls from the returned JSON Schema.
6. Resolve/upload reference assets when the schema asks for them.
7. Optionally call `openart_model_cost(model, mode, params)` and show the estimated credit cost.
8. Submit with `openart_generate_image` or `openart_generate_video`.
9. Persist `historyId`.
10. Poll/read status with `openart_creation_get` and import completed media into the LightTable project/history.

See `docs/LIGHTTABLE_UI_ARCHITECTURE.md` and `docs/LIVE_SCHEMA_DISCOVERY.md`.

## Important snapshot limitation

OpenArt explicitly describes the MCP model/tool catalog as automatically updating. Therefore a static dump is useful for development/documentation, but LightTable should treat `openart_model_list`, `openart_model_form_get`, and pricing as runtime discovery APIs.

Two exact normalized schema examples from the live connector are included under `schemas/samples/`. The production implementation should cache full raw JSON Schemas returned by the MCP server rather than relying on these samples.
