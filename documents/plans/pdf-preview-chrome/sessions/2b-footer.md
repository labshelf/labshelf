# Session 2b — Webview: problems, limit, checks

- **Wave:** 2, runs together with 2a and 2c
- **Starts from:** 1a and 1b committed
- **Ends with:** A7, A10, A11 (button) — driven by fixtures of the 1b messages; live data arrives from 2a
- **Commit:** yes
- **Research:** research/ui-kit.md, research/mockup.html (`.cit`, `.ovf`, `.meter`, `.lim` rules and `goProb`)
- **Owns:** `core/src/reader/dom/preview/marks/` (new), `core/src/reader/dom/preview/footer/{cites,limit,checks}*`, preview keymap handlers for F8, their tests
- **Must not touch:** `packages/vscode/`, `core/src/writing/`, header files, protocol

Wave rules: plan.md §6. Edit only the paths under **Owns**; report anything else to the main thread. Commit with an explicit list of these files.

| Id | Step | Depends on | Runner | Done when | OK |
|---|---|---|---|---|---|
| 2b.1 | PDF marks overlay: red / amber wavy underline at problem points, margin mark for overfull, flash | — | M · test-writer, then implementer (sonnet) | marks render from fixture | [ ] |
| 2b.2 | Footer `N cites · M to fix`, arrows, F8 / Shift+F8 cycle, scroll and flash, toast for non-citation problems | 2b.1 | M · test-writer, then implementer (sonnet) | A7 | [ ] |
| 2b.3 | Limit meter (near / over colours) and popover writing `check.*` through the 1b message; `N checks` button | — | M · test-writer, then implementer (sonnet) | A10, A11 button | [ ] |
| 2b.4 | Verify with fixtures, finish, commit | 2b.2–2b.3 | `verify`, `finish`, `commit-splitter` | gate passes | [ ] |
