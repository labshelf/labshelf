# Planning

Read when you split work into packages or write a plan directory.

Split the work into packages. Each package states:
- **Id and goal**: one sentence.
- **Files**: the files it creates or changes, and what it must not touch.
- **Depends on**: other package ids.
- **Tier, runner and model**: see the table below.
- **Level**: how much process it gets, by risk:
  - **task** (move, rename, delete after a grep, compact, docs): no new test and no agent of its own; all of a session's tasks go in one Tasks package, or the main thread does them directly;
  - **behaviour**: one `implementer` works test first on its own (writes the failing test, sees it fail, implements);
  - **contract** (touches `documents/contracts/`, an on-disk format, a protocol, sync, or an extension manifest or its permissions): one `implementer` writes the failing tests first, then implements; `finish session` checks it against its contract section before the commit. These are the hard-to-reverse packages.
- **Acceptance**: the checks that prove it is done; for behaviour and contract, the test seam and the acceptance items the failing tests pin.

| Tier | Work | Runner |
|---|---|---|
| H | design decisions, new UI design (read `documents/ui.md` first), algorithms, cross-package refactors that need judgment, hard debugging | you, in this thread; or `implementer` with `model: "opus"` or `"fable"` when it can run in parallel, or when the user assigned a model to it |
| M | well-specified implementation, moves and splits from a map, tests, reviews | `implementer` on Sonnet |
| L | running gates, import fixes, changelog | `pnpm gate`; commits are a plain `git commit` in this thread |
| Docs | `documents/` updates, comment standard, dead code | the `finish` skill on Sonnet, per session and once for the plan |

Routing: pick the tier by the kind of judgment, not the size. Sonnet for machine-checkable output and work with explicit acceptance checks (it is cheaper than Haiku there, because Haiku takes more turns); Opus/Fable for contracts, new abstractions, cross-app work, prompt writing, and a bug that survived one Sonnet attempt.

Escalation: a Sonnet package that fails its acceptance checks twice, or returns CONCERNS instead of a result, moves to `model: "opus"`. Never start a third Sonnet attempt.

Rules for the plan:
- If the user named models ("Fable does the visual"), follow them.
- Size each package by what its agent must read, not by the feature: its brief names 5–8 files with line ranges, so it finishes under the 60k subagent budget. A package that needs more is two packages. A sweep ("what is unused?", "where is X used?") is a scout's job before the brief is written; the brief gets the list of candidates, never the sweep.
- Packages that touch the same files run in sequence. Only packages with disjoint files run in parallel.
- Shared logic lands in core first; app packages depend on it.
- Doubt step: a contract package that still has two viable designs is put to the user as the fork in two lines, with your recommendation; the user decides.
- Size the plan in sessions. Between two sizes, pick the smaller.
- If the plan is M or larger, or has more than about four packages, write the directory `documents/plans/<slug>/` from `documents/plans/TEMPLATE/`: self-contained session files, each delegated package's brief written in full in its session file. Sessions run in order; at most three run at the same time, and only with disjoint Owns. Then stop after approval and give the user the first prompts from [handoff.md](handoff.md). Otherwise, keep the plan in the conversation in the same shape, shortened, and run it here.
- Show the plan to the user and wait for approval before executing, unless they said to go ahead.
