# Estimate calibration

When a plan is done, compare its estimated size with what it really took. Brainstorm and orchestrate read this file before sizing new work, and correct for the bias it shows.

Keep the 20 most recent rows; delete older ones. Update the bias line whenever a row is added.

**Bias so far:** two plans, and both held their session count. The scope inside sessions is under-estimated: closing steps absorb baseline clean-up, and multi-agent steps cost several times their estimate in subagent tokens (a council runs about 200k, not 30k). Size work by sessions, and budget agent fan-out separately.

| Finished | Plan | Estimated | Sessions estimated → used | Real time | Real size | Why it differed |
|---|---|---|---|---|---|---|
| 2026-10-15 | agent-tooling | GG | 8 → 8 | 2 days (2026-10-14 → 2026-10-15 11:16) | GG | The session count held. The council measured about 200k subagent tokens against an estimate of 30k. Session 8 needed five reviewers instead of four, because core is 58 % of the code. The council gate reduced the planned five councils to two, plus two fact scouts and two user questions. Session 2 found stale memory paths and duplicate script names that no step had planned for. |
| 2026-10-15 | architecture-refactor | GG | 13 → 13 | 8 days (2026-10-08 → 2026-10-15) | GG | The closing step, sized as a doc pass, was four steps: the check baselines held 12 size violations, 150 deep imports, 74 knip findings and 56 neutral-runtime errors. One step (the browser scratch-Drive check) needed the user and moved to its own plan. |
