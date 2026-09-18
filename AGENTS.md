# LightTable coding-agent entry point

Before investigating or changing this repository:

1. Read `docs/agent_handoff.md` for the current architecture reset.
2. Run `npm run context:agent` and preserve all unrelated worktree changes.
3. Follow `architecture/AGENT_ONBOARDING.md` and load only the contracts routed
   by the requested change.
4. When working below `packages/lighttable-app`, also follow its local
   `AGENTS.md`.

Current code, tests and the canonical contracts under `architecture/` outrank
the handoff if they disagree. A resume checkpoint describes interrupted work;
it never overrides newer code or owner direction.
