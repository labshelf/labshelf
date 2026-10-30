# Planning

Read when you split work into packages or write a plan directory. `plan <cmd>` means `node scripts/plans/plan.mjs <cmd>`.

## YAML planning flow (N2, N3)

1. One `explorer` per area returns a `brief/v1`; save it to `documents/plans/<slug>/research/<area>.brief.yaml`.
2. `plan new <slug> --level N2|N3`, then `plan from-brief <brief> --spec <id>` per package; it copies `edit`, `read`, `callers`, `commands` and `sha` into a draft spec.
3. Fill each spec yourself: `goal`, `acceptance`, `seams`, `decided`, `level`, `runner.model`, and `tests`: the hidden test paths plus a `tests.command` through `node scripts/agents/run.mjs test <pkg> --spec <id> --plan <slug> -- <path>`, or `{none: <reason>}` for layout, CSS, copy and glue. `plan stubs` generates the seams' stubs.
4. One `tester` per spec with tests; its prompt is the spec block only. Then `plan red <session> <id>`; a test it rejects goes back to the tester with the output.
5. `plan lint <plan dir>` must print nothing. N3: leave `status: draft`, show the plan and ask for approval. N2: set `status: approved` and run it.

A package that renames a symbol or moves files is level task and its spec names the command in `commands`, not manual edits: `node scripts/codemods/renameSymbol.mjs <file> <old> <new>` or `node scripts/codemods/moveFiles.mjs <tsv>` (lines `old<TAB>new`, `--dry-run` first).

Before specifying a new function, check it does not exist: `node scripts/code/facts.mjs def <name>`, `fn '<what it does>'`, `sig '<type>'` or `similar -` in this thread, never through an explorer.

## Packages

Split the work into packages. Each package (a `spec/v1` in the YAML flow) states:
- **Id and goal**: one sentence.
- **Files**: the files it creates or changes, and what it must not touch.
- **Depends on**: other package ids.
- **Tier, runner and model**: see the table below.
- **Level**: how much process it gets, by risk:
  - **task** (move, rename, delete after `facts callers`, compact, docs): no new test and no agent of its own; all of a session's tasks go in one Tasks package, or the main thread does them directly (unattended, it edits only `documents/`);
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
- Size each package by what its agent must read, not by the feature: its brief names 5–8 files with line ranges, so it finishes before the 80k subagent context warning. A package that needs more is two packages. A sweep ("what is unused?", "where is X used?") is a scout's job before the brief is written; the brief gets the list of candidates, never the sweep.
- A session holds at most 3 packages that run an `implementer` (task packages do not count); split a larger session in two. `plan lint` flags a session over the limit.
- Packages that touch the same files run in sequence. Only packages with disjoint files run in parallel.
- Shared logic lands in core first; app packages depend on it.
- Doubt step: a contract package that still has two viable designs is put to the user as the fork in two lines, with your recommendation; the user decides.
- Size the plan in sessions. Between two sizes, pick the smaller.
- N2 and N3 plans are written with `plan new` as above: self-contained session files, each package a full spec. Sessions run in `depends_on` order; at most three run at the same time, and only with disjoint `owns`. After an N3 approval, stop and give the user the first prompts from [handoff.md](handoff.md). N0 and N1 keep the plan in the conversation and run it here. Legacy `.md` plans are no longer written; existing ones still run.
- Show the plan to the user and wait for approval before executing, unless they said to go ahead.
