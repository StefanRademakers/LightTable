# OpenArt MCP tool flow

## Discovery
- `openart_model_list()`
- `openart_model_form_get(model, mode)`
- `openart_model_cost(...)`

## Account / organization
- `openart_account_get()`
- `openart_workspace_list()`
- `openart_workspace_select(id)`
- `openart_project_list()`
- `openart_project_create(name, description?)`

## Assets
- `openart_upload_list(...)`
- `openart_upload_metadata_get(...)`
- host-only picker: `openart_upload_pick(...)`

For a native LightTable client, implement normal MCP/tool calls and your own local file upload UX. Do not design around ChatGPT's host-specific upload picker widget.

## Generation
- `openart_generate_image(model, mode, params, projectId?)`
- `openart_generate_video(model, mode, params, projectId?)`

Both return a `historyId` while the job is asynchronous.

## Results/history
- `openart_creation_get(historyId)`
- `openart_creation_list(...)`
- host-only presentation helper: `openart_creation_show(historyId)`

A native LightTable UI should render its own generation cards/status rather than depend on ChatGPT's result-card presentation.
