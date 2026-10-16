# Session 3b — Export

- **Wave:** 3, runs together with 3a
- **Starts from:** 2a, 2b, 2c committed
- **Ends with:** A13
- **Commit:** yes
- **Research:** research/writing-core.md
- **Owns:** `core/src/writing/export/` (new), `packages/vscode/src/writing/export/` (new), `core/src/reader/dom/preview/header/export*`, their tests
- **Must not touch:** `writing/latex/build/` and `vscode/src/writing/build/` (3a), protocol

Wave rules: plan.md §6. Edit only the paths under **Owns**; report anything else to the main thread. Commit with an explicit list of these files.

| Id | Step | Depends on | Runner | Done when | OK |
|---|---|---|---|---|---|
| 3b.1 | Core: file set for a project zip; arXiv bundle with `.bib` trimmed to cited keys from the user's `.bib`, never `labshelf.bib` (D9); zip via an installed dependency if one exists | — | M · test-writer, then implementer (sonnet) | unit tests | [ ] |
| 3b.2 | Host: save dialog, write zip, open PDF externally; header Export menu | 3b.1 | M · test-writer, then implementer (sonnet) | A13 | [ ] |
| 3b.3 | Verify, finish, commit | 3b.2 | `verify`, `finish`, `commit-splitter` | gate passes | [ ] |
