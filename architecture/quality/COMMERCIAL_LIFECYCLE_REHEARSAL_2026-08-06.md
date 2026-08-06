# Commercial lifecycle rehearsal — 6 August 2026

Outcome: **technical pass; commercial readiness intentionally false**.

The staging rehearsal ran without production-capable credentials and confirmed
there are no entitlement/activation references in the document model,
persistence, renderer or GPU runtime. Forty-six focused update, recovery,
privacy, dirty-close and MCP pair/revoke tests passed. The packaged app then
passed save/export/accessibility, local diagnostic consent/revoke for PNG/PSD/PDF
and the crash-recovery smoke.

No user document was uploaded or coupled to an entitlement. Missing update and
activation services fail as unavailable rather than changing local files.

Commercial readiness remains false for four explicit reasons:

- owner/legal review of price, tax, refund, support and activation policy;
- signed activation receipt verification is not implemented;
- production installer update and rollback providers are not configured;
- beta exit review and multi-hardware qualification remain open.

Raw bounded output is `tmp/commercial-lifecycle/report.json`. It is generated,
not committed. Repeat with `npm run rehearse:commercial` against an already
verified production package.
