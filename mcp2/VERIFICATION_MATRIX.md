# Verification matrix

The goal is to catch contract and credit-safety errors with fixtures and fake transports before spending provider credits.

## Provider-neutral core

- Selected references remain authoritative when zero, one or all are mentioned in the prompt.
- Duplicate prompt mentions produce one media reference and stable bindings.
- Reordering display items does not rebind a token to another asset.
- Missing `@token` targets fail validation before preparation.
- Reference count and accepted media kinds are enforced from the selected workflow.
- Recreate restores prompt, semantic references, output intent and fields without submitting.
- Provider runtime metadata never enters the canonical recipe.

## Asset import and publication

- Clipboard import writes one project asset and exposes a preview after indexing.
- Open-document export becomes an immutable imported snapshot.
- Renderer sends opaque asset IDs only.
- Local provider receives exact multipart bytes and never requests publication.
- Remote provider never receives a local path, `file:`, `data:` or localhost URL.
- Every selected remote reference is published or submission is blocked.
- A still-valid publication is reused for unchanged content.
- Replacing bytes at the same path invalidates the cached publication.
- Expiring links with insufficient remaining lifetime are republished.
- OpenArt signed PUT URL is never persisted as the durable reference.
- Higgsfield media is confirmed before its UUID is submitted.
- Upload failure occurs in `preparing-inputs`, before the paid-call counter increments.

## Tool-contract drift

- Extra unknown tools do not disable a provider.
- Missing required capability disables only the affected provider/workflow.
- OpenArt fixtures cover sign URL field aliases without logging URL values.
- Higgsfield fixtures separately cover `models_list`/`models_get` and `models_explore` families.
- A mixed incomplete Higgsfield family fails closed instead of combining assumptions.
- Response fixtures cover singular ID, plural IDs and nested structured results only where live-captured.
- Multiple conflicting IDs become `unknown-submit`; they are not guessed.
- Manual reconnect clears stale OAuth/discovery state and refreshes the catalog.

## Cost safety

- Cost estimation invokes only an estimator tool.
- Tests fail if any cost path calls `generate_image` or `generate_video`.
- Changing cost-relevant fields invalidates/debounces the quote.
- Missing/unstructured cost hides the quote without mutating submission params.
- OpenArt cost projection may omit verified transport-only frame objects while real submission retains them.

## Paid submission

- Synchronous UI single-flight prevents same-tick double submit.
- One local job produces at most one automatic paid tool call.
- `submissionAttemptedAt` and snapshot are durable before the call.
- Provider ID is durable before polling starts.
- Timeout/network reset after the paid call yields `unknown-submit` when no ID is known.
- `unknown-submit` is never automatically requeued.
- A known provider ID resumes retrieval and never calls generation.
- A stale running job is not reclaimed for paid resubmission.
- Closing, switching or reopening panels never changes submission count.
- Restart recovery does not overwrite or erase an existing provider ID.

## Polling and result delivery

- Transient 502/503/504 with a known provider ID keeps the job recoverable.
- Backoff is bounded and cancellable locally.
- One completed sibling updates history while another remains running.
- Downloaded result type, signature and byte limit are validated.
- Thumbnail/input/upload URLs are rejected as final outputs.
- Output is atomically stored and indexed before the job becomes succeeded.
- Editor placement failure retains the succeeded history asset.
- Stop Tracking does not claim provider cancellation.

## Existing-provider regression gate

Every Higgsfield change should keep these green:

- `packages/genai-openart` tests;
- `packages/genai-local` tests;
- `apps/local-ai-provider` tests;
- desktop OpenArt connection/upload/catalog tests;
- desktop local connection/generation/process tests;
- project generation job/recovery tests;
- GenAI setup, prompt composer, panel and jobs-controller tests;
- GenAI package-boundary verification;
- production TypeScript builds for affected packages.

## Minimal live smoke policy

Do not use live paid generations for schema debugging. First run discovery, schema normalization, upload signing/confirmation where credit-free, cost estimation and mocked submit/poll fixtures.

After all credit-free gates pass, use the smallest owner-approved smoke sequence:

1. one low-cost Higgsfield image create without references;
2. one low-cost image edit with one local reference, verifying publication;
3. restart/reopen while polling a deliberately controlled job only if safe and necessary;
4. one shortest/lowest-resolution video only after the complete video contract is verified.

Record the provider job ID, submitted contract fingerprint and output result. Never repeat a failed live smoke automatically.
