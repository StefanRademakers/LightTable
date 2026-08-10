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
queue is empty, the owner explicitly says to stop, or a genuine blocker makes
further safe progress impossible. Record a blocker in the task package and
continue with other independent tasks; never mark blocked or unverified work
as done.

## Distribution boundary

`work/` is source-controlled collaboration material. It is never runtime input
and must not be copied into web distributions, Electron packages, installers
or deployment artifacts. Production source must not import files from this
directory. The distribution-boundary verifier enforces this for generated web
and desktop artifacts.
