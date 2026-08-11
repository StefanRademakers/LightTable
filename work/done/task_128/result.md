# Task 128 result — Native GenAI vertical slice

## Delivered

- Provider-neutral `@lighttable/genai-core` contracts, schema normalization,
  validation, prompt bindings, presentation hints and job state.
- Lazy OpenArt MCP adapter with runtime model/form discovery and a validated
  cached catalog.
- Electron-owned OAuth/PKCE, loopback callback, encrypted credential storage,
  connection restore and narrow IPC contracts.
- Native LightTable GenAI panel using the existing control system, with Image
  Edit/Create, Nano Banana Pro and GPT Image 2, dynamic fields, featured
  aspect/resolution/quality controls, Advanced fields, output count, cost and
  project asset mentions.
- Persistent project jobs with idempotency keys, adaptive polling, honest local
  stop/resume, restart recovery and no silent paid re-submit.
- Atomic output storage under `AiRenders/History`, project indexing and
  thumbnail reuse. Image edits enter as the top layer; image creates open as a
  document.
- Separate Queue & History Dockview panel with project-backed result cards.

## Verified

- `@lighttable/genai-core`: 5 files / 8 tests passed.
- `@lighttable/genai-openart`: 2 files / 7 tests passed.
- Desktop GenAI: 6 files / 11 tests passed.
- `@lighttable/app` and `@lighttable/desktop` typechecks passed.
- Real Electron project lifecycle smoke passed after excluding first-party
  source packages from Vite dependency prebundling.

## Explicitly not disguised as complete

Locally authored project assets do not yet have a public HTTPS publication
path. Generated OpenArt results can reuse their recorded remote link. Native
local references fail preflight before a paid request. The required first-party
relay is specified separately in `work/todoLater/task_132`.

Further providers, video and broad model expansion remain later product work;
they do not alter the completed first production-worthy OpenArt image vertical
slice.
