# Paid jobs, cost estimation and recovery

Remote generation is a financial side effect. Its architecture must be stricter than ordinary request retry code.

## Exactly-once intent, at-most-once automatic submission

No client can prove exactly-once execution across an uncertain network boundary without provider idempotency support. LightTable can guarantee:

- one local job has one submission intent;
- automatic code invokes the paid generation tool at most once;
- an ambiguous result is never automatically resubmitted;
- known provider jobs resume by ID only.

If a provider later exposes an idempotency key, bind it to the durable LightTable job ID and still retain the same fail-closed policy.

## Durable phase model

Persist state before and after the paid boundary:

```text
queued
  -> preparing-inputs
      uploads, schema validation, cost estimate
  -> ready-to-submit
      complete immutable submission snapshot persisted
  -> submitting
      submissionAttemptedAt persisted before provider call
  -> running
      providerJobId persisted immediately after unambiguous response
  -> succeeded / failed
```

If the provider call may have reached the service but no ID can be extracted:

```text
submitting -> unknown-submit
```

`unknown-submit` is terminal for automation. It requires provider history reconciliation or explicit user action, not a timer retry.

## Submission snapshot

Before calling the paid tool, persist a safe immutable snapshot containing:

- canonical recipe/request version;
- provider, model and mode;
- adapter/contract/schema fingerprints;
- provider parameter keys and sanitized values where safe;
- ordered prepared reference kinds, roles and provider asset IDs;
- cost quote and quote timestamp if available;
- `submissionAttemptedAt`;
- local job ID/idempotency key if supported.

Never persist signed upload URLs, access tokens or raw media bytes in diagnostics.

## No automatic paid fallbacks

Never respond to a provider validation or transport failure by trying:

- a second generation tool;
- another model mode;
- another reference encoding;
- a legacy payload;
- a delayed resubmit;
- a stale-running-job reclaim that invokes generation again.

Crash clearly and fix the adapter. Fallbacks hide contract bugs and can consume a video budget rapidly.

## Cost estimation

Cost is optional read-only metadata unless product policy explicitly makes a quote mandatory.

Rules:

- standalone estimator tools only;
- never call `generate_image` or `generate_video` with a cost flag as a UI estimator unless the live provider contract gives a separately enforceable no-generation guarantee and product owners explicitly accept it;
- debounce form estimates;
- build estimate parameters through the same model adapter, but allow a provider-specific cost projection;
- cache only briefly and invalidate when cost-relevant fields change;
- show unknown rather than guessing from a static price table;
- available account credits are provider status metadata, not canonical recipe data.

StoryBuilder discovered that an earlier Higgsfield path called a generation tool with `get_cost: true` and then called it again for submission. Outputs appeared at separate times and credits were at risk. Regression tests now forbid any cost path from invoking a generation tool. LightTable should adopt that invariant from the beginning.

## Polling and navigation

React and panel lifetime do not own remote jobs. The desktop process owns polling and durable state.

- Persist provider ID before starting polling.
- Opening, closing or switching panels must not resubmit or lose tracking.
- On startup, resume only jobs with a known provider ID.
- A completed sibling must update history even while another job is still running.
- Polling errors are distinct from provider-generation failures.
- Transient network/5xx errors keep a known job recoverable.
- Respect provider rate limits and use bounded backoff/jitter.
- A tracking deadline may stop local polling, but it must not imply that the paid provider job was cancelled.

## Cancellation semantics

LightTable's existing `stopTracking` wording is correct: stopping local polling is not provider cancellation.

Expose Cancel only when the current provider contract has a verified cancellation tool and the adapter confirms the outcome. Otherwise use Stop Tracking and allow Resume Tracking by provider ID.

## Result delivery

Keep these stages separate:

1. provider completes;
2. result URL/asset is resolved;
3. bytes are downloaded and validated;
4. output is atomically stored in AI History;
5. project asset index is updated;
6. job becomes succeeded with durable result IDs;
7. editor opens or places the result.

Failure at stage 7 must not discard, fail or regenerate the paid result.

Validate:

- expected media type and file signature;
- maximum declared and actual byte size;
- result URL origin/authorization policy;
- no input/upload URL or thumbnail is mistaken for the final result.

## Recreate

History should retain three separate objects:

1. editor setup for exact UI restoration;
2. canonical recipe for cross-provider semantic intent;
3. provider execution record for diagnostics and recovery.

Recreate restores the form. It never submits automatically. Provider runtime fields, upload URLs and job IDs do not belong in the reusable recipe.
