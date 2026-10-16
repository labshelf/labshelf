# Session 4b — Extension-host run, docs

- **Wave:** 4, runs together with 4a; **in its own worktree** (whole-repo build while 4a edits)
- **Starts from:** wave 3 committed; the user confirms the `@vscode/test-electron` copy run (R5, never the installed VS Code)
- **Ends with:** A2–A4, A9, A11–A13 and A14 (host half) observed in a real host; doc deltas folded into `documents/apps/vscode.md`; fixes committed
- **Owns:** fixes in `packages/vscode/**`; `documents/apps/vscode.md`; `documents/contracts/reader-host.md` (only to match observed behaviour)
- **Research:** research/mockup.html
- **Budget:** one conversation, main thread under about 70k, at most four delegated packages.

Wave rules: plan.md §6. A bug whose fix is in `packages/core/` goes to 4a. Recipe: memory "Extension host e2e" — isolated user-data-dir, a copy of the library, stop only the launched PID.

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 4b.1 | Host run: LaTeX thesis with `\include` and a Typst project; save with auto compile on and off, engine switch, Ctrl+S, logs, F8, card Replace/Update/Add, limits written to labshelf.yaml, `<file> only`, three exports, Compare/Mark/Checks; three themes, light and dark | — | `verify` (extension host) | findings listed with screenshots | [ ] |
| 4b.2 | Fix what 4b.1 finds, one package per bug, test first | behaviour | implementer (sonnet; opus on a second failure) | re-run fine | [ ] |
| 4b.3 | Tasks: fold the doc deltas from log.md into `documents/apps/vscode.md` (preview section), present tense | task | `doc-keeper` | doc matches 4b.1 | [ ] |
| 4b.4 | Finish, commit | — | `finish` on Owns, `commit-splitter` with the file list | gate passes | [ ] |
