# Session 4 — End-to-end verify and close

- **Wave:** 4, runs alone
- **Starts from:** 3a and 3b committed
- **Ends with:** A1–A14 ticked; plan closed
- **Commit:** yes
- **Research:** research/mockup.html
- **Owns:** any path, for fixes found here; `documents/apps/vscode.md`; this plan

| Id | Step | Depends on | Runner | Done when | OK |
|---|---|---|---|---|---|
| 4.1 | Real host run on a LaTeX thesis with `\include` and a Typst project; every theme in the mockup list; screenshots against the mockup | — | `verify` | A1–A14 observed | [ ] |
| 4.2 | Fix what 4.1 finds (one package each) | 4.1 | M · implementer (sonnet), opus on a second failure | fixed | [ ] |
| 4.3 | Fold the doc deltas from `log.md` into `documents/apps/vscode.md`; finish; commit | 4.2 | `finish`, `commit-splitter` | gate passes | [ ] |
| 4.4 | Calibration row, delete the plan directory | 4.3 | H · main thread | done | [ ] |
