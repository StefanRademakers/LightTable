# LightTable work queue

This directory is the versioned task workflow shared between development
machines.

- `todo/` contains actionable task packages.
- `done/` contains completed task packages and their original reference
  material.

Each task keeps its instructions, screenshots and other fixtures together in
one directory. When a task is completed and verified, move that complete task
directory from `todo/` to `done/` in the same commit as the implementation.

Product and engineering contracts do not live here. Durable system knowledge
belongs in [`architecture/`](../architecture/README.md); this directory records
concrete work and its evidence.

Candidate-specific or superseded task packages are removed from the active
queue once their reusable knowledge is captured in `architecture/`. Git history
retains the original package; `done/` is reserved for work that actually met
its completion contract.

## Autonomous queue command

When the project owner says **"werk alle openstaande tasks uit"**, or gives an
equivalent instruction to finish the queue, that is a persistent execution
contract for the current run:

1. Enumerate `todo/` in deterministic task order.
2. Read the complete task package, including its reference images.
3. Implement one cohesive task at a time.
4. Run the relevant unit/boundary checks and verify both web and desktop when
   the changed boundary is shared.
5. Commit the verified implementation locally with a focused message.
6. Move the complete task directory from `todo/` to `done/` in that same
   milestone commit, then continue with the next task without waiting for
   confirmation.

A status question does not cancel the queue instruction. Stop only when the
queue is empty, the owner explicitly says to stop, a genuine blocker makes
further safe progress impossible, or the eight-hour owner checkpoint below is
due. Record a blocker in the task package and continue with other independent
tasks; never mark blocked or unverified work as done.

## Autonomous-result loop

Persistence means continuing toward the product outcome, not continuing one
measurement, implementation strategy or metric after its product return has
collapsed. During autonomous work, repeat this loop:

1. Implement a user-meaningful vertical slice.
2. Exercise the real user flow at the changed boundary, not only its unit or
   synthetic smoke tests.
3. Compare the product with its state before the slice.
4. State the net result: what visibly works better, what remains unchanged,
   what regressed, and what is known only from automation.
5. Continue, change strategy, or move to the next useful part of the task.

Plans and implementation assumptions are hypotheses, not promises that must be
defended after new evidence disproves them. The owner and agent may both revise
direction. When that happens, identify what the new evidence changes, recheck
earlier work that depends on the invalid assumption, preserve independently
proven good work, and update only the durable lesson. Treat correction as part
of delivery, while remaining explicit about its cost and product impact.

Metrics such as visual-parity percentages are evidence in service of the task;
they are not allowed to silently replace the product goal. An extreme target
does not justify unbounded probing. Start with representative neutral,
mid-range and endpoint cases, then deepen the corpus only when those results
identify a plausible product improvement or a concrete release risk.

Every activity must justify its time through a user-facing improvement or a
material reduction of product risk. Use this evidence hierarchy:

1. The complete user flow and its visible result.
2. Product regression coverage that protects an already working flow as the
   application expands.
3. Integration and contract tests at durable system boundaries.
4. Unit tests that accelerate implementation or protect a stable invariant.
5. Disposable probes and research tooling that answer one named decision.

Tests are engineering instruments, not product results. Test count, corpus
size, code volume and elapsed effort never count as progress on their own. Keep
a unit test when it cheaply protects durable behavior; do not preserve tests or
fixtures merely because they took effort to create. Expand a regression suite
in proportion to the user value and regression risk it protects.

Automated checks may prove a bounded technical contract. They do not prove a
provider login, paid submission, interaction flow, visual outcome or external
application roundtrip when that real boundary was not exercised. Label such
work `manual validation required`; do not move it to `done/`.

## Decision support

The project owner leads product direction. The agent is responsible for strong
execution and for supplying information that supports an informed decision,
not for making the situation sound agreeable. Lead with the conclusion and
separate:

- proven facts;
- interpretation;
- uncertainty and untested boundaries;
- risks and consequences;
- viable options;
- the recommended option and its reasoning;
- the result reasonably expected from each option.

Do not simulate agreement to preserve tone. Challenge a proposal directly when
product logic, UX, architecture, performance or evidence argues against it,
and offer a better route where one exists. Do not soften a material problem,
inflate progress, reuse earlier results as current-run progress, or use a long
explanation to conceal a weak outcome. Precision is required; hostility is not.

Use capability language literally:

- `I can deliver this` means there is a credible route to the complete stated
  outcome within the available boundaries.
- `Foundation implemented` means the user flow may still be incomplete.
- `Technically verified` identifies the exact automated boundary and no more.
- `Done` means the representative end-to-end product flow passed.
- If evidence invalidates an earlier capability claim, report that change
  immediately rather than hiding it behind more activity.

## Eight-hour owner checkpoint

No autonomous run may continue for more than eight elapsed hours without an
owner checkpoint. This is a handoff and product-control boundary, not a reason
to abandon difficult work or a substitute for judgment during the run. At or
before that boundary:

1. Stop launching new long-running work and leave the repository in an
   inspectable state.
2. Report only results produced during the current run; do not count earlier
   completed work again.
3. Separate user-visible product changes, technical evidence, documentation,
   failed attempts and uncommitted work.
4. Identify which complete user flows were exercised manually, which were
   automated only, and which remain unverified.
5. Give the exact commit/worktree state, known regressions, open risks and the
   recommended next slice.
6. Wait for owner review, testing or an explicit instruction that starts the
   next autonomous period.

The checkpoint may occur earlier when new evidence materially changes scope or
shows that the current approach is producing little product value. That means
reassessing and redirecting the work, not merely stopping at an arbitrary time.

## Completion truthfulness

A task moves to `done/` only when its stated product outcome is integrated and
the most representative available end-to-end flow passes. If an external
credential, paid boundary, owner visual decision or unavailable host prevents
that proof, retain the task in `todo/` with its completed foundation and exact
remaining validation. Code presence, passing unit tests, commit volume and
elapsed effort are never substitutes for completion.

## Distribution boundary

`work/` is source-controlled collaboration material. It is never runtime input
and must not be copied into web distributions, Electron packages, installers
or deployment artifacts. Production source must not import files from this
directory. The distribution-boundary verifier enforces this for generated web
and desktop artifacts.
