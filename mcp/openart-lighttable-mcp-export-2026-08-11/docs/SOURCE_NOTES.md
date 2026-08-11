# Source notes

Live sources inspected on 2026-08-11:

- Installed OpenArt plugin/MCP surface in ChatGPT:
  - 16 exposed tools
  - `openart_model_list`
  - `openart_model_cost`
  - live `openart_model_form_get` samples

- Official OpenArt MCP page:
  - endpoint: https://mcp.openart.ai/mcp
  - Streamable HTTP
  - OAuth authentication
  - model catalog updates automatically
  - supports image/video generation, model discovery, history/library, uploads, credits, workspaces and projects

Important:
The raw MCP endpoint returns HTTP 401 without an authenticated OAuth session. LightTable must implement/host an OAuth-capable MCP connection rather than trying to reuse ChatGPT's private connector session.
