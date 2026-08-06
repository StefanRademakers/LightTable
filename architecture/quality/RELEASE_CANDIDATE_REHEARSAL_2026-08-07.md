# Release-candidate rehearsal — 7 August 2026

Status: automated release rehearsal passed; declared outcome is **bounded
technical preview**, not a paid release candidate.

## Candidate and reproducibility

- Candidate commit: `85fad8d0af2b99d931f597384839e0f1295b44f8`.
- Version: `0.1.0-alpha.1`.
- The runner created a clean detached checkout and installed dependencies with
  `npm ci` before building or testing.
- Local raw evidence: `tmp/release-candidate/task-112-85fad8d0/`.
- The top-level report is covered by an ephemeral local Ed25519 signature. Its
  SHA-256 payload digest is
  `6ba7088c3bc2d3ec1be1fb3ec65909ea503e386f286163b76116940e6d418765`.

The `tmp` evidence is intentionally not a release artifact or long-term trust
root. It is reproducible local evidence tied to the exact commit above.

## Automated result

| Stage | Result | Duration |
| --- | --- | ---: |
| Clean dependency install | passed | 17.7 s |
| Full quality profile | passed, 40/40 gates | 13 min 53 s |
| Owner-workflow automation | passed | 1 min 50 s |
| Signed hardware probe | passed on the current Windows/discrete-GPU cell | 2.6 s |
| Commercial lifecycle technical rehearsal | passed | 27.2 s |

The full profile covered boundaries, architecture ratchets, workspace
typechecks and tests, production web and desktop builds, packaged interaction
smokes, recovery, accessibility, MCP, native/PSD roundtrip, vector and text
authoring, endurance, the bounded hardware soak, the 40-case Photoshop effects
corpus and the 48-case blend/profile matrix. Both requested iterations passed.

The previous rehearsal correctly failed on one stalled cold Electron startup in
the 40-process effects corpus. Commit `85fad8d0` added one bounded retry only at
the pre-document readiness boundary. Import, render, semantic and fidelity
failures are never retried. The formerly affected `outer-glow-size-30` case
then passed independently at RMSE 5.31 and passed in the complete clean run.

## Go/no-go disposition

The technical automation supports a bounded technical preview. It does not
support a paid public release claim. The following gates need real people,
platforms or production infrastructure and remain open:

1. The product owner has not signed the acceptance checklist.
2. Integrated-GPU, hosted-web and Apple Silicon hardware cells have not been
   physically qualified.
3. The external design-partner beta and exit review have not happened.
4. Commercial policy/legal review, signed activation receipts, production
   installer/update providers and rollback infrastructure remain open.
5. This bounded rehearsal did not run the required multi-hour/overnight soak.

No task is marked complete merely because its automatable portion passed. These
are release-decision blockers, not code failures that can be truthfully closed
by another local test run.
