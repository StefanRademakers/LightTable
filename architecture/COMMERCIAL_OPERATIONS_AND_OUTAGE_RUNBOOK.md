# Commercial operations and outage runbook

This runbook exercises product boundaries; it does not approve price, tax,
refund, support or legal copy. Those fields remain named launch blockers in
`contracts/COMMERCIAL_LIFECYCLE_POLICY.json`.

## Product boundary

The intended desktop product is a one-time purchase for a perpetual major
version. Local open/edit/save/export and crash recovery do not depend on a
running server. Entitlement belongs to the host/service layer and must never be
serialized into, rendered from, or used to mutate a document. Until receipt
verification and owner/legal policy are implemented, builds remain technical
preview and no mock entitlement may claim a paid activation.

Servers are limited to signed activation receipts, signed update distribution,
the explicitly paired MCP relay and user-approved remote AI. The web editor may
later use advertising only behind separately reviewed consent. Local editing
does not upload content; a remote feature must name the payload and recipient
at invocation time.

## Staging lifecycle

Run from a production package with no production credential:

```powershell
npm run package:desktop:verify
npm run rehearse:commercial
```

The rehearsal covers release/update signature and channel refusal, recovery
record preservation, dirty-close behavior, privacy redaction, Agent Access
pair/revoke/outage, packaged save/export/accessibility and packaged diagnostics.
It writes a bounded machine-readable report below
`tmp/commercial-lifecycle/report.json`. Missing production secrets are expected;
the report remains `commercialReady: false` until approved policy, activation
receipt verification and installer/rollback providers exist.

## Incident decisions

### Update service outage

Show “update check unavailable”; continue local editing. Never clear a pending
document or recovery record. Retry only on a new explicit/background schedule,
not in an interaction loop.

### Revoked or bad build

Stop offering its signed manifest. Publish a newly signed manifest and incident
note. Do not overwrite user documents during rollback. The installer owner
must retain the previous verified artifact and validate the native manifest and
recovery compatibility range before switching versions.

### Bad native-format migration

Disable the affected update channel. Preserve the original file, recovery
record and any cached preview. Open in a non-destructive compatibility mode or
the previous build. A repair release requires a fixture reproducing the exact
manifest transition and an open/save/reopen regression test.

### License/activation outage

Retain the last verified receipt locally. Local document work remains available
under the declared policy; never rewrite, watermark or reduce document quality.
Do not invent a grace duration until owner/legal review sets it.

### MCP compromise

Revoke the session, remove its encrypted credential, stop the outbound tunnel
and invalidate server-side tokens. Open documents remain unchanged. Re-pairing
requires a fresh user-visible code and approval.

### Support escalation

Ask the user to inspect and export the bounded diagnostic bundle. Do not request
source documents first. Classify beta issues with the common triage schema and
turn repeated issues into synthetic fixtures or deterministic scripts.

### Uninstall

Remove application binaries and app-owned caches only. User-selected documents
are never uninstall targets. Recovery deletion and account/Agent credential
revocation require explicit, separately described choices.
