# Local Codex to LightTable MCP acceptance

This route connects a fresh local Codex client to a packaged LightTable desktop
through the real Streamable HTTP MCP server and the product-owned outbound
desktop tunnel. It is an opt-in development acceptance route, not a production
deployment configuration.

## Transport boundary

The launcher deliberately uses two loopback origins:

- Codex -> MCP/OAuth: `http://127.0.0.1:8787`;
- LightTable -> device tunnel: `https://localhost:8788` and WSS.

Codex therefore needs no locally trusted test certificate. The desktop tunnel
stays encrypted and accepts the one-day self-signed localhost certificate only
inside the isolated launched process. Production keeps one HTTPS public origin
unless `LIGHTTABLE_DEVICE_PUBLIC_URL` is explicitly configured.

## Fast manual owner acceptance

The normal iteration path is now entirely inside the packaged desktop UI:

1. Open **Preferences -> Agent Access**.
2. Select **Local test mode** and enable **Allow agent connections**.
3. Click **Connect Codex...**. LightTable locates the installed Codex CLI,
   creates or repairs the `lighttable-local` registration and opens the OAuth
   browser flow. Confirm **Authorize local Codex**; no pairing code is entered.
4. Start or reload one Codex session. Already-running sessions cannot discover
   a newly registered MCP server dynamically.
5. On the first request, approve the exact Codex client with **Allow once** or
   **Always allow**. Persistent access is stored per server and client identity,
   not as a second global edit switch.

Subsequent app/server restarts reuse an OS-protected TLS identity, OAuth state
and client-bound approval policy. Ordinarily the loop is therefore **Allow
agent connections -> new Codex session**. A saved grant is matched to server
ID, certificate fingerprint and client ID; another or revoked identity cannot
inherit it.

The local server binds Codex/OAuth only to `127.0.0.1:8787`. Its self-signed
HTTPS/WSS device side binds to `localhost:8788`. Trusted no-code authorization
is rejected by the MCP server outside its explicit insecure-loopback mode.

## Isolated launcher and automated acceptance

Build the packaged application once, then start the session:

```powershell
npm run package:desktop
npm run mcp:local:codex
```

The launcher creates an isolated temporary LightTable profile, opens a document,
pairs the desktop tunnel and prints three commands plus a short-lived OAuth
pairing code. In another terminal:

```powershell
codex mcp add lighttable-local --url http://127.0.0.1:8787/mcp
codex mcp login lighttable-local --scopes lighttable:read,lighttable:edit
```

Enter the printed pairing code in the browser authorization form. Then start a
fresh Codex session: the running session cannot acquire a newly configured MCP
server dynamically. When the client appears in LightTable under Preferences ->
Agent Access, grant read or edit deliberately. Keep the launcher terminal open
for the entire acceptance run.

Optional launcher controls are `--mcp-port`, `--device-port` and `--file`.
Without `--file`, the normal New Document UI creates a small local test document.

After the run, stop the launcher with Ctrl+C and remove the opt-in client:

```powershell
codex mcp logout lighttable-local
codex mcp remove lighttable-local
```

This older terminal route remains useful because it creates an isolated profile
and proves the denial/escalation gates from a clean state. It is no longer the
shortest ordinary creative iteration path.

The current Codex CLI stores registered MCP servers in the local Codex user
configuration. LightTable does not commit a live Codex configuration, ports,
tokens or OAuth credentials to this repository.

## Automated transport probe

```powershell
npm run smoke:mcp:local-codex
```

This uses the same packaged launcher and external Streamable HTTP client. It
proves denial before approval, read-only workspace/document/capability discovery,
a bounded WebP preview, rejection of edits under read-only approval, revocation,
explicit edit escalation and execution through the canonical viewport owner.
The concise report at `tmp/local-codex-mcp/report.json` contains no tokens,
pairing codes, image bytes or private source paths.

This automated probe does not replace owner-visible Codex use. The first real
fresh-Codex run has now proved inspect -> create -> edit -> preview -> correct
far enough to produce and inspect a twelve-layer editable composition. The
remaining acceptance must still save/export through that client, verify the
resulting pixels and editable layers independently, and exercise the named
failure/reconnect/cleanup paths.

The canonical input boundary, MCP-only execution rule, independent review and
default `local-only` cost policy for that artist practice run are defined in
[`../goals/AGENT_NATIVE_CREATIVE_RUNTIME_TARGET.md`](../goals/AGENT_NATIVE_CREATIVE_RUNTIME_TARGET.md#local-mcp-artist-practice-benchmark).

The longer packaged route beneath Codex is available separately:

```powershell
npm run smoke:mcp:local-codex:a-z
```

It builds and corrects an editable layered design, compares revision-bound
previews, inspects text/layer state, verifies PNG/native artifacts, exercises
invalid-schema, missing-target and stale-revision rejection, then reconnects.
Its bounded report complements rather than replaces the real Codex run: the
automated harness already owns deterministic schema, artifact, reconnect and
structure checks, while Task 264 still requires those checks to be reconciled
with the complete owner-visible save/export flow.
