# Design-partner beta privacy and defect triage

Status note (10 August 2026): the technical controls remain reusable, but no
external cohort was run for candidate `2643a94c`. Cohort recruitment and exit
review are future release activities rather than an autonomous coding task.

LightTable's design-partner beta is bounded research, not silent telemetry or
an open-ended feature programme. Local editing works without an account,
network connection or diagnostic consent.

## Cohort and consent gate

The initial cohort is capped at twelve participants and must cover the launch
workflows (photo grading, layered PSD work, text/vector composition and local
automation) plus every hardware class LightTable intends to claim. A partner
receives the exact test-build channel, known-risk list, expected session length,
support contact, data handling statement and exit date before opting in.
Consent is recorded outside LightTable documents and can be revoked at any
time. Recruitment and consent are owner/support operations; source code cannot
pretend they occurred.

No participant is asked for a source document. A report should first be reduced
to a deterministic operation list. If content is essential, support requests a
new synthetic fixture or an explicitly donated, separately licensed artifact.

## Event boundary

The Debug panel's **Record privacy-safe beta events locally** option is off by
default. When enabled, LightTable retains at most 200 enum-only records with
timestamps rounded down to an hour. Allowed records are runtime stop, duration
bucket, recovery outcome, import/export capability result and device loss.
There is no free-text property in this schema. Turning the option off deletes
the consent key and all events immediately.

Nothing is uploaded automatically. Preview shows the exact redacted support
bundle; Export writes it through the ordinary local save boundary so the user
can inspect it again and decide how to send it. Paths, URLs, filenames (unless
separately selected), document text, prompts, bearer/pairing/API/MCP secrets,
data URLs and binary content pass through the shared redaction boundary.

## Triage contract

Every defect uses `architecture/contracts/BETA_DEFECT_TRIAGE_SCHEMA.json`.
Severity, frequency, workflow, hardware cell, reproducibility, data-loss risk,
owner decision and regression evidence are mandatory. Reports contain only a
sanitized summary and reproduction steps. Original customer content never
becomes a test fixture.

Priority is fixed:

1. corruption/data loss and supported-path crashes;
2. interaction latency and hangs;
3. accessibility blockers;
4. fidelity/roundtrip regressions;
5. bounded usability defects.

Feature requests are stored as `kind: feature-request` and cannot displace a
defect in those classes. A repeated defect becomes either a minimal sanitized
fixture or deterministic script before a fix is accepted; `regressionEvidence`
links the resulting test and commit.

## Exit review

The beta exits only after the cohort window closes, aggregate enum counts are
published without user content, all supported-path corruption/crash reports
are closed, and every remaining report has an explicit owner disposition.
No cohort exit review occurred for the historical candidate. The implementation
and automated privacy soak established technical readiness only.
