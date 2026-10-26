# Running a plan file

Read when the request is a path to a plan.

A session reads its session file and nothing else of the plan: not `plan.md`, not `log.md`, not other sessions. The session file is self-contained; if it is not, that is a planning bug to report, not a reason to read more.

1. Pick the session: the one named in the request, or the lowest-numbered file in `sessions/`. Read only that file. Check its **Starts from** against the session context hook; if the repo is not in that state, stop and say what differs.
2. Run its packages as in steps 4–5 of the skill and nothing from other sessions. `research/` entries it names go into the implementer briefs by path; the implementer reads them, the main thread does not, and nothing is re-scouted unless a package fails on a wrong premise. Sibling sessions may edit the same worktree: touch, check and commit only the session's **Owns**.
3. End the session:
   - run `finish session <session file>`, which gates Owns and returns only what needs judgment;
   - append one line to `log.md` with `>>`: date, session id, done/left, commit hash;
   - delete the session file;
   - commit the session's own files with `git add <Owns files> && git commit` in this thread; approving the plan authorises those commits.
4. If it was the last session: run `finish plan <plan dir>`, then delete the plan directory.
5. Reply with the handoff message from [handoff.md](handoff.md) and stop.
