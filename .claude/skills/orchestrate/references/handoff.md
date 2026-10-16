# Session handoff

Read when a plan session ends. Write it in the user's language, in at most six lines.

```
## Session <id> done — <plan title>
Done: <package ids> · left: <ids or "nothing">
Commit: <short hash, or "not committed: why">
Next: /orchestrate documents/plans/<slug>/plan.md session <id>   (one line per session that can start now)
```

Only when a session truly cannot finish, write what is left as `sessions/<id>-<name>.md` (self-contained, same Owns) and name it in "Next". On the last session, replace "Next" with two lines on what the user now has.
