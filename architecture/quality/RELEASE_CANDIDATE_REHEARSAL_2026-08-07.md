# Release-candidate rehearsal - 7 August 2026

Historical status (10 August 2026): candidate `2643a94c` was superseded by
continued feature development. This report is evidence for that build only.

Status: the reproducible automated release rehearsal passed. The declared
outcome is **bounded technical preview**, not a paid release candidate.

## Candidate and evidence identity

- Product candidate: `2643a94cdaa994e868a5a2e91c0afed9d6b85c57`.
- Version: `0.1.0-alpha.1`.
- Build source: clean detached checkout followed by deterministic `npm ci`.
- Final rehearsal: `tmp/release-candidate/task-112-2643a94c-final3/`.
- Two-hour soak: `tmp/release-candidate/task-113-2643a94c-packaged-two-hour-soak/`.
- Acceptance-runner correction: `bff744a5`.
- Exact persisted-evidence signing correction: `51b59d13`.

The top-level `report.json` is covered byte-for-byte by its ephemeral local
Ed25519 signature. Independent readback verification passed. Its payload
SHA-256 is
`35750f964a77e3424fbd70bdc6b09ada2c4b36413a1dfd78327a0467259a1dee`.
The ephemeral key is local evidence, not a production release trust root.

## Automated result

| Stage | Result | Duration |
| --- | --- | ---: |
| Clean dependency install | passed | 11.9 s |
| Full quality profile | passed, 40/40 gates | 13 min 0 s |
| Packaged owner-workflow automation | passed, 15/15 projects, 0 defects | 1 min 50 s |
| Signed hardware probe | passed on measured Windows/discrete Electron cell | 2.6 s |
| Commercial lifecycle technical rehearsal | passed, production policy still blocked | 28.3 s |
| Exact-candidate endurance | passed, 70/70 cycles and 0 orphan processes | 7,298,230 ms |

The full profile covered boundaries, architecture ratchets, workspace tests
and typechecks, production web/desktop builds, packaged UI interactions,
recovery, accessibility, MCP, native/PSD roundtrip, PDF, vector/text authoring,
Photoshop effects and blend/profile parity. The final report records a clean
checkout, all five stages passed and acceptance of the exact-commit soak.

## Endurance and interaction evidence

The packaged soak ran for 2 h 1 min 38 s and completed 70 cycles. Every cycle
passed the five-document matrix, canvas/transform, text/caret editing, Layer
Styles, save/export and PSD roundtrip. Bounded diagnostics ran once. Results:

- failed cycles: 0;
- invalid screenshots: 0 of 350;
- suspicious stable memory/GPU tails: 0;
- background GPU submissions while settled: 0;
- orphan processes after completion: 0;
- text input-to-submit: median 36.1 ms, p95 56.8 ms, max 58.7 ms;
- text input-to-GPU: median 61.2 ms, p95 75.5 ms, max 82.3 ms;
- first useful frame across 350 opens: median 941 ms, p95 2,356 ms,
  max 2,402 ms.

These measurements apply only to the recorded Windows 11, RTX 5090,
device-pixel-ratio 1 packaged-Electron cell. They do not establish a modest
hardware floor.

## Defects found by the evidence pass

The long run caught one transient packaged renderer navigation failure. The
product now performs one bounded retry only before document readiness;
document import, rendering, semantics and fidelity failures are not retried.

The first final owner run then exposed that seven older automation scripts
ignored the selected packaged executable and silently launched development
Electron. All seven were moved to the shared launch/readiness contract. A
focused rerun passed 7/7 and the complete packaged acceptance passed 15/15.

Independent verification finally found that the original rehearsal signed a
compact in-memory JSON representation rather than the pretty-printed bytes
written to disk. Signing now covers the exact persisted bytes and fails closed
for formatting, content, hash, key or signature changes. The final3 evidence
was re-signed and independently read back successfully.

## Go/no-go disposition

Automated release blocker count: zero on the assessed candidate.

Paid-release decision: **no-go**. Bounded technical preview: **go** on the
measured hardware cell. Four gates require an external state change:

1. Product-owner visual, interaction and release-classification sign-off.
2. Physical integrated-GPU, web-host and Apple Silicon qualification.
3. A consented external design-partner beta and exit review.
4. Owner/legal commercial policy, activation receipts, signed production
   installer/update and exercised production rollback infrastructure.

The multi-hour soak was not a blocker for this build. The four unresolved gates
prevented a paid-RC and signed owner go/no-go closure before the candidate was
superseded.
