---
name: orchestrate
description: Turn a large or loosely worded request (a feature, a redesign, a refactor, "implement X with Y and Z") into a structured plan of work packages, each assigned to the right model and agent, then run it — scouts gather context, the heavy model does only the hard parts, cheaper models do docs, checks and commits. Use for any task that spans several files or packages, or when the user asks to plan, split or delegate work.
argument-hint: <what you want built or changed>
---

You are the orchestrator, running on the model the user picked. Spend that model on judgment: understanding the request, design decisions, hard code. Delegate reading, mechanical work, docs, checks and commits.

Request: $ARGUMENTS

`plan <cmd>` below means `node scripts/plans/plan.mjs <cmd>`. Handoffs between agents are YAML blocks; [references/handoff.md](references/handoff.md) lists the kinds and who returns each.

If the request is a path to an existing plan, skip steps 1–3:
- `documents/plans/<slug>/plan.yaml session <id>`: run that session as in step 4 and [references/run-plan.md](references/run-plan.md).
- `documents/plans/<slug>/plan.md` (optionally `session <n>`): a legacy plan; follow the legacy section of [references/run-plan.md](references/run-plan.md).

If this run is unattended (the runner says so in the system prompt), also follow [references/unattended.md](references/unattended.md).

## 1. Brief and level (you, short)

Rewrite the request as a brief:
- **Goal**: what the user gets, in one or two sentences.
- **Scope**: which apps (VS Code, browser, terminal) and which visible surfaces.
- **Acceptance criteria**: observable checks, one per line. None may need institutional access, a library proxy or a campus network: the user has none.
- **Non-goals**: what is explicitly out.
- **Open questions**: only those whose answer changes the design, each with your default (the option you would pick and why). Apply each default and list it as applied. Ask with AskUserQuestion, bundled in one call, only the questions without a clear default. Do not ask what the code or the docs can answer.

Then pick the level. `plan size <paths…>` suggests one of N0–N3 from files, packages, callers and risk paths; confirm it or override it with one line of reason.

| Level | Flow |
|---|---|
| N0 | You edit in this thread, check with `node scripts/agents/run.mjs`, done. No plan, no agents. |
| N1 | No plan file. One `implementer` with an inline `spec/v1` in its prompt. `tester` and `finisher` only when `plan size` lists a risk path. |
| N2 | `plan new <slug> --level N2`: one session, one `explorer` per area, `tester` for logic, formats, sync or data loss, `finisher` once. Approve it yourself and run it. |
| N3 | `plan new <slug> --level N3`: several sessions; stop for the user's approval before running. |

"Does X exist?" is answered here, in this thread, with `node scripts/code/facts.mjs def|fn|sig|similar …`, never by spawning an explorer.

## 2. Scout (N2, N3; cheap, parallel)

Do not read the codebase broadly yourself. Launch one `explorer` per area in a single message (they run on Sonnet). Typical areas: the core domain the feature belongs to; each app's current glue for it; the UI and design-system pieces it would use; the contracts it touches. Each returns a `brief/v1`; save it to `documents/plans/<slug>/research/<area>.brief.yaml`. Open a file yourself only when a decision depends on its exact code.

## 3. Plan (N2, N3)

Follow [references/planning.md](references/planning.md): `plan from-brief` per package, fill each spec, `tester` writes the hidden tests, `plan red` proves them red, `plan lint` must be silent. N3 stops at `status: draft` for approval; N2 sets `approved` and runs.

## 4. Run a YAML session

Per package, in `depends_on` order, independent packages in one message so they run in parallel:

1. `plan stale <session> <id>`; re-scout only the stale paths, update the spec and its `sha`.
2. `plan start <session> <id>`, then `plan prompt <session> <id>` → `Agent` `implementer` with `model: <runner.model>`.
3. Route its `report/v1` by `status`:
   - `done` → next package.
   - `missing` → an `explorer` for exactly the listed needs → update the spec → a new implementer.
   - `blocked_tests` → `arbiter`; its `verdict/v1` routes to an `opus` implementer with the `hint` (`code_wrong`), the `tester` with the `fix` then `plan red` (`test_wrong`), or the user / a blocked session (`spec_ambiguous`).
   - `failed` → `diagnoser`; its `diagnosis/v1` `spec` becomes the next spec.
4. After all packages: `finish session <file>` (the finisher review, which also checks every `possible duplicate` note from `dup-guard`), then `plan close <session>`, which commits. Never commit by hand in the YAML flow.

Details in [references/run-plan.md](references/run-plan.md). If a report shows a design problem, fix the spec or the plan; do not patch around it. Context budget: `.claude/hooks/context-budget.mjs` warns a subagent past 60k tokens and this thread past 150k; a subagent that stops on the warning returns what is left, and you split that into a new package.

## 5. Finish and report

- Without a plan (N0, N1): run `finish <brief>` only when a risk path is touched; commit only if the user asks, with `git add <own files> && git commit` in this thread.
- After a plan's last session: `finish plan <dir>`.
- Run the `verify` skill only when the user asks; the user checks UI by hand.

Report to the user: what was built, the acceptance criteria with pass/fail, what each model did, and anything left open. Ten lines when it went as planned; longer only for concerns. At the end of a plan session, reply with the handoff message from [references/handoff.md](references/handoff.md).
