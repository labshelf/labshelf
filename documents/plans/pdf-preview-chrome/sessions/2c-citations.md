# Session 2c — Citation card and fixes

- **Wave:** 2, runs together with 2a and 2b
- **Starts from:** 1a and 1b committed
- **Ends with:** A8, A9
- **Commit:** yes
- **Research:** research/writing-core.md, research/ui-kit.md
- **Owns:** `core/src/reader/dom/hover/citations/**`, `core/src/writing/citations/**`, `core/src/writing/review/{citationEntries,quotedHighlights}.ts`, `packages/vscode/src/writing/preview/citations/**`, their tests
- **Must not touch:** `writing/problems/` (2a), marks overlay (2b), protocol

Wave rules: plan.md §6. Edit only the paths under **Owns**; report anything else to the main thread. Commit with an explicit list of these files.

| Id | Step | Depends on | Runner | Done when | OK |
|---|---|---|---|---|---|
| 2c.1 | Capture `[p.~N]` in `citedKeys`; card data: REF/BIB, folder, `file:line · \cite…`, page-first highlights (colour only, D2) | — | M · test-writer, then implementer (sonnet) | A8 data | [ ] |
| 2c.2 | `suggestKey` ranking (D10) and Replace via WorkspaceEdit | — | H · implementer (opus), tests first | A9 Replace | [ ] |
| 2c.3 | Update to published (reuse `BibFix`); Add to library from a bib entry (identifier import, else bib fields) | 2c.1 | M · test-writer, then implementer (sonnet) | A9 Update/Add | [ ] |
| 2c.4 | Card UI from the mockup, verify, finish, commit | 2c.1–2c.3 | M · implementer; `verify`, `finish`, `commit-splitter` | A8, A9 in host | [ ] |

Notes: source edits trigger 2a's stale tracking by themselves; 2c does not call it.
