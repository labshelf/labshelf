---
name: orchestrate
description: Turn a large or loosely worded request (a feature, a redesign, a refactor, "implement X with Y and Z") into a structured plan of work packages, each assigned to the right model and agent, then run it — scouts gather context, the heavy model does only the hard parts, cheaper models do docs, checks and commits. Use for any task that spans several files or packages, or when the user asks to plan, split or delegate work.
argument-hint: <what you want built or changed>
---

You are the orchestrator, running on the model the user picked. Spend that model on judgment: understanding the request, design decisions, hard code. Delegate reading, mechanical work, docs, checks and commits.

Request: $ARGUMENTS

If the request is a path to an existing plan (`documents/plans/<slug>/plan.md`, optionally followed by `session <n>`), skip steps 1–3 and follow **Running a plan file** below.

## 1. Brief (you, short)

Rewrite the request as a brief:
- **Goal**: what the user gets, in one or two sentences.
- **Scope**: which apps (VS Code, browser, terminal) and which visible surfaces.
- **Acceptance criteria**: observable checks, one per line.
- **Non-goals**: what is explicitly out.
- **Open questions**: only those whose answer changes the design, each with your default (the option you would pick and why). Ask them now with AskUserQuestion, bundled in one call, the default first and marked "(Recommended)". Do not ask what the code or the docs can answer. If you would bet on the default and the choice is two-way, apply it and say so instead of asking.

## 2. Scout (cheap, parallel)

Do not read the codebase broadly yourself. Launch one `Explore` scout per area in a single message (they run on Sonnet). For a single narrow lookup, pass `model: "haiku"`. Typical areas:
- the core domain the feature belongs to;
- each app's current glue for it;
- the UI and design-system pieces it would use;
- the contracts it touches.

Read the briefs. Open a file yourself only when a decision depends on its exact code.

## 3. Plan (you)

Split the work into packages. Each package states:
- **Id and goal**: one sentence.
- **Files**: the files it creates or changes, and what it must not touch.
- **Depends on**: other package ids.
- **Tier, runner and model**: see the table below.
- **Door**: one-way if it touches `documents/contracts/` or an on-disk format, sync, Drive writes, or an extension manifest or its permissions; otherwise two-way.
- **Acceptance**: the checks that prove it is done.
- **Test first**: for a behaviour change, the test seam and the acceptance items the failing tests pin. Moves, splits, docs and tooling say "n/a".

| Tier | Work | Runner |
|---|---|---|
| H | design decisions, new UI design (run the `ui-design` skill first), algorithms, cross-package refactors that need judgment, hard debugging | you, in this thread; or `implementer` with `model: "opus"` or `"fable"` when it can run in parallel, or when the user assigned a model to it |
| M | well-specified implementation, moves and splits from a map, tests, reviews | `implementer` / `module-splitter` / `test-writer` / `code-mapper` on Sonnet |
| L | running gates, import fixes, commits, changelog | `check` skill, `import-validator`, `commit-splitter` on Haiku |
| Docs | `documents/` updates, comment standard, dead code | the `finish` skill on Sonnet, once at the end |

Routing: pick the tier by the kind of judgment, not the size. Haiku only when the output is machine-checkable; Sonnet when explicit acceptance checks exist; Opus/Fable for contracts, new abstractions, cross-app work, prompt writing, and a bug that survived one Sonnet attempt.

Escalation: a Sonnet package that fails its acceptance checks twice, or returns CONCERNS instead of a result, moves to `model: "opus"`. Never start a third Sonnet attempt.

Rules for the plan:
- If the user named models ("Fable does the visual"), follow them.
- A behaviour package runs as two steps: `test-writer` writes the failing tests from its acceptance items, then the `implementer` gets their paths and makes them pass. A target the agent can check against is what keeps the implementer from looping.
- Size each package by what its agent must read, not by the feature: at most about ten files or ranges, so it finishes under the 60k subagent budget. A package that needs more is two packages.
- Packages that touch the same files run in sequence. Only packages with disjoint files run in parallel.
- Shared logic lands in core first; app packages depend on it.
- Doubt step: a one-way package that still has two viable designs goes to the `council` skill before it runs, and its verdict becomes the package's decision. It costs about 200k subagent tokens, so a one-way package with one obvious design only states why there is no fork.
- Size the plan with the scale in `documents/plans/TEMPLATE/plan.md` (P, M, G, GG in AI sessions). Read `documents/plans/CALIBRATION.md` first and correct for its bias. Between two sizes, pick the smaller and write what would make it grow.
- If the plan is G or GG, or has more than about five packages, write the directory `documents/plans/<slug>/` from `documents/plans/TEMPLATE/`, split into sessions of about four delegated steps each. Then stop after approval and tell the user to start session 1 in a fresh conversation with the prompt from `references/handoff.md`. Otherwise, keep the plan in the conversation in the same shape, shortened, and run it here.
- Show the plan to the user and wait for approval before executing, unless they said to go ahead.

## 4. Execute

- Do the tier-H packages that need this conversation's context yourself.
- Launch delegated packages with the Agent tool. Their prompts must be **self-contained**: goal, files, what not to touch, acceptance checks. Agents do not see this conversation.
- Point instead of pasting: name the plan file and step id, the `AGENTS.md` section, and the files with line ranges, and let the agent read them. Paste only what is written nowhere, such as a decision taken in this conversation, or a scout's finding the agent would otherwise re-discover.
- Context budget: `.claude/hooks/context-budget.mjs` warns a subagent past 60k tokens and this thread past 100k. A subagent that stops on the warning returns what is left; split that remainder into a new package. When the warning reaches this thread, finish the current package, log it, and hand off (`references/handoff.md`) instead of continuing; never rely on compaction, which is off for this project.
- Launch independent packages in one message so they run in parallel.
- After each package, run the `check` skill (Haiku) instead of reading test output yourself. `finish` reuses the last `check` result when the tree has not changed since.
- If a package's report shows a design problem, fix the plan. Do not patch around it.

## 5. Finish and commit

- Run the `finish` skill once at the end (Sonnet). It handles dead code, comments, docs and the architecture review, and fixes the mechanical issues itself. Fix only the findings that need judgment.
- If the change is UI, extension host or terminal behaviour, run the `verify` skill and look at the screenshots it lists.
- Commit only if the user asks: `commit-splitter` (Haiku).
- If a plan file exists, tick its steps in `sessions/*.md` and append one line per step to `log.md` with `>>`.

Report to the user: what was built, the acceptance criteria with pass/fail, what each model did, and anything left open.

## Running a plan file

1. Read `plan.md` (header, §1, §2). If any decision is unchecked or any Q is open, ask about it before anything else. Never read `log.md` whole.
2. Pick the session: the one named in the request, or the lowest-numbered file in `sessions/`. Check its **Starts from** against the session context, which gives the branch and uncommitted work. If the repo is not in that state, stop and say what differs.
3. Read only that session file and the `research/` entries it names. Run `node scripts/research-fresh.mjs`: re-scout each `stale` entry with an `Explore` scout and save its brief to `research/<area>.md` with a heredoc, under the header `sha:` (current `git rev-parse --short HEAD`), `files:`, `source:`; put `fresh` entries into the implementer briefs. Run the steps as in steps 4–5 above and nothing from later sessions. Set the status in `plan.md` to `in progress (session <n> of <m>)`.
4. End the session:
   - run the `finish` skill;
   - tick the steps in the session file and the acceptance criteria in `plan.md` they meet;
   - append `log.md` lines with `>>` (date and time, one line per step, one line with the peak context of this thread and of the largest subagent from `node scripts/agent-tokens.mjs`);
   - delete the finished session file after logging it;
   - commit if the session says **Commit: yes**. Approving the plan authorises those commits; use `commit-splitter`.
5. If it was the last session:
   - set the status in `plan.md` to `done`;
   - add a row to `documents/plans/CALIBRATION.md` with the estimated size and sessions, the sessions used, the real time from the first `log.md` line to the last, the highest main-thread peak from the log, the real size, and why they differed;
   - update its bias line;
   - delete the plan directory, or archive it only if it meets `documents/archive/README.md`.
6. Reply with the handoff message from `references/handoff.md` and stop. Never start the next session in this conversation; a fresh context is the point of splitting.
