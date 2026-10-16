# Log: VS Code writing code behind the web boundary

- 2026-10-16 — plan written from three scouts (violation classes, plan overlap, tabProbe seam); tabProbe test delegated outside the plan
- 2026-10-16 07:26 — D1–D5 approved; status in progress (session 1 of 3)
- 2026-10-16 07:26 — S1.1 neutral core types (ProjectEntry/ProjectLocation, OpenSources in project/, LocatedProblem+LatexBuildResult, ProjectVersion, FigureRunResult, PdfjsLoader in import/pdf/types.ts); lint:deps 63 → 52 (Sonnet implementer)
- 2026-10-16 07:26 — S1.2 PathOps gained extname/isAbsolute/resolve/relative; injected as WritingProjects(host, paths); lint:deps 52 → 41 (Sonnet implementer, over 60k budget)
- 2026-10-16 07:26 — S1.3 builtPdf/sourceLineAt/continueTargets on vscode.workspace.fs, writing/index exports mainPathIn/owningProject; lint:deps 41 → 35, all N/N(core) (Sonnet test-writer then implementer)
- 2026-10-16 07:26 — S1.4 finish PASS (core 3066, vscode 696, terminal 876 tests); note: core writing/project is at 8 files, so the S2 port needs a subfolder
- 2026-10-16 07:26 — peak context: main 75k, largest subagent 76k (S1.2 implementer)
