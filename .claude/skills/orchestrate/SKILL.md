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
- **Acceptance criteria**: observable checks, one per line. None may need institutional access, a library proxy or a campus network: the user has none.
- **Non-goals**: what is explicitly out.
- **Open questions**: only those whose answer changes the design, each with your default (the option you would pick and why). Apply each default and list it as applied. Ask with AskUserQuestion, bundled in one call, only the questions without a clear default. Do not ask what the code or the docs can answer.

## 2. Scout (cheap, parallel)

Do not read the codebase broadly yourself. Launch one `Explore` scout per area in a single message (they run on Sonnet). Typical areas:
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
- **Level**: how much process it gets, by risk:
  - **task** (move, rename, delete after a grep, compact, docs): no new test and no agent of its own; all of a session's tasks go in one Tasks package, or the main thread does them directly;
  - **behaviour**: one `implementer` works test first on its own (writes the failing test, sees it fail, implements);
  - **contract** (touches `documents/contracts/`, an on-disk format, a protocol, sync, Drive writes, or an extension manifest or its permissions): one `implementer` writes the failing tests first, then implements; `architecture-reviewer` follows only for an on-disk format, sync or Drive writes. These are the hard-to-reverse packages.
- **Acceptance**: the checks that prove it is done; for behaviour and contract, the test seam and the acceptance items the failing tests pin.

| Tier | Work | Runner |
|---|---|---|
| H | design decisions, new UI design (run the `ui-design` skill first), algorithms, cross-package refactors that need judgment, hard debugging | you, in this thread; or `implementer` with `model: "opus"` or `"fable"` when it can run in parallel, or when the user assigned a model to it |
| M | well-specified implementation, moves and splits from a map, tests, reviews | `implementer` / `module-splitter` / `test-writer` / `code-mapper` on Sonnet |
| L | running gates, import fixes, changelog | `check` skill, `import-validator`; commits are a plain `git commit` in this thread |
| Docs | `documents/` updates, comment standard, dead code | the `finish` skill on Sonnet, once at the end |

Routing: pick the tier by the kind of judgment, not the size. Sonnet for machine-checkable output and work with explicit acceptance checks (it is cheaper than Haiku there, because Haiku takes more turns); Opus/Fable for contracts, new abstractions, cross-app work, prompt writing, and a bug that survived one Sonnet attempt.

Escalation: a Sonnet package that fails its acceptance checks twice, or returns CONCERNS instead of a result, moves to `model: "opus"`. Never start a third Sonnet attempt.

Rules for the plan:
- If the user named models ("Fable does the visual"), follow them.
- Size each package by what its agent must read, not by the feature: its brief names 5–8 files with line ranges, so it finishes under the 60k subagent budget. A package that needs more is two packages. A sweep ("what is unused?", "where is X used?") is a scout's job before the brief is written; the brief gets the list of candidates, never the sweep.
- Packages that touch the same files run in sequence. Only packages with disjoint files run in parallel.
- Shared logic lands in core first; app packages depend on it.
- Doubt step: a contract package that still has two viable designs is put to the user as the fork in two lines, with your recommendation; the user decides.
- Size the plan in sessions. Between two sizes, pick the smaller.
- If the plan is M or larger, or has more than about four packages, write the directory `documents/plans/<slug>/` from `documents/plans/TEMPLATE/`: self-contained session files, each delegated package's brief written in full in its session file. Sessions run in order; at most three run at the same time, and only with disjoint Owns. Then stop after approval and give the user the first prompts from `references/handoff.md`. Otherwise, keep the plan in the conversation in the same shape, shortened, and run it here.
- Show the plan to the user and wait for approval before executing, unless they said to go ahead.

## 4. Execute

- Do the tier-H packages that need this conversation's context yourself.
- Launch delegated packages with the Agent tool. Write the brief before delegating, from the scouts: goal; "read only" with 5–8 files and line ranges; what is decided (DOM or data shape, names, placement); the seams to reuse; "done when" (tests, commands, limits); "do not touch". Agents do not see this conversation. An agent that stopped without editing got an incomplete brief: fix the brief, never resend the same one.
- Point instead of pasting: name the plan file and step id, the doc section, and the files with line ranges, and let the agent read them. Paste only what is written nowhere, such as a decision taken in this conversation, or a scout's finding the agent would otherwise re-discover.
- Context budget: `.claude/hooks/context-budget.mjs` warns a subagent past 60k tokens and this thread past 150k. A subagent that stops on the warning returns what is left; split that remainder into a new package. This thread keeps going until the session is done; it writes a new session file only when it cannot finish.
- Launch independent packages in one message so they run in parallel.
- After the last package of a session, run the `check` skill once instead of reading test output yourself.
- If a package's report shows a design problem, fix the plan. Do not patch around it.

## 5. Finish and commit

- Run the `finish` skill once at the end of the whole change or plan, never per session (Sonnet). It handles dead code, comments, docs and the architecture review, and fixes the mechanical issues itself. Fix only the findings that need judgment.
- Run the `verify` skill only when the user asks; the user checks UI by hand.
- Commit only if the user asks: `git add <own files> && git commit` in this thread.
- If a plan file exists, tick its steps in `sessions/*.md`.

Report to the user: what was built, the acceptance criteria with pass/fail, what each model did, and anything left open. Ten lines when it went as planned; longer only for concerns.

## Running a plan file

A session reads its session file and nothing else of the plan: not `plan.md`, not `log.md`, not other sessions. The session file is self-contained; if it is not, that is a planning bug to report, not a reason to read more.

1. Pick the session: the one named in the request, or the lowest-numbered file in `sessions/`. Read only that file. Check its **Starts from** against the session context hook; if the repo is not in that state, stop and say what differs.
2. Run its packages as in steps 4–5 above and nothing from other sessions. `research/` entries it names go into the implementer briefs by path; the implementer reads them, the main thread does not, and nothing is re-scouted unless a package fails on a wrong premise. Sibling sessions may edit the same worktree: touch, check and commit only the session's **Owns**.
3. End the session:
   - run `check` on the **Owns**;
   - append one line to `log.md` with `>>`: date, session id, done/left, commit hash;
   - delete the session file;
   - commit the session's own files with `git add <Owns files> && git commit` in this thread; approving the plan authorises those commits.
4. If it was the last session: run `finish` once on everything the plan touched, then delete the plan directory.
5. Reply with the handoff message from `references/handoff.md` and stop.
