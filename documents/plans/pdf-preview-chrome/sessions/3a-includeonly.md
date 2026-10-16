# Session 3a — `\includeonly`

- **Wave:** 3, runs together with 3b
- **Starts from:** 2a, 2b, 2c committed
- **Ends with:** A12, or a logged no-go with the toggle left out
- **Commit:** yes
- **Research:** research/preview.md
- **Owns:** `core/src/writing/latex/build/**`, `packages/vscode/src/writing/build/**`, `core/src/reader/dom/preview/header/only*`, their tests
- **Must not touch:** export files (3b), protocol

Wave rules: plan.md §6. Edit only the paths under **Owns**; report anything else to the main thread. Commit with an explicit list of these files.

| Id | Step | Depends on | Runner | Done when | OK |
|---|---|---|---|---|---|
| 3a.1 | Spike (R4): latexmk `-usepretex` with `\includeonly` vs generated wrapper root; other chapters keep numbering from `.aux`; go/no-go in log.md | — | H · main thread | decision logged | [ ] |
| 3a.2 | Toggle shown only when the root uses `\include`; build with `\includeonly` | 3a.1 | M · test-writer, then implementer (sonnet) | A12 | [ ] |
| 3a.3 | Verify, finish, commit | 3a.2 | `verify`, `finish`, `commit-splitter` | gate passes | [ ] |
