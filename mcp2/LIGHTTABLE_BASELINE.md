# Existing LightTable GenAI baseline

LightTable already has the correct high-level direction: a provider-neutral request and job model, thin provider packages, a desktop-owned security/filesystem boundary, and an independent local provider protocol. Higgsfield should enter through these seams rather than creating a parallel GenAI application.

## Current ownership

| Owner | Responsibility |
| --- | --- |
| `packages/genai-core/src` | Provider-neutral providers, models, workflows, fields, references, prompts, jobs, results and host ports |
| `packages/genai-openart/src` | OpenArt discovery, normalization and request parameter conversion |
| `packages/genai-local/src` | Versioned HTTP/multipart protocol for local or separately hosted compatible providers |
| `apps/local-ai-provider` | Managed local provider process and implementation |
| `apps/desktop/src/genai` | OAuth, credentials, catalog persistence, provider transport, local process ownership, project job state and media publication |
| `packages/lighttable-app/src/genai` | Provider-neutral setup, prompt/reference UI and projected durable job history |
| `LightTableHost` and Electron preload | Narrow serializable host bridge; no token or native path exposure |

The important current files are:

- `packages/genai-core/src/domain/contracts.ts`
- `packages/genai-core/src/domain/promptMentions.ts`
- `packages/genai-openart/src/openArtGenerationParams.ts`
- `apps/desktop/src/genai/openArtConnectionController.ts`
- `apps/desktop/src/genai/prepareProjectAssetReferences.ts`
- `apps/desktop/src/genai/projectAssetRemoteLinks.ts`
- `apps/desktop/src/genai/localAiGenerationController.ts`
- `packages/genai-local/src/protocol.ts`
- `packages/genai-local/src/client.ts`
- `packages/lighttable-app/src/genai/application/useGenAiSetupController.ts`
- `packages/lighttable-app/src/genai/application/useGenAiJobsController.ts`

## Existing canonical flow

```text
clipboard / open document / project asset
    -> durable project asset in AI Input
    -> opaque GenAiAssetId in renderer state
    -> GenAiGenerationRequest
    -> desktop resolves bytes only when needed
    -> provider-specific input transport
    -> exactly one provider submission
    -> persist provider job id
    -> poll/recover outside React
    -> atomically store output in AI History
    -> open/place output through editor commands
```

This is a sound model. In particular:

- pasted images are imported into the project before use;
- an open document is exported to a PNG artifact and enters the same import path;
- references in a request are authoritative, even when the prompt does not mention them;
- prompt bindings provide names, not membership or identity;
- OpenArt receives reachable HTTPS media;
- local providers receive multipart bytes;
- output persistence and editor placement are separate stages;
- closing a panel does not own or cancel a job;
- restart recovery with a known provider ID polls instead of resubmitting.

## Local AI must remain a first-class transport

Local AI is not an MCP fallback. It is a separate provider family with a versioned protocol:

```text
GenAiGenerationRequest
    -> resolve local project bytes
    -> LocalAiImageJobRequestV1 + multipart binary inputs
    -> loopback or explicitly configured HTTPS provider
```

Adding Higgsfield must not:

- require a remote URL in `GenAiAssetReference`;
- make all references pass through an MCP uploader;
- put OpenArt or Higgsfield fields into `LocalAiImageJobRequestV1`;
- change the local provider's base/reference/selection-mask multipart semantics;
- make the managed local process depend on OAuth or project remote-link indexes;
- turn provider failure into global GenAI unavailability.

The shared abstraction is semantic input. Transport remains provider-owned.

## Current seams worth improving

### Generation execution is more branched than discovery

The desktop `GenAiProviderRegistry` currently owns connection, discovery, workflow loading and cost estimation. Generation in `main.ts` still branches explicitly between OpenArt and registered HTTP/local providers.

Higgsfield should not add a third large provider branch. Introduce a small desktop execution capability, or a separate generation runtime registry, while leaving the renderer host contract stable.

An appropriate shape is capability-based rather than a universal provider class:

```ts
interface DesktopGenerationRuntime {
  readonly providerId: GenAiProviderId;
  prepare(request: GenAiGenerationRequest, assets: AssetResolver): Promise<PreparedGeneration>;
  submit(jobId: GenAiJobId, prepared: PreparedGeneration): Promise<ProviderSubmission>;
  poll(providerJobId: string, signal: AbortSignal): Promise<ProviderCompletion>;
}
```

OpenArt, Higgsfield and local HTTP providers may implement that boundary differently. Do not force local binary inputs into remote publication types.

### Publication cache needs content revision

Project asset IDs are derived from relative paths. Replacing the bytes at the same path retains the ID. `ProjectAssetRemoteLink` is currently keyed by asset ID and provider, without the source modification time, size or content hash.

That can reuse an older provider upload after a file changes. A future cache record should include a source fingerprint:

```ts
type SourceRevision = {
  modifiedAt: string;
  byteLength: number;
  sha256?: string;
};
```

For correctness, reuse requires `(assetId, providerId, sourceRevision, unexpired publication)`.

### Preparation and paid submission need different states

The current desktop job becomes `submitting` before OpenArt reference publication. An upload failure and an ambiguous paid submit can therefore both become `unknown-submit`.

Use explicit phases:

```text
queued
preparing-inputs       safe to retry; no paid call made
ready-to-submit        all validation and publication complete
submitting             paid boundary may have been crossed
running                provider id persisted
succeeded / failed / unknown-submit
```

Only an uncertain outcome from `submitting` belongs in `unknown-submit`.

### Documentation mismatch

`architecture/features/GENAI_BOUNDED_CONTEXT.md` describes a configured first-party relay for OpenArt publication. Current code instead discovers `openart_upload_sign`, performs the signed PUT, and resolves durable metadata directly through OpenArt. Code and tests are authoritative; update canonical architecture when implementation work touches this area.
