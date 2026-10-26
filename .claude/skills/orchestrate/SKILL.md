---
name: orchestrate
description: Turn a large or loosely worded request (a feature, a redesign, a refactor, "implement X with Y and Z") into a structured plan of work packages, each assigned to the right model and agent, then run it — scouts gather context, the heavy model does only the hard parts, cheaper models do docs, checks and commits. Use for any task that spans several files or packages, or when the user asks to plan, split or delegate work.
argument-hint: <what you want built or changed>
---

You are the orchestrator, running on the model the user picked. Spend that model on judgment: understanding the request, design decisions, hard code. Delegate reading, mechanical work, docs, checks and commits.

Request: $ARGUMENTS

If the request is a path to an existing plan (`documents/plans/<slug>/plan.md`, optionally followed by `session <n>`), skip steps 1–3 and follow [references/run-plan.md](references/run-plan.md).

## 1. Brief (you, short)

Rewrite the request as a brief:
- **Goal**: what the user gets, in one or two sentences.
- **Scope**: which apps (VS Code, browser, terminal) and which visible surfaces.
- **Acceptance criteria**: observable checks, one per line. None may need institutional access, a library proxy or a campus network: the user has none.
- **Non-goals**: what is explicitly out.
- **Open questions**: only those whose answer changes the design, each with your default (the option you would pick and why). Apply each default and list it as applied. Ask with AskUserQuestion, bundled in one call, only the questions without a clear default. Do not ask what the code or the docs can answer.

## 2. Scout (cheap, parallel)

Do not read the codebase broadly yourself. Launch one `explorer` scout per area in a single message (they run on Sonnet). Typical areas:
- the core domain the feature belongs to;
- each app's current glue for it;
- the UI and design-system pieces it would use;
- the contracts it touches.

Read the briefs. Open a file yourself only when a decision depends on its exact code.

## 3. Plan (you)

Read [references/planning.md](references/planning.md) and split the work as it says: packages with tier, runner, level and acceptance; a plan directory when the plan is M or larger. Show the plan and wait for approval unless the user said to go ahead.

## 4. Execute

- Do the tier-H packages that need this conversation's context yourself.
- Launch delegated packages with the Agent tool. Write the brief before delegating, from the scouts: goal; "read only" with 5–8 files and line ranges; what is decided (DOM or data shape, names, placement); the seams to reuse; "done when" (tests, commands, limits); "do not touch". Agents do not see this conversation. An agent that stopped without editing got an incomplete brief: fix the brief, never resend the same one.
- Point instead of pasting: name the plan file and step id, the doc section, and the files with line ranges, and let the agent read them. Paste only what is written nowhere, such as a decision taken in this conversation, or a scout's finding the agent would otherwise re-discover.
- Context budget: `.claude/hooks/context-budget.mjs` warns a subagent past 60k tokens and this thread past 150k. A subagent that stops on the warning returns what is left; split that remainder into a new package. This thread keeps going until the session is done; it writes a new session file only when it cannot finish.
- Launch independent packages in one message so they run in parallel.
- If a package's report shows a design problem, fix the plan. Do not patch around it.

## 5. Finish and commit

- Run the `finish` skill (Sonnet) once: `finish session <file>` before each plan session's commit, `finish plan <dir>` after a plan's last session, `finish <brief>` at the end of a change without a plan. It handles the gate, dead code, comments, docs and the review, and fixes the mechanical issues itself. Fix only the findings that need judgment.
- Run the `verify` skill only when the user asks; the user checks UI by hand.
- Commit only if the user asks: `git add <own files> && git commit` in this thread.
- If a plan file exists, tick its steps in `sessions/*.md`.

Report to the user: what was built, the acceptance criteria with pass/fail, what each model did, and anything left open. Ten lines when it went as planned; longer only for concerns.
