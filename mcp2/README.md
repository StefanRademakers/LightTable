# LightTable GenAI provider knowledge pack

Status: working architecture and implementation guidance, 2026-08-17.

This directory is a handoff for improving LightTable's existing GenAI system and adding Higgsfield without replacing the provider-neutral core or damaging local AI providers. It combines:

- the current LightTable implementation;
- the checked-in OpenArt connector snapshot from 2026-08-11;
- the Higgsfield connector snapshot from 2026-08-14;
- behavior observed while integrating and operating both providers in StoryBuilderOnline;
- lessons from paid image and video generation, media publication, polling, recovery and recreate.

It is not a second runtime, a copied provider SDK or an instruction to rewrite the existing packages.

## Read order

1. [LIGHTTABLE_BASELINE.md](LIGHTTABLE_BASELINE.md) — what already exists and must remain intact.
2. [PROVIDER_CONTRACTS.md](PROVIDER_CONTRACTS.md) — OpenArt and Higgsfield facts, differences and connector drift.
3. [MEDIA_REFERENCES_AND_UPLOADS.md](MEDIA_REFERENCES_AND_UPLOADS.md) — the local-file-to-provider-media boundary.
4. [CANONICAL_RECIPE_EVOLUTION.md](CANONICAL_RECIPE_EVOLUTION.md) — evolve the existing request without creating a competing model.
5. [PAID_JOBS_COST_AND_RECOVERY.md](PAID_JOBS_COST_AND_RECOVERY.md) — the non-negotiable credit-safety rules.
6. [HIGGSFIELD_IMPLEMENTATION_PLAN.md](HIGGSFIELD_IMPLEMENTATION_PLAN.md) — a staged addition that preserves OpenArt and local AI.
7. [VERIFICATION_MATRIX.md](VERIFICATION_MATRIX.md) — credit-free tests and the smallest live smoke matrix.

## Authority and freshness

The sources do not all describe the same connector facade. Treat them in this order:

1. current LightTable code and tests for LightTable ownership;
2. the live tool catalog and input schemas negotiated by the current user's connector;
3. current provider model/form discovery;
4. captured connector fixtures for contract tests;
5. dated exports and this knowledge pack;
6. assumptions or examples.

Never hardcode a provider catalog from this directory. Hardcode adapter semantics, safety policy and supported contract families. Discover models, modes, fields, media roles and prices at runtime.

## Non-negotiable preservation rules

- Keep `@lighttable/genai-core` provider-neutral.
- Keep `@lighttable/genai-local` and `apps/local-ai-provider` operational and independent from MCP.
- Do not make provider adapters aware of project folder layouts or editor internals.
- Do not expose OAuth tokens, signed upload URLs or native filesystem paths to React.
- Do not let a provider mutate an `ImageDocument` directly.
- Never silently omit a selected reference or silently reinterpret its semantic role.
- Never automatically repeat a paid generation call after the call may have reached the provider.
- Resume only by a persisted provider job identifier.
- Extra tools are additive. Do not reject a connector merely because it exposes tools LightTable does not use.
- Missing required capabilities disable only the affected provider/workflow, not local AI or the whole GenAI panel.

## Existing source snapshots

- LightTable OpenArt export: `../mcp/openart-lighttable-mcp-export-2026-08-11/`
- StoryBuilder Higgsfield export: `../../StoryBuilderOnline/mcp/higgsfield-lighttable-mcp-export-14-08-2026/`
- StoryBuilder portability notes: `../../StoryBuilderOnline/docs/architecture/genai_recipe_portability_working_notes.md`

The old exports are useful evidence, but they are not a frozen production contract. For example, the OpenArt export does not list `openart_upload_sign`, while the current LightTable implementation successfully discovers and uses that tool. Higgsfield exposes materially different tool facades to different MCP clients.
