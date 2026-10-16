# Log: PDF preview chrome

- 2026-10-16 — plan written from three scouts and the mockup; D2–D4 and scope chosen by the user
- 2026-10-16 — sessions regrouped into 4 waves (1a+1b, 2a+2b+2c, 3a+3b, 4) with owned paths per session, at the user's request
- 2026-10-16 16:26 — 1a: D1–D10 approved, R5 approved (test-electron copy); ui-kit research refreshed; 1a.1 design partly done (layout, token map in sessions/1a-layout.md); stopped at the main-thread context budget; unfinished: 1a.1, 1a.2, 1a.3, 1a.4
- 2026-10-16 16:28 1b.1 done (main thread, Opus): D1–D10 approved; reader-host.md#preview written; design notes in sessions/1b-contracts.md; explainTexMessage.ts added to 1b scope (R3).
- 2026-10-16 16:28 1b handoff: main thread hit 100k context after 1b.1; 1b.2–1b.4 left for a fresh session.
- 2026-10-16 16:28 1b peak context: main 107.8k, no subagents.
- 2026-10-16 16:28 1b unfinished: 1b.2, 1b.3, 1b.4.
- 2026-10-16 17:05 1a.1 done (main thread, Opus): ui-kit research refreshed; 4 icons, --ls-reader-footer-h, preview/ split into logs/ and footer/; header/footer/slot design in sessions/1a-layout.md
- 2026-10-16 17:05 1a handoff: main thread hit 100k after 1a.1; unfinished: 1a.2, 1a.3, 1a.4
- 2026-10-16 17:05 1a peak context: main 106.0k, largest subagent Explore 28.5k
- 2026-10-16 17:08 1b.2 done (test-writer + implementer, Sonnet): PROTOCOL_VERSION 6; preview requests in reader/previewRequests.ts; optional PreviewPorts + handlers; keymap split into keyBindings.ts, recompile/nextProblem/prevProblem preview-only; BuildProblem kind/subject (overfull only for \hbox). Citation site type is CitingCommand (CitationSite is taken by writing/backlinks).
- 2026-10-16 17:08 1b.3 done (test-writer + implementer, Sonnet): check.words/check.countUpTo read and written (CheckLimits patch in projectFile.ts), pageLimitFindings honours countUpTo end, library-format.md rows, labshelf.writing.autoCompile in package.json.
- 2026-10-16 17:08 1b.4 done (implementer, Sonnet): buildPreviews.ts split into writing/preview/projectPreview/ (buildPreviews, rootBuilds, previewPanelSource); no behaviour change.
- 2026-10-16 17:08 1b handoff for 1a/2b: reader/dom/startup/readerActions.ts and reader/dom/chrome/cheatsheet.ts must pass KeyContext.preview and handle recompile/nextProblem/prevProblem. For 2a: ReaderHostController.setBuildStatus(state, errors) must be extended to send stale/builtAt.
- 2026-10-16 17:08 1b finish: gate PASS (core reader+writing, vscode writing/preview; core/vscode/browser/terminal typecheck); no fixes needed.
- 2026-10-16 17:08 1b peak context: main 90.6k, largest subagent 65.6k (1b.2 implementer, over 60k budget).
