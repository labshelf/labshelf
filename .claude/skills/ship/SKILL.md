---
name: ship
description: Close out the current change — the finish pass (Sonnet), then atomic commits (Haiku). Stops if the finish pass reports a failing gate or issues that need judgment.
---

1. Run the `finish` skill.
2. If its report says `Gate: FAIL` or lists anything under "Needs judgment", stop. Show the report to the user, or fix the items yourself if they are part of the task you were given, then run step 1 again.
3. Run the `commit-splitter` agent. It runs on Haiku and asks before committing.
4. Report the commits created.
5. Only when the user asked for a pull request, write its body below. Do not push: a guardrails hook blocks pushing, so give the user the body and the PR-creation command (`gh pr create --title "<title>" --body-file <file>`). Create the PR yourself only when the user explicitly asked for it and the branch is already pushed.

```
## Summary
<1–3 lines: the user-visible effect, per app>

## Evidence
- Gate: <the finish gate line, with its fingerprint if present>
- Tests added that fail without the change: <paths>
- Verify: <screenshots or frames, when the UI changed>
- Not checked: <what was not run or not covered>

## Door
<one-way or two-way>

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

Door is **one-way** by the rule in `.claude/skills/orchestrate/SKILL.md` step 3: name what it touches and how it is reversed. Otherwise it is **two-way**.
