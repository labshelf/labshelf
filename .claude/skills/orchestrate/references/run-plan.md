# Running a plan

Read when the request is a path to a plan. `plan <cmd>` means `node scripts/plans/plan.mjs <cmd>`.

## YAML sessions (`plan.yaml`)

A session reads its `sessions/<id>.yaml` and nothing else of the plan. The specs in it are self-contained; a gap is a planning bug to fix in the spec, not a reason to read more.

1. Check the session's `depends_on` sessions are `done` and its own `status` is not `blocked`; if not, stop and say why.
2. Per package, in `depends_on` order; packages without a dependency between them run in parallel, launched in one message:
   1. `plan stale <session> <id>`: when it lists stale paths, send an `explorer` for only those paths, update the spec (`edit`, `read`, `callers`) and set its `sha`.
   2. `plan start <session> <id>`, then `plan prompt <session> <id>`; pass the printed prompt to `Agent` `implementer` with `model: <runner.model>`.
   3. The `check-handoff` hook saves its `report/v1` in `.git/labshelf-runs/<plan>/<id>.report.yaml`. Route it by `status`:
      - `done` → next package.
      - `missing` → an `explorer` for exactly the listed `missing` needs → update the spec (`edit`, `read`, `callers`) → a new implementer.
      - `blocked_tests` → `arbiter` with the spec, the hidden test paths and the log path. Its `verdict/v1`:
        - `code_wrong` → a new implementer on `opus`, with the `hint` appended to the prompt;
        - `test_wrong` → `tester` fixes the test with the `fix`, then `plan red <session> <id>` again (event `test_fixed`);
        - `spec_ambiguous` → attended: ask the user the `question`; unattended: set the session `blocked` with the `question` ([unattended.md](unattended.md)).
      - `failed` → `diagnoser`; the `spec` of its `diagnosis/v1` becomes the next spec, run by a new implementer.
   4. An implementer that returns twice without `done` on Sonnet moves to `opus`; never start a third Sonnet attempt.
3. After all packages:
   - `finish session <session file>`: the finisher gates the session's `owns`, reviews, and checks every `possible duplicate` note `dup-guard` printed (reused, extended, or a stated reason why not). The gate, `pnpm lint` and the fixes they need run inside the finisher, never in the main thread. The main thread only routes its result: each needs-judgment item becomes a spec package in the session file, run by an `implementer`.
     A passing finisher records its gate and leaves `.git/labshelf-runs/<plan>/<session>.finished` for the exact tree. A reopened session runs `plan finished <session> --check` first: on a match it goes straight to `plan close`; otherwise it runs `finish session` with `changed: <files>` on only what it lists.
   - `plan close <session>`: it reuses the finisher's gate when the tree is unchanged (else gates again), marks the session `done`, logs it, commits the session's `owns` and removes the finished marker. Never commit by hand in the YAML flow.
4. After the plan's last session: `finish plan <plan dir>`.
5. Reply with the handoff message from [handoff.md](handoff.md) and stop.

## Legacy `.md` sessions (`plan.md`)

Plans with `sessions/*.md` keep this flow, including the commit after `finish session`.

A session reads its session file and nothing else of the plan: not `plan.md`, not `log.md`, not other sessions. The session file is self-contained; if it is not, that is a planning bug to report, not a reason to read more.

1. Pick the session: the one named in the request, or the lowest-numbered file in `sessions/`. Read only that file. Check its **Starts from** against the session context hook; if the repo is not in that state, stop and say what differs.
2. Run its packages as below, and nothing from other sessions. `research/` entries it names go into the implementer briefs by path; the implementer reads them, the main thread does not, and nothing is re-scouted unless a package fails on a wrong premise. Sibling sessions may edit the same worktree: touch, check and commit only the session's **Owns**.
   - Do the tier-H packages that need this conversation's context yourself.
   - Launch delegated packages with the Agent tool. Write the brief before delegating: goal; "read only" with 5–8 files and line ranges; what is decided (DOM or data shape, names, placement); the seams to reuse; "done when" (tests, commands, limits); "do not touch". Agents do not see this conversation. An agent that stopped without editing got an incomplete brief: fix the brief, never resend the same one.
   - Point instead of pasting: name the plan file and step id, the doc section, and the files with line ranges, and let the agent read them. Paste only what is written nowhere, such as a decision taken in this conversation, or a scout's finding the agent would otherwise re-discover.
   - Launch independent packages in one message so they run in parallel. If a package's report shows a design problem, fix the plan; do not patch around it.
   - Tick the package's steps in the session file as they finish.
3. End the session:
   - run `finish session <session file>`, which gates Owns, fixes what the gate and lint report, and returns only what needs judgment; each such item goes to an implementer, never to a gate or lint loop in this thread;
   - append one line to `log.md` with `>>`: date, session id, done/left, commit hash;
   - delete the session file;
   - commit the session's own files with `git add <Owns files> && git commit` in this thread; approving the plan authorises those commits.
4. If it was the last session: run `finish plan <plan dir>`, then delete the plan directory.
5. Reply with the handoff message from [handoff.md](handoff.md) and stop.
