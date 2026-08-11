# Task 128 result — Native GenAI vertical slice

## Delivered

- Native, provider-neutral GenAI and Queue/History panels with OpenArt,
  Nano Banana Pro and GPT Image 2 schema-driven controls.
- Shared Image Edit/Image Create prompt composer with stable `@asset` tokens,
  project thumbnails and aspect, resolution, quality and count controls.
- Background project indexing now pushes a narrow IPC event to the panel. An
  image added after project-open appears without remounting, polling or touching
  the document renderer.
- Local reference bytes remain desktop-owned and are published only at submit
  through the authenticated LightTable server to expiring, unguessable HTTPS
  URLs. OpenArt receives those URLs; React never receives paths or bytes.
- Existing valid remote links are reused. Missing, expired or unsupported
  references fail before provider submission instead of being omitted.
- Persistent jobs and atomic output storage under `AiRenders/History`; edit
  outputs become the top layer and create outputs open as a document.

## Evidence from this repair pass

- Real Electron smoke: create project, add an image after activation, receive
  the asset-catalog event and read the new opaque GenAI asset: passed.
- Desktop GenAI/project/publisher tests: 17 passed.
- Reference preparation tests cover reuse, local publication and missing-asset
  rejection; OpenArt parameter tests cover binding provider tokens to URLs.
- MCP relay streaming/expiry test: passed.
- LightTable app suite: 372 files / 2012 tests passed.
- Desktop, app and MCP typechecks passed.

## Honest runtime boundary

The local-reference path needs both an OpenArt connection and a paired
LightTable server because OpenArt consumes reachable URLs, not native desktop
bytes. The implementation and local server path are automated; a real paid
OpenArt generation remains an owner-session acceptance check and is not claimed
as automated evidence.
