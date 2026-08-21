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

## Manual owner acceptance

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

This automated probe does not replace the final fresh-Codex owner acceptance.
That acceptance must additionally exercise inspect -> create -> edit -> preview
-> correct -> save/export and verify the resulting pixels and editable layers
independently.

The longer packaged route beneath Codex is available separately:

```powershell
npm run smoke:mcp:local-codex:a-z
```

It builds and corrects an editable layered design, compares revision-bound
previews, inspects text/layer state, verifies PNG/native artifacts, exercises
invalid-schema, missing-target and stale-revision rejection, then reconnects.
Its bounded report still does not replace the genuinely fresh Codex-session
boundary described above.
