# Log: Overleaf-like writing workspace in VS Code

<!-- Append-only. One line per finished step or session: `- <YYYY-MM-DD HH:MM> — <step id> <what was done, any deviation>`. Add lines with `>>`; never read the file whole. A closed session adds one line with the peak context of the main thread and of the largest subagent. -->
- 2026-10-16 11:00 — S1.1 findRoots in core/src/writing/project/roots/ (16 tests); project/ grouped into roots/ and roots/node/ to stay at 8 files.
- 2026-10-16 11:00 — S1.2 per-root build folder: builders keep their outDir/outputs parameters; core adds rootBuildFolder (neutral) and clearFlatBuildFiles (node); A9 at the core seam via runLatexBuild test. Also buildRootOf (node) for S1.3 triggers.
- 2026-10-16 11:00 — S1.3 not done: the vscode tests are written and red; first opus attempt hit its 60k budget while reading (no edits). Split into S1.3a/S1.3b with decisions in sessions/01.md. Unfinished: S1.3a, S1.3b, S1.4.
- 2026-10-16 11:00 — session 1 stopped early at the main-thread budget: main peak 109.9k (baseline 48.6k), largest subagent 63.3k (S1.3 opus implementer).
- 2026-10-16 11:00 — S1.3 prep: rootBuildDir replaced by neutral rootBuildFolder (core tests pass); three vscode tests still import rootBuildDir (noted in sessions/01.md).
- 2026-10-16 15:10 — S1.3a opus: ProjectBuilders/BuildListener/BuildDiagnostics/BuildPreviews keyed by absolute root path; LaTeX outDir per root with clearFlatBuildFiles; typstPreviewPdf takes root; builtPdf got a one-line call fix early so buildPreviews.test compiled.
- 2026-10-16 15:10 — S1.3b sonnet: RegisterNodeWriting returns buildRootOf; build command, LaTeX save and Typst save/live resolve the root and debounce per root; builtPdf and ProjectSynctex read per root (preview still shows main until session 2); new registerLatexBuild.test.ts. Fixed core buildRootOf import past index (lint:deps).
- 2026-10-16 15:10 — S1.4 finish: gate PASS (core 3104, vscode 709 tests, all typechecks, lint:deps); core project index header updated; no docs change (build layout is not a contract). A9 met; A13 waits for the headless browser check.
- 2026-10-16 15:10 — session 1 closed: main peak 74.7k (baseline 48.5k), largest subagent 64.0k (S1.3a opus implementer, over 60k budget but finished).
