# Estimate calibration

When a plan is done, compare its estimated size with what it really took. Brainstorm and orchestrate read this file before sizing new work, and correct for the bias it shows.

Keep the 20 most recent rows; delete older ones. Update the bias line whenever a row is added.

**Bias so far:** one plan. The session count held, but closing steps were under-scoped: turning checks into errors meant first clearing every baseline they had absorbed.

| Finished | Plan | Estimated | Sessions estimated → used | Real time | Real size | Why it differed |
|---|---|---|---|---|---|---|
| 2026-10-15 | architecture-refactor | GG | 13 → 13 | 8 days (2026-10-08 → 2026-10-15) | GG | The closing step, sized as a doc pass, was four steps: the check baselines held 12 size violations, 150 deep imports, 74 knip findings and 56 neutral-runtime errors. One step (the browser scratch-Drive check) needed the user and moved to its own plan. |
