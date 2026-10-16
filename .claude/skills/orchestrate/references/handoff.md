# Session handoff

Read when a plan session ends. Write it in the user's language.

```
## Session <n> of <m> done — <plan title>
Done: S<a>–S<b> · acceptance A<x>, A<y> pass
Deviations: <one line each, or "none"> (also in the plan's `log.md`)
Commit: <short hash and message, or "not committed: why">
Estimate: session planned as <…>, took <time>

Next session: paste this into a new conversation:
/orchestrate documents/plans/<slug>/plan.md session <n+1>
```

When the context budget ends a session early, append the unfinished step ids to `log.md` with `>>`, write "Done" with only the finished steps, and end with `/orchestrate documents/plans/<slug>/plan.md session <n>`: the next conversation picks up the unticked steps.

After a plan is written in step 3, use only the last two lines, with `session 1`.

On the last session, replace the "Next session" part with a three-line summary of what the user now has, and the calibration row added to `documents/plans/CALIBRATION.md`.
