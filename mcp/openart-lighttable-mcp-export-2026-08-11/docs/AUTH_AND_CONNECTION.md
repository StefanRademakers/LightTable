# Authentication and MCP connection

Official OpenArt MCP endpoint:

`https://mcp.openart.ai/mcp`

The public OpenArt documentation describes:
- Streamable HTTP transport
- OAuth sign-in on first connection
- no user-created API key required

A raw unauthenticated request to the MCP endpoint returned HTTP 401 during this snapshot, which is expected.

## LightTable recommendation

Keep authentication separate from generation UI:

```text
OpenArtConnectionService
  ├─ MCP transport
  ├─ OAuth session/token lifecycle
  ├─ reconnect / auth-expired handling
  └─ callTool()

OpenArtCatalogService
  ├─ model_list
  ├─ model_form_get
  └─ model_cost

OpenArtGenerationService
  ├─ upload/reference handling
  ├─ generate_image
  ├─ generate_video
  ├─ creation_get
  └─ creation_list
```

Do not reuse ChatGPT's OAuth/session. LightTable must establish its own authenticated MCP connection for the signed-in OpenArt user.
