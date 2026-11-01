# Log: notebook-flow

<!-- Append-only. One line per finished step or session: `- <YYYY-MM-DD HH:MM> — <step id> <what was done, any deviation>`. Add lines with `>>`; never read the file whole. A closed session adds one line with the peak context of the main thread and of the largest subagent. -->
- 2026-11-01 15:35 — session 1 blocked: 1.0: no report; 1.5: missing
- 2026-11-01 16:07 — session 1 done: 1.0, 1.1, 1.2, 1.3, 1.4, 1.5
- 2026-11-01 16:17 — 2.0 specs refreshed, hidden tests red (2.1: 32, 2.2: 38, 2.3: 16); 2.2 progress seam moved to new runProgress.ts so red can stub it
- 2026-11-01 16:36 — session 2 done: 2.0, 2.1, 2.2, 2.3, 2.4
- 2026-11-01 16:47 — 3.0 specs refreshed (sha fb034024), hidden tests red (3.1, 3.2, 3.3); foldKey seam became foldStateOf and handle/option additions moved to decided so red can stub them; 3.2/3.3 list the 3.1 seams they import
- 2026-11-01 16:53 — 3.1 done (42/42 hidden, typecheck); handoff after the context warning: 3.2, 3.3, finish and close pending
- 2026-11-01 16:58 — 3.2 done (25/25 hidden, 3.1 still 42/42, typecheck); first run missing codeCellView.ts in edit (summary element must be removed, not hidden), spec extended; qmd-editor.css now 425 lines (>400), split deferred
- 2026-11-01 17:02 — 3.3 done (44/44 hidden, typecheck); arbiter test_wrong on one 3.3a test (Reading mode collapses output-less cells per 3.2), tester fixed it, attempt budget reset
- 2026-11-01 17:17 — session 3 blocked: 3.0: no report
- 2026-11-01 17:17 — session 3 done: 3.0, 3.1, 3.2, 3.3
- 2026-11-01 17:33 — 4.0 specs refreshed (sha fc18ecce), hidden tests red (4.1: 70, 4.2: 11 core, 4.3: 5 core; browser/vscode store tests not red-checked by plan red); handoff after the context warning: 4.1, 4.2, 4.3, finish and close pending
- 2026-11-01 17:43 — 4.1 done (70/70 hidden, typecheck); arbiter test_wrong on the Mod-Shift-Enter-without-noteActions test (ProseMirror preventDefaults every Enter), test fixed in the main thread
- 2026-11-01 17:46 — 4.2 done (11 core + 9 vscode hidden, typecheck core and vscode)
- 2026-11-01 17:50 — 4.3 done (5 core + 13 browser, typechecks); arbiter test_wrong on the project-note order test (trailing newline in the cell code), test fixed in the main thread
- 2026-11-01 18:18 — session 4 done: 4.0, 4.1, 4.2, 4.3
- 2026-11-01 18:36 — 5.0 specs refreshed (sha 09d277e1), hidden tests red (5.1: 101, 5.2: 69, 5.3: 44); seams switched to inline import() types and every hidden file calls a seam in beforeEach so red can stub them; handoff after the context warning: 5.1, 5.2, 5.3, finish and close pending
- 2026-11-01 18:48 — 5.1 done (101/101 hidden, typecheck; existing cellMenu/noteBar tests updated); 5.2 done (69/69 hidden); 5.1 hidden problemNav fakes gained the 5.2 handle members, fixed in the main thread; qmd-editor.css 461 lines
- 2026-11-01 19:11 — 5.3 done (44/44 hidden; arbiter test_wrong on the pinned cell menu list); 5.4 added and done: notesTab TDZ from 5.2's mount-time outlineOpen read, noteViewState test, qmd-editor.css split into qmd-note-ui.css and qmd-drawing.css (363 lines); Wolfram compute test fails on an expired kernel license (environmental)
- 2026-11-01 19:34 — session 5 done: 5.0, 5.1, 5.2, 5.3, 5.4
